// SuccessPath Classes: the server.
//
// Runs on Cloudflare Workers. The web page in /public is served by Cloudflare directly;
// this file only answers the /api/ addresses:
//
//   POST /api/entries               save a new entry, and add or update the student/teacher it is about
//   POST /api/entries/<id>/cancel   mark an entry as cancelled (only from the device that saved it)
//   GET  /api/people?kind=student   the Students (or Teachers) list
//   GET  /api/people/<STU-0001>     one student or teacher with their full history
//   GET  /api/analytics             numbers for the Analytics page
//   GET  /api/tasks                 the Tasks board, with the exams coming up
//   POST /api/tasks                 add a task
//   POST /api/tasks/<TSK-0001>      change a task: move it, edit it, or remove it from the board
//   GET  /api/health                quick check that the server and database are working
//   GET  /api/sync                  changes since the last sync       (Google Sheet only, needs SYNC_KEY)
//   GET  /api/export                every entry, page by page         (Google Sheet backups, needs SYNC_KEY)
//   GET  /api/registers             every student and teacher         (Google Sheet, needs SYNC_KEY)
//   GET  /api/tasks-export          every task, page by page          (Google Sheet, needs SYNC_KEY)

import {
  APP_NAME, APP_VERSION, PEOPLE, TASK_STAGES, getForm, getPeople, validateEntry, fixedColumns, sheetSchema,
  indiaToday, nameKey, monthLabel, isRealDate,
} from '../public/forms.js';

const SCHEMA_JSON = JSON.stringify(sheetSchema());
const MAX_BODY_CHARS = 20000;
const NOW = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";
const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) {
      return new Response('Not found', { status: 404 });
    }
    try {
      return await handleApi(request, env, url);
    } catch (err) {
      const message = String(err && err.message ? err.message : err);
      console.error('API error:', err && err.stack ? err.stack : message);
      if (/no such (table|column)/i.test(message)) {
        return json({ ok: false, error: 'The database is not up to date yet. Run: npm run db:setup' }, 503);
      }
      return json({ ok: false, error: 'The server had a problem. Please try again in a minute.' }, 500);
    }
  },
};

async function handleApi(request, env, url) {
  const path = url.pathname.replace(/\/+$/, '');
  const method = request.method;

  if (path === '/api/health') {
    if (method !== 'GET') return methodNotAllowed('GET');
    await env.DB.prepare('SELECT (SELECT id FROM people LIMIT 1), (SELECT id FROM tasks LIMIT 1)').first();
    return json({ ok: true, app: APP_NAME, version: APP_VERSION });
  }

  if (path === '/api/entries') {
    if (method !== 'POST') return methodNotAllowed('POST');
    return createEntry(request, env);
  }

  const cancel = /^\/api\/entries\/([A-Z]{2,5}-\d{1,12})\/cancel$/.exec(path);
  if (cancel) {
    if (method !== 'POST') return methodNotAllowed('POST');
    return cancelEntry(request, env, cancel[1]);
  }

  if (path === '/api/people' || path.startsWith('/api/people/') || path === '/api/analytics') {
    if (method !== 'GET') return methodNotAllowed('GET');
    const denied = checkViewer(request, env);
    if (denied) return denied;
    if (path === '/api/analytics') return analytics(env);
    if (path === '/api/people') return peopleList(env, url);
    const code = /^\/api\/people\/((?:STU|TR)-\d{1,12})$/.exec(path);
    return code ? personDetail(env, code[1]) : json({ ok: false, error: 'Not found' }, 404);
  }

  if (path === '/api/tasks') {
    if (method === 'POST') return createTask(request, env);
    if (method !== 'GET') return methodNotAllowed('GET, POST');
    const denied = checkViewer(request, env);
    return denied || tasksBoard(env);
  }

  const task = /^\/api\/tasks\/(TSK-\d{1,12})$/.exec(path);
  if (task) {
    if (method !== 'POST') return methodNotAllowed('POST');
    return updateTask(request, env, task[1]);
  }

  if (path === '/api/sync' || path === '/api/export' || path === '/api/registers' || path === '/api/tasks-export') {
    if (method !== 'GET') return methodNotAllowed('GET');
    const auth = checkSyncKey(request, env);
    if (auth !== 'ok') return auth;
    if (path === '/api/sync') return syncFeed(env, url);
    if (path === '/api/export') return exportPage(env, url);
    if (path === '/api/tasks-export') return tasksExportPage(env, url);
    return registersPage(env, url);
  }

  return json({ ok: false, error: 'Not found' }, 404);
}

/* ---------------- Who may view the Students and Analytics pages ---------------- */

// The owner chose to keep the app open for now, so anyone with the link can view.
// To add a login later, check it here: this is the only door to the viewing pages.
function checkViewer(request) {
  if (request.headers.get('x-successpath') !== '1') {
    return json({ ok: false, error: 'Please open the SuccessPath page.' }, 400);
  }
  return null;
}

/* ---------------- Saving an entry ---------------- */

// Adds the student or teacher to the register, unless someone with the same name (and the same
// class or phone number) is already there. Runs in the same transaction as the entry itself.
const ADD_PERSON_SQL = `
INSERT INTO people (kind, seq, code, name, name_key, class, phone, status, created_from_client)
SELECT ?1, nx.n, printf('%s-%04d', ?2, nx.n), ?3, ?4, ?5, ?6, ?7, ?8
FROM (SELECT COALESCE(MAX(seq), 0) + 1 AS n FROM people WHERE kind = ?1) AS nx
WHERE NOT EXISTS (
    SELECT 1 FROM people
    WHERE kind = ?1 AND name_key = ?4
      AND (?5 IS NULL OR class IS NULL OR class = ?5 OR (?6 IS NOT NULL AND phone = ?6)))
  AND NOT EXISTS (SELECT 1 FROM entries WHERE client_id = ?8)
ON CONFLICT (created_from_client) DO NOTHING`;

const INSERT_ENTRY_SQL = `
INSERT INTO entries (type, seq, code, entry_date, name, phone, amount, data, client_id, cancel_hash, person_id)
SELECT ?1, nx.n, printf('%s-%04d', ?2, nx.n), ?3, ?4, ?5, ?6, ?7, ?8, ?9,
  COALESCE(?10, (
    SELECT id FROM people
    WHERE kind = ?11 AND name_key = ?12
      AND (?13 IS NULL OR class IS NULL OR class = ?13 OR (?14 IS NOT NULL AND phone = ?14))
    ORDER BY CASE status WHEN 'Cancelled' THEN 1 ELSE 0 END, (?14 IS NOT NULL AND phone = ?14) DESC,
      (class IS ?13) DESC, (status = 'Active') DESC, id ASC
    LIMIT 1))
FROM (SELECT COALESCE(MAX(seq), 0) + 1 AS n FROM entries WHERE type = ?1) AS nx
WHERE true
ON CONFLICT (client_id) DO NOTHING
RETURNING code, status, created_at, person_id`;

const MARK_CREATOR_SQL = `
UPDATE people SET created_from = (SELECT code FROM entries WHERE client_id = ?1)
WHERE created_from_client = ?1 AND created_from IS NULL`;

// A person hidden because the entry that added them was cancelled comes back when a new entry
// is about them (for example "Enter it again correctly" after a wrong amount).
const REVIVE_SQL = `
UPDATE people SET status = 'Active', updated_at = ${NOW}
WHERE id = (SELECT person_id FROM entries WHERE client_id = ?1) AND status = 'Cancelled'`;

async function createEntry(request, env) {
  if (request.headers.get('x-successpath') !== '1') {
    return json({ ok: false, error: 'Please use the SuccessPath page to add entries.' }, 400);
  }
  const body = await readJson(request);
  if (!body.ok) return json({ ok: false, error: body.error }, 400);
  const input = body.value;

  // A hidden field on the page that people never see. Only robots fill it in.
  if (input.website) return json({ ok: false, error: 'Rejected.' }, 400);

  const form = getForm(input.type);
  if (!form) return json({ ok: false, error: 'This form does not exist. Please reload the page.' }, 400);
  if (!isClientId(input.client_id) || !isToken(input.cancel_token)) {
    return json({ ok: false, error: 'Please reload the page and try again.' }, 400);
  }

  const checked = validateEntry(form, input.data, indiaToday());
  if (!checked.ok) {
    return json({ ok: false, error: checked.errors._form || 'Please check the fields marked in red.', fields: checked.errors }, 422);
  }
  const data = checked.data;

  // Which student or teacher is this entry about?
  const link = form.person || null;
  let personId = null;
  if (link && data[link.field] !== undefined) {
    personId = await personFromCode(env, link, input.person_code);
    if (personId === null && !link.add) {
      if (link.kind !== 'any') personId = await onlyMatch(env, link, data);
      if (personId === null && !link.optional) {
        const who = link.kind === 'teacher' ? 'teacher' : link.kind === 'student' ? 'student' : 'person';
        return json({
          ok: false,
          error: `This ${who} is not in the register yet. Choose them from the list.`,
          fields: { [link.field]: `Choose the ${who} from the list.` },
        }, 422);
      }
    }
  }

  const fixed = fixedColumns(form, data);
  const cancelHash = await sha256Hex(input.cancel_token);
  const willAdd = Boolean(link && link.add && link.kind !== 'any' && personId === null && data[link.field] !== undefined);
  const key = link && data[link.field] !== undefined ? nameKey(data[link.field]) : null;
  const cls = link && link.classField && data[link.classField] !== undefined ? data[link.classField] : null;
  const phone = link && link.phoneField && data[link.phoneField] !== undefined ? data[link.phoneField] : null;

  const statements = [];
  if (willAdd) {
    statements.push(env.DB.prepare(ADD_PERSON_SQL).bind(
      link.kind, PEOPLE[link.kind].prefix, data[link.field], key, cls, phone,
      link.status === 'Left' ? 'Left' : 'Active', input.client_id,
    ));
  }
  const entryIndex = statements.length;
  statements.push(env.DB.prepare(INSERT_ENTRY_SQL).bind(
    form.type, form.prefix,
    fixed.entry_date, fixed.name, fixed.phone, fixed.amount,
    JSON.stringify(data), input.client_id, cancelHash,
    personId, willAdd ? link.kind : null, willAdd ? key : null, willAdd ? cls : null, willAdd ? phone : null,
  ));
  if (willAdd) statements.push(env.DB.prepare(MARK_CREATOR_SQL).bind(input.client_id));
  if (link && link.add) statements.push(env.DB.prepare(REVIVE_SQL).bind(input.client_id));
  const update = personUpdate(env, link, data, input.client_id);
  if (update) statements.push(update);

  const results = await env.DB.batch(statements);
  let entry = results[entryIndex].results && results[entryIndex].results[0];
  let duplicate = false;
  if (!entry) {
    // The device sent the same entry again (for example after a weak connection). Do not save it twice.
    const existing = await env.DB.prepare('SELECT code, type, status, created_at, person_id FROM entries WHERE client_id = ?1')
      .bind(input.client_id)
      .first();
    if (!existing || existing.type !== form.type) {
      return json({ ok: false, error: 'Please reload the page and try again.' }, 409);
    }
    entry = existing;
    duplicate = true;
  }

  let person = null;
  if (entry.person_id !== null && entry.person_id !== undefined) {
    const row = await env.DB.prepare('SELECT code, name, kind, created_from_client FROM people WHERE id = ?1')
      .bind(entry.person_id)
      .first();
    if (row) person = { code: row.code, name: row.name, kind: row.kind, added: row.created_from_client === input.client_id };
  }
  return json({
    ok: true,
    duplicate,
    entry: { code: entry.code, status: entry.status, created_at: entry.created_at },
    person,
  }, duplicate ? 200 : 201);
}

// A person chosen from the list on the page (by their ID, for example STU-0012).
async function personFromCode(env, link, code) {
  if (typeof code !== 'string' || !/^(STU|TR)-\d{1,12}$/.test(code)) return null;
  const row = await env.DB.prepare('SELECT id, kind, status FROM people WHERE code = ?1').bind(code).first();
  if (!row || (row.status === 'Cancelled' && !link.add)) return null;
  if (link.kind !== 'any' && row.kind !== link.kind) return null;
  return row.id;
}

// For entries about someone already in the register (marks, complaints): accept a typed name
// only when exactly one person matches it.
async function onlyMatch(env, link, data) {
  const cls = link.classField && data[link.classField] !== undefined ? data[link.classField] : null;
  const phone = link.phoneField && data[link.phoneField] !== undefined ? data[link.phoneField] : null;
  const rows = await env.DB.prepare(`
    SELECT id FROM people
    WHERE kind = ?1 AND status <> 'Cancelled' AND name_key = ?2
      AND (?3 IS NULL OR class IS NULL OR class = ?3 OR (?4 IS NOT NULL AND phone = ?4))
    LIMIT 2`).bind(link.kind, nameKey(data[link.field]), cls, phone).all();
  return rows.results.length === 1 ? rows.results[0].id : null;
}

// What this entry changes in the register: class, phone, details, joined or left.
function personUpdate(env, link, data, clientId) {
  if (!link) return null;
  const sets = [];
  const differs = [];
  const params = [clientId];
  const param = (value) => {
    params.push(value);
    return `?${params.length}`;
  };
  for (const [column, fieldKey] of Object.entries(link.update || {})) {
    if (data[fieldKey] === undefined) continue;
    const p = param(data[fieldKey]);
    sets.push(`${column} = ${p}`);
    differs.push(`${column} IS NOT ${p}`);
  }
  for (const [column, fieldKey] of Object.entries(link.fill || {})) {
    if (data[fieldKey] === undefined) continue;
    const p = param(data[fieldKey]);
    sets.push(`${column} = COALESCE(${column}, ${p})`);
    differs.push(`${column} IS NULL`);
  }
  const details = {};
  for (const key of link.details || []) if (data[key] !== undefined) details[key] = data[key];
  if (Object.keys(details).length) {
    const p = param(JSON.stringify(details));
    sets.push(`details = json_patch(details, ${p})`);
    differs.push(`details IS NOT json_patch(details, ${p})`);
  }
  const date = link.dateField && data[link.dateField] !== undefined ? data[link.dateField] : null;
  if (link.status === 'Active') {
    sets.push("status = 'Active'", 'left_on = NULL');
    differs.push("status IS NOT 'Active'");
    if (date) {
      const p = param(date);
      sets.push(`joined_on = COALESCE(joined_on, ${p})`);
      differs.push('joined_on IS NULL');
    }
  } else if (link.status === 'Left') {
    const p = param(date || indiaToday());
    sets.push("status = 'Left'", `left_on = ${p}`);
    differs.push("status IS NOT 'Left'", `left_on IS NOT ${p}`);
  }
  if (!sets.length) return null;
  sets.push(`updated_at = ${NOW}`);
  const sql = `UPDATE people SET ${sets.join(', ')}
    WHERE id = (SELECT person_id FROM entries WHERE client_id = ?1) AND status <> 'Cancelled'
      AND (${differs.join(' OR ')})`;
  return env.DB.prepare(sql).bind(...params);
}

/* ---------------- Cancelling an entry ---------------- */

// What a cancellation does to the register (for example, a cancelled "student left" entry makes the
// student active again) is handled by a database trigger, so it also applies to changes made by hand.
const CANCEL_SQL = `
UPDATE entries
SET status = 'Cancelled',
    cancel_reason = ?2,
    cancelled_at = ${NOW},
    updated_at = ${NOW}
WHERE code = ?1 AND cancel_hash = ?3 AND status = 'Active'
RETURNING code, status, cancelled_at`;

async function cancelEntry(request, env, code) {
  if (request.headers.get('x-successpath') !== '1') {
    return json({ ok: false, error: 'Please use the SuccessPath page.' }, 400);
  }
  const body = await readJson(request);
  if (!body.ok) return json({ ok: false, error: body.error }, 400);
  const { token } = body.value;
  const reason = typeof body.value.reason === 'string' ? body.value.reason.replace(/\s+/g, ' ').trim() : '';
  if (!isToken(token)) return json({ ok: false, error: 'This entry can only be cancelled on the device it was saved from.' }, 403);

  const hash = await sha256Hex(token);
  const updated = await env.DB.prepare(CANCEL_SQL).bind(code, reason ? reason.slice(0, 300) : null, hash).first();
  if (updated) return json({ ok: true, entry: updated });

  const existing = await env.DB.prepare('SELECT status, cancel_hash FROM entries WHERE code = ?1').bind(code).first();
  if (!existing) return json({ ok: false, error: `Entry ${code} was not found.` }, 404);
  if (existing.cancel_hash !== hash) {
    return json({ ok: false, error: 'This entry can only be cancelled on the device it was saved from.' }, 403);
  }
  return json({ ok: true, already: true, entry: { code, status: existing.status } });
}

/* ---------------- Students and teachers ---------------- */

// Whether payment `e` covers a month: the month is ticked in "Fee for", or nothing is ticked and the
// payment was made in that month. The arguments are the numbers of the SQL parameters holding the
// months field ('$.fee_for'), the month's label ('Nov 2026') and the month ('2026-11').
function coversMonth(field, label, month) {
  return `(instr(COALESCE(json_extract(e.data, ?${field}), ''), ?${label}) > 0
  OR (COALESCE(json_extract(e.data, ?${field}), '') = '' AND substr(e.entry_date, 1, 7) = ?${month}))`;
}

// Marks are optional, so only tests with both the marks and the total count here.
const LAST_PERCENT = `(SELECT ROUND(100.0 * json_extract(e.data, '$.marks') / json_extract(e.data, '$.out_of'))
  FROM entries e WHERE e.person_id = p.id AND e.type = 'marks' AND e.status = 'Active'
    AND json_extract(e.data, '$.marks') IS NOT NULL AND json_extract(e.data, '$.out_of') > 0
  ORDER BY e.entry_date DESC, e.id DESC LIMIT 1)`;

const PEOPLE_LIST_SQL = `
SELECT json_group_array(json_object(
  'code', p.code, 'name', p.name, 'class', p.class, 'phone', p.phone, 'status', p.status,
  'joined_on', p.joined_on, 'left_on', p.left_on, 'plan', json_extract(p.details, '$.fee_plan'),
  'total_paid', (SELECT COALESCE(SUM(e.amount), 0) FROM entries e WHERE e.person_id = p.id AND e.type = ?2 AND e.status = 'Active'),
  'last_paid_on', (SELECT MAX(e.entry_date) FROM entries e WHERE e.person_id = p.id AND e.type = ?2 AND e.status = 'Active'),
  'paid_this_month', EXISTS (SELECT 1 FROM entries e WHERE e.person_id = p.id AND e.type = ?2 AND e.status = 'Active' AND ${coversMonth(3, 4, 5)}),
  'last_percent', ${LAST_PERCENT}
)) AS people
FROM people p
WHERE p.kind = ?1 AND p.status <> 'Cancelled'`;

async function peopleList(env, url) {
  const people = getPeople(url.searchParams.get('kind') || 'student');
  if (!people) return json({ ok: false, error: 'Unknown list.' }, 400);
  const today = indiaToday();
  const row = await env.DB.prepare(PEOPLE_LIST_SQL)
    .bind(people.kind, people.paymentType, `$.${people.monthsField}`, monthLabel(today), today.slice(0, 7))
    .first();
  const body = `{"ok":true,"kind":${JSON.stringify(people.kind)},"month":${JSON.stringify(monthLabel(today))},`
    + `"people":${(row && row.people) || '[]'}}`;
  return new Response(body, { headers: JSON_HEADERS });
}

const PERSON_ENTRIES_SQL = `
SELECT json_group_array(json_object(
  'code', code, 'type', type, 'status', status, 'entry_date', entry_date, 'amount', amount,
  'data', json(data), 'created_at', created_at, 'cancel_reason', cancel_reason)) AS entries
FROM (SELECT * FROM entries WHERE person_id = ?1 ORDER BY COALESCE(entry_date, substr(created_at, 1, 10)) DESC, id DESC)`;

// Exam dates saved for a whole class (no student chosen) that apply to this student:
// same class, and the same school or no school given.
const CLASS_EXAMS_SQL = `
SELECT json_group_array(json_object(
  'code', code, 'type', type, 'status', status, 'entry_date', entry_date, 'amount', amount,
  'data', json(data), 'created_at', created_at, 'cancel_reason', cancel_reason)) AS entries
FROM (SELECT * FROM entries
      WHERE type = 'exam' AND status = 'Active' AND person_id IS NULL AND ?1 IS NOT NULL
        AND json_extract(data, '$.class') = ?1
        AND (json_extract(data, '$.school') IS NULL OR ?2 IS NULL OR lower(json_extract(data, '$.school')) = lower(?2))
      ORDER BY COALESCE(entry_date, substr(created_at, 1, 10)) DESC, id DESC
      LIMIT 50)`;

async function personDetail(env, code) {
  const person = await env.DB.prepare(`
    SELECT id, kind, code, name, class, phone, status, details, joined_on, left_on, created_from, created_at
    FROM people WHERE code = ?1 AND status <> 'Cancelled'`).bind(code).first();
  if (!person) return json({ ok: false, error: `${code} was not found.` }, 404);
  const { id, details, ...rest } = person;
  let parsed = {};
  try { parsed = JSON.parse(details || '{}'); } catch { /* keep empty */ }
  const school = typeof parsed.school === 'string' && parsed.school.trim() ? parsed.school.trim() : null;
  const statements = [env.DB.prepare(PERSON_ENTRIES_SQL).bind(id)];
  if (person.kind === 'student') statements.push(env.DB.prepare(CLASS_EXAMS_SQL).bind(person.class, school));
  const [own, exams] = await env.DB.batch(statements);
  const first = (r) => (r && r.results && r.results[0]) || null;
  const body = `{"ok":true,"month":${JSON.stringify(monthLabel(indiaToday()))},`
    + `"person":${JSON.stringify({ ...rest, details: parsed })},`
    + `"entries":${(first(own) && first(own).entries) || '[]'},`
    + `"class_exams":${(first(exams) && first(exams).entries) || '[]'}}`;
  return new Response(body, { headers: JSON_HEADERS });
}

/* ---------------- Analytics ---------------- */

async function analytics(env) {
  const today = indiaToday();
  const month = today.slice(0, 7);
  const label = monthLabel(today);
  const prevMonth = shiftMonth(month, -1);
  const since6 = `${shiftMonth(month, -5)}-01`;
  const since12 = `${shiftMonth(month, -11)}-01`;
  const since3 = `${shiftMonth(month, -2)}-01`;
  const q = (sql, ...params) => env.DB.prepare(sql).bind(...params);

  const [
    feesByMonth, payByMonth, otherByMonth, otherTypes, feesByMode, people, byClass, counts, notPaid,
    sources, conversion, leftReasons, marks, complaints,
  ] = await env.DB.batch([
    q(`SELECT substr(entry_date, 1, 7) AS month, SUM(amount) AS amount, COUNT(*) AS n FROM entries
       WHERE type = 'fee' AND status = 'Active' AND entry_date >= ?1 GROUP BY 1 ORDER BY 1`, since6),
    q(`SELECT substr(entry_date, 1, 7) AS month, SUM(amount) AS amount, COUNT(*) AS n FROM entries
       WHERE type = 'teacher_payment' AND status = 'Active' AND entry_date >= ?1 GROUP BY 1 ORDER BY 1`, since6),
    q(`SELECT substr(entry_date, 1, 7) AS month, SUM(amount) AS amount, COUNT(*) AS n FROM entries
       WHERE type = 'expense' AND status = 'Active' AND entry_date >= ?1 GROUP BY 1 ORDER BY 1`, since6),
    q(`SELECT COALESCE(json_extract(data, '$.what_for'), 'Not given') AS label, SUM(amount) AS amount, COUNT(*) AS n
       FROM entries WHERE type = 'expense' AND status = 'Active' AND substr(entry_date, 1, 7) = ?1 AND amount IS NOT NULL
       GROUP BY 1 ORDER BY 2 DESC`, month),
    q(`SELECT COALESCE(json_extract(data, '$.mode'), 'Not given') AS label, SUM(amount) AS amount, COUNT(*) AS n
       FROM entries WHERE type = 'fee' AND status = 'Active' AND substr(entry_date, 1, 7) = ?1 AND amount IS NOT NULL
       GROUP BY 1 ORDER BY 2 DESC`, month),
    q(`SELECT kind, status, COUNT(*) AS n FROM people WHERE status <> 'Cancelled' GROUP BY kind, status`),
    q(`SELECT COALESCE(class, 'Not set') AS label, COUNT(*) AS n FROM people
       WHERE kind = 'student' AND status = 'Active' GROUP BY 1 ORDER BY 2 DESC`),
    q(`SELECT type, substr(entry_date, 1, 7) AS month, COUNT(*) AS n FROM entries
       WHERE type IN ('enquiry', 'admission', 'student_left', 'complaint') AND status = 'Active'
         AND substr(entry_date, 1, 7) IN (?1, ?2) GROUP BY 1, 2`, month, prevMonth),
    q(`SELECT p.code, p.name, p.class, p.phone, json_extract(p.details, '$.fee_plan') AS plan,
         json_extract(p.details, '$.fee_amount') AS fee_amount,
         (SELECT MAX(e.entry_date) FROM entries e WHERE e.person_id = p.id AND e.type = 'fee' AND e.status = 'Active') AS last_paid_on
       FROM people p
       WHERE p.kind = 'student' AND p.status = 'Active'
         AND NOT EXISTS (SELECT 1 FROM entries e WHERE e.person_id = p.id AND e.type = ?1 AND e.status = 'Active' AND ${coversMonth(2, 3, 4)})
       ORDER BY p.class, p.name`, 'fee', '$.fee_for', label, month),
    q(`SELECT COALESCE(json_extract(data, '$.source'), 'Not asked') AS label, COUNT(*) AS n FROM entries
       WHERE type = 'enquiry' AND status = 'Active' AND entry_date >= ?1 GROUP BY 1 ORDER BY 2 DESC`, since6),
    q(`SELECT COUNT(*) AS enquiries,
         COALESCE(SUM(EXISTS (SELECT 1 FROM people p WHERE p.kind = 'student' AND p.status <> 'Cancelled'
           AND p.name_key = lower(e.name)
           AND ((e.phone IS NOT NULL AND p.phone = e.phone) OR p.class IS json_extract(e.data, '$.class')))), 0) AS joined
       FROM entries e WHERE e.type = 'enquiry' AND e.status = 'Active' AND e.entry_date >= ?1`, since6),
    q(`SELECT COALESCE(json_extract(data, '$.reason'), 'Not given') AS label, COUNT(*) AS n FROM entries
       WHERE type = 'student_left' AND status = 'Active' AND entry_date >= ?1 GROUP BY 1 ORDER BY 2 DESC`, since12),
    q(`WITH m AS (
         SELECT e.person_id, e.entry_date, COALESCE(json_extract(e.data, '$.test'), json_extract(e.data, '$.exam')) AS test,
           json_extract(e.data, '$.subject') AS subject,
           100.0 * json_extract(e.data, '$.marks') / json_extract(e.data, '$.out_of') AS pct,
           ROW_NUMBER() OVER (PARTITION BY e.person_id ORDER BY e.entry_date DESC, e.id DESC) AS rn
         FROM entries e WHERE e.type = 'marks' AND e.status = 'Active' AND e.person_id IS NOT NULL
           AND json_extract(e.data, '$.marks') IS NOT NULL AND json_extract(e.data, '$.out_of') > 0)
       SELECT p.code, p.name, p.class, a.test, a.subject, a.entry_date, ROUND(a.pct) AS pct, ROUND(b.pct) AS prev_pct
       FROM m a JOIN people p ON p.id = a.person_id
       LEFT JOIN m b ON b.person_id = a.person_id AND b.rn = 2
       WHERE a.rn = 1 AND p.status = 'Active' AND (a.pct < 40 OR (b.pct IS NOT NULL AND a.pct <= b.pct - 10))
       ORDER BY a.pct ASC LIMIT 25`),
    q(`SELECT COALESCE(json_extract(data, '$.about'), 'Not given') AS label, COUNT(*) AS n FROM entries
       WHERE type = 'complaint' AND status = 'Active' AND entry_date >= ?1 GROUP BY 1 ORDER BY 2 DESC`, since3),
  ]);

  const rows = (r) => (r && r.results) || [];
  const months = Array.from({ length: 6 }, (_, i) => shiftMonth(month, i - 5));
  const series = (r) => {
    const map = Object.fromEntries(rows(r).map((x) => [x.month, x]));
    return months.map((m) => ({ month: m, label: monthLabel(`${m}-01`), amount: map[m] ? map[m].amount || 0 : 0, n: map[m] ? map[m].n : 0 }));
  };
  const count = (kind, status) => rows(people).filter((x) => x.kind === kind && (!status || x.status === status)).reduce((s, x) => s + x.n, 0);
  const countOf = (type, m) => {
    const hit = rows(counts).find((x) => x.type === type && x.month === m);
    return hit ? hit.n : 0;
  };
  const due = rows(notPaid).filter((s) => isDue(s, today));
  const conv = rows(conversion)[0] || { enquiries: 0, joined: 0 };

  return json({
    ok: true,
    today,
    month,
    month_label: label,
    prev_month_label: monthLabel(`${prevMonth}-01`),
    fees: series(feesByMonth),
    teacher_payments: series(payByMonth),
    other_payments: series(otherByMonth),
    other_types: rows(otherTypes),
    fee_modes: rows(feesByMode),
    students: { active: count('student', 'Active'), left: count('student', 'Left') },
    teachers: { active: count('teacher', 'Active'), left: count('teacher', 'Left') },
    by_class: rows(byClass),
    this_month: {
      enquiries: countOf('enquiry', month), admissions: countOf('admission', month),
      left: countOf('student_left', month), complaints: countOf('complaint', month),
    },
    last_month: {
      enquiries: countOf('enquiry', prevMonth), admissions: countOf('admission', prevMonth),
      left: countOf('student_left', prevMonth), complaints: countOf('complaint', prevMonth),
    },
    not_paid: due,
    enquiry_sources: rows(sources),
    conversion: { enquiries: conv.enquiries || 0, joined: conv.joined || 0 },
    left_reasons: rows(leftReasons),
    marks_attention: rows(marks),
    complaints: rows(complaints),
  });
}

// Should this student have paid by now? Monthly (or no plan given): every month.
// Longer plans: when the last payment is older than the plan's period. One time: only if never paid.
function isDue(student, today) {
  const plan = student.plan || 'Monthly';
  if (plan === 'Monthly') return true;
  if (!student.last_paid_on) return true;
  if (plan === 'One time') return false;
  const months = { 'Every 3 months': 3, 'Every 6 months': 6, Yearly: 12 }[plan] || 1;
  return student.last_paid_on < `${shiftMonth(today.slice(0, 7), -months)}${today.slice(7)}`;
}

function shiftMonth(yyyymm, by) {
  const [y, m] = yyyymm.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + by, 1));
  return d.toISOString().slice(0, 7);
}

/* ---------------- The Tasks board ---------------- */

const TASK_JSON = `json_object(
  'code', code, 'title', title, 'notes', notes, 'stage', stage, 'due_on', due_on, 'owner', owner,
  'position', position, 'created_at', created_at, 'updated_at', updated_at, 'done_at', done_at)`;
const TASK_FIELDS = 'code, title, notes, stage, due_on, owner, position, created_at, updated_at, done_at';
const DONE_SHOWN = 100;
const EXAM_DAYS_AHEAD = 45;

// The open tasks, the latest done ones, names used before for "Who", and the exams coming up.
const BOARD_SQL = `
SELECT
  (SELECT json_group_array(${TASK_JSON}) FROM (
     SELECT * FROM tasks WHERE stage IN ('To do', 'Doing') ORDER BY position, id DESC)) AS open,
  (SELECT json_group_array(${TASK_JSON}) FROM (
     SELECT * FROM tasks WHERE stage = 'Done' ORDER BY position, id DESC LIMIT ${DONE_SHOWN})) AS done,
  (SELECT COUNT(*) FROM tasks WHERE stage = 'Done') AS done_total,
  (SELECT json_group_array(owner) FROM (
     SELECT owner, MAX(id) AS last FROM tasks WHERE owner IS NOT NULL GROUP BY lower(owner) ORDER BY last DESC LIMIT 12)) AS owners,
  (SELECT json_group_array(json_object(
     'code', x.code, 'starts_on', x.starts_on, 'ends_on', x.ends_on, 'exam', x.exam, 'class', x.class,
     'school', x.school, 'subjects', x.subjects, 'student_name', x.student_name, 'person_code', x.person_code))
   FROM (
     SELECT e.code, e.id,
       COALESCE(e.entry_date, json_extract(e.data, '$.ends_on')) AS starts_on,
       COALESCE(json_extract(e.data, '$.ends_on'), e.entry_date) AS ends_on,
       json_extract(e.data, '$.exam') AS exam,
       COALESCE(json_extract(e.data, '$.class'), p.class) AS class,
       json_extract(e.data, '$.school') AS school,
       json_extract(e.data, '$.subjects') AS subjects,
       COALESCE(p.name, e.name) AS student_name, p.code AS person_code
     FROM entries e LEFT JOIN people p ON p.id = e.person_id
     WHERE e.type = 'exam' AND e.status = 'Active'
       AND COALESCE(json_extract(e.data, '$.ends_on'), e.entry_date) >= ?1
       AND COALESCE(e.entry_date, json_extract(e.data, '$.ends_on')) <= ?2
       AND (p.id IS NULL OR p.status = 'Active')
     ORDER BY starts_on, e.id
     LIMIT 40) AS x) AS exams`;

async function tasksBoard(env) {
  const today = indiaToday();
  const row = await env.DB.prepare(BOARD_SQL).bind(today, addDaysIso(today, EXAM_DAYS_AHEAD)).first();
  const body = `{"ok":true,"today":${JSON.stringify(today)},"exam_days":${EXAM_DAYS_AHEAD},`
    + `"open":${(row && row.open) || '[]'},"done":${(row && row.done) || '[]'},`
    + `"done_total":${row ? Number(row.done_total) : 0},"owners":${(row && row.owners) || '[]'},`
    + `"exams":${(row && row.exams) || '[]'}}`;
  return new Response(body, { headers: JSON_HEADERS });
}

const ALL_STAGES = [...TASK_STAGES, 'Removed'];
const TASK_LIMITS = { title: 200, notes: 2000, owner: 60 };

// Checks the parts of a task that were sent. Returns { ok, value } or { ok: false, error, fields }.
function cleanTask(input, creating) {
  const value = {};
  const fields = {};
  const text = (key, oneLine) => {
    if (!(key in input) || input[key] === null || input[key] === undefined) return;
    if (typeof input[key] !== 'string') { fields[key] = 'Please type this again.'; return; }
    const t = oneLine ? input[key].replace(/\s+/g, ' ').trim() : input[key].replace(/\r\n?/g, '\n').trim();
    if (t.length > TASK_LIMITS[key]) fields[key] = `Please keep this under ${TASK_LIMITS[key]} letters.`;
    else value[key] = t || null;
  };
  text('title', true);
  text('notes', false);
  text('owner', true);
  if ((creating || 'title' in input) && !value.title && !fields.title) fields.title = 'Write what needs doing.';
  if ('due_on' in input && input.due_on !== undefined) {
    const d = input.due_on === null ? '' : String(input.due_on).trim();
    if (d && !isRealDate(d)) fields.due_on = 'Pick a date.';
    else value.due_on = d || null;
  }
  if (!creating && 'stage' in input) {
    if (!ALL_STAGES.includes(input.stage)) fields.stage = 'Choose To do, Doing or Done.';
    else value.stage = input.stage;
  }
  if (!creating && 'position' in input && input.position !== null && input.position !== undefined) {
    const n = Number(input.position);
    if (!Number.isFinite(n) || Math.abs(n) > 1e12) fields.position = 'Bad position.';
    else value.position = n;
  }
  if (Object.keys(fields).length) {
    return { ok: false, error: fields.title || 'Please check the task.', fields };
  }
  return { ok: true, value };
}

const CREATE_TASK_SQL = `
INSERT INTO tasks (seq, code, title, notes, due_on, owner, stage, position, client_id)
SELECT nx.n, printf('TSK-%04d', nx.n), ?1, ?2, ?3, ?4, 'To do',
  COALESCE((SELECT MIN(position) FROM tasks WHERE stage = 'To do'), 1) - 1, ?5
FROM (SELECT COALESCE(MAX(seq), 0) + 1 AS n FROM tasks) AS nx
WHERE true
ON CONFLICT (client_id) DO NOTHING
RETURNING ${TASK_FIELDS}`;

async function createTask(request, env) {
  if (request.headers.get('x-successpath') !== '1') {
    return json({ ok: false, error: 'Please use the SuccessPath page to add tasks.' }, 400);
  }
  const body = await readJson(request);
  if (!body.ok) return json({ ok: false, error: body.error }, 400);
  const input = body.value;
  if (!isClientId(input.client_id)) return json({ ok: false, error: 'Please reload the page and try again.' }, 400);
  const checked = cleanTask(input, true);
  if (!checked.ok) return json({ ok: false, error: checked.error, fields: checked.fields }, 422);
  const t = checked.value;
  const created = await env.DB.prepare(CREATE_TASK_SQL)
    .bind(t.title, t.notes ?? null, t.due_on ?? null, t.owner ?? null, input.client_id)
    .first();
  if (created) return json({ ok: true, task: created }, 201);
  // Sent twice (for example after a weak connection): return the task saved the first time.
  const existing = await env.DB.prepare(`SELECT ${TASK_FIELDS} FROM tasks WHERE client_id = ?1`).bind(input.client_id).first();
  if (!existing) return json({ ok: false, error: 'Please reload the page and try again.' }, 409);
  return json({ ok: true, duplicate: true, task: existing });
}

async function updateTask(request, env, code) {
  if (request.headers.get('x-successpath') !== '1') {
    return json({ ok: false, error: 'Please use the SuccessPath page.' }, 400);
  }
  const body = await readJson(request);
  if (!body.ok) return json({ ok: false, error: body.error }, 400);
  const checked = cleanTask(body.value, false);
  if (!checked.ok) return json({ ok: false, error: checked.error, fields: checked.fields }, 422);
  const t = checked.value;

  const sets = [];
  const params = [code];
  const param = (v) => {
    params.push(v);
    return `?${params.length}`;
  };
  for (const key of ['title', 'notes', 'owner', 'due_on']) {
    if (key in t) sets.push(`${key} = ${param(t[key])}`);
  }
  if ('stage' in t) {
    const s = param(t.stage);
    sets.push(`stage = ${s}`);
    sets.push(`done_at = CASE WHEN ${s} = 'Done' THEN COALESCE(done_at, ${NOW}) WHEN ${s} = 'Removed' THEN done_at ELSE NULL END`);
    // Moved to another column without saying where: put it at the top.
    if (!('position' in t)) {
      sets.push(`position = CASE WHEN stage = ${s} THEN position
        ELSE COALESCE((SELECT MIN(t2.position) FROM tasks t2 WHERE t2.stage = ${s}), 1) - 1 END`);
    }
  }
  if ('position' in t) sets.push(`position = ${param(t.position)}`);
  if (!sets.length) return json({ ok: false, error: 'Nothing to change.' }, 400);
  sets.push(`updated_at = ${NOW}`);

  const updated = await env.DB.prepare(`UPDATE tasks SET ${sets.join(', ')} WHERE code = ?1 RETURNING ${TASK_FIELDS}`)
    .bind(...params)
    .first();
  if (!updated) return json({ ok: false, error: `Task ${code} was not found.` }, 404);
  return json({ ok: true, task: updated });
}

function addDaysIso(isoDate, days) {
  const [y, m, d] = isoDate.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/* ---------------- Feeds for the Google Sheet ---------------- */

// Every change after `after`, oldest first, with the entry as it is now.
// The JSON is built inside the database so the server does almost no work (the free plan
// allows 10 ms of processing per request).
const SYNC_SQL = `
WITH h AS (
  SELECT id, entry_id FROM entry_history WHERE id > ?1 ORDER BY id LIMIT ?2
)
SELECT
  (SELECT COUNT(*) FROM h) AS n,
  (SELECT MAX(id) FROM h) AS last_id,
  (SELECT COALESCE(MAX(id), 0) FROM people_history) AS people_version,
  (SELECT COALESCE(MAX(id), 0) FROM task_history) AS tasks_version,
  (SELECT json_group_array(json_object(
      'log_id', h.id,
      'entry', json_object(
        'id', e.id, 'type', e.type, 'seq', e.seq, 'code', e.code, 'status', e.status,
        'data', json(e.data), 'created_at', e.created_at, 'updated_at', e.updated_at,
        'cancelled_at', e.cancelled_at, 'cancel_reason', e.cancel_reason,
        'person_code', (SELECT p.code FROM people p WHERE p.id = e.person_id))))
   FROM h JOIN entries e ON e.id = h.entry_id) AS changes`;

// Pages are kept small so one page always stays under D1's 2 MB limit for a single value,
// even if every entry had long notes.
const MAX_PAGE = 150;

async function syncFeed(env, url) {
  const after = readInt(url.searchParams.get('after'), 0, 0, Number.MAX_SAFE_INTEGER);
  const limit = readInt(url.searchParams.get('limit'), 100, 1, MAX_PAGE);
  const row = await env.DB.prepare(SYNC_SQL).bind(after, limit).first();
  const count = row ? Number(row.n) : 0;
  const lastId = row && row.last_id !== null && row.last_id !== undefined ? Number(row.last_id) : after;
  const body = `{"ok":true,"version":${JSON.stringify(APP_VERSION)},"schema":${SCHEMA_JSON},`
    + `"people_version":${row ? Number(row.people_version) : 0},"tasks_version":${row ? Number(row.tasks_version) : 0},`
    + `"changes":${(row && row.changes) || '[]'},"next_after":${lastId},"has_more":${count >= limit}}`;
  return new Response(body, { headers: JSON_HEADERS });
}

// One page of all entries, by id. Used for nightly backups and for rebuilding the sheet.
const EXPORT_SQL = `
WITH e AS (
  SELECT * FROM entries WHERE id > ?1 ORDER BY id LIMIT ?2
)
SELECT
  (SELECT COUNT(*) FROM e) AS n,
  (SELECT MAX(id) FROM e) AS last_id,
  (SELECT COALESCE(MAX(id), 0) FROM entry_history) AS max_log_id,
  (SELECT COALESCE(MAX(id), 0) FROM people_history) AS people_version,
  (SELECT COALESCE(MAX(id), 0) FROM task_history) AS tasks_version,
  (SELECT COUNT(*) FROM entries) AS total,
  (SELECT json_group_array(json_object(
      'id', id, 'type', type, 'seq', seq, 'code', code, 'status', status,
      'entry_date', entry_date, 'name', name, 'phone', phone, 'amount', amount,
      'data', json(data), 'client_id', client_id, 'person_id', person_id,
      'person_code', (SELECT p.code FROM people p WHERE p.id = e.person_id),
      'created_at', created_at, 'updated_at', updated_at,
      'cancelled_at', cancelled_at, 'cancel_reason', cancel_reason))
   FROM e) AS entries`;

async function exportPage(env, url) {
  const after = readInt(url.searchParams.get('after_id'), 0, 0, Number.MAX_SAFE_INTEGER);
  const limit = readInt(url.searchParams.get('limit'), 100, 1, MAX_PAGE);
  const row = await env.DB.prepare(EXPORT_SQL).bind(after, limit).first();
  const count = row ? Number(row.n) : 0;
  const lastId = row && row.last_id !== null && row.last_id !== undefined ? Number(row.last_id) : after;
  const body = `{"ok":true,"version":${JSON.stringify(APP_VERSION)},"schema":${SCHEMA_JSON},`
    + `"exported_at":${JSON.stringify(new Date().toISOString())},`
    + `"total":${row ? Number(row.total) : 0},"max_log_id":${row ? Number(row.max_log_id) : 0},`
    + `"people_version":${row ? Number(row.people_version) : 0},"tasks_version":${row ? Number(row.tasks_version) : 0},`
    + `"entries":${(row && row.entries) || '[]'},"next_after_id":${lastId},"has_more":${count >= limit}}`;
  return new Response(body, { headers: JSON_HEADERS });
}

// One page of the registers (every student and teacher, with their totals).
const REGISTERS_SQL = `
WITH p AS (
  SELECT * FROM people WHERE id > ?1 ORDER BY id LIMIT ?2
)
SELECT
  (SELECT COUNT(*) FROM p) AS n,
  (SELECT MAX(id) FROM p) AS last_id,
  (SELECT json_group_array(json_object(
      'id', p.id, 'kind', p.kind, 'seq', p.seq, 'code', p.code, 'name', p.name, 'name_key', p.name_key,
      'class', p.class, 'phone', p.phone, 'status', p.status, 'details', json(p.details),
      'joined_on', p.joined_on, 'left_on', p.left_on, 'created_from', p.created_from,
      'created_at', p.created_at, 'updated_at', p.updated_at,
      'total_paid', (SELECT COALESCE(SUM(e.amount), 0) FROM entries e WHERE e.person_id = p.id AND e.status = 'Active'
                     AND e.type = CASE p.kind WHEN 'student' THEN 'fee' ELSE 'teacher_payment' END),
      'payments', (SELECT COUNT(*) FROM entries e WHERE e.person_id = p.id AND e.status = 'Active'
                     AND e.type = CASE p.kind WHEN 'student' THEN 'fee' ELSE 'teacher_payment' END),
      'last_paid_on', (SELECT MAX(e.entry_date) FROM entries e WHERE e.person_id = p.id AND e.status = 'Active'
                     AND e.type = CASE p.kind WHEN 'student' THEN 'fee' ELSE 'teacher_payment' END),
      'last_amount', (SELECT e.amount FROM entries e WHERE e.person_id = p.id AND e.status = 'Active'
                     AND e.type = CASE p.kind WHEN 'student' THEN 'fee' ELSE 'teacher_payment' END
                     ORDER BY e.entry_date DESC, e.id DESC LIMIT 1),
      'tests', (SELECT COUNT(*) FROM entries e WHERE e.person_id = p.id AND e.type = 'marks' AND e.status = 'Active'),
      'last_percent', ${LAST_PERCENT},
      'notes', (SELECT COUNT(*) FROM entries e WHERE e.person_id = p.id AND e.type = 'note' AND e.status = 'Active')))
   FROM p) AS people`;

async function registersPage(env, url) {
  const after = readInt(url.searchParams.get('after_id'), 0, 0, Number.MAX_SAFE_INTEGER);
  const limit = readInt(url.searchParams.get('limit'), 100, 1, MAX_PAGE);
  const row = await env.DB.prepare(REGISTERS_SQL).bind(after, limit).first();
  const count = row ? Number(row.n) : 0;
  const lastId = row && row.last_id !== null && row.last_id !== undefined ? Number(row.last_id) : after;
  const body = `{"ok":true,"people":${(row && row.people) || '[]'},"next_after_id":${lastId},"has_more":${count >= limit}}`;
  return new Response(body, { headers: JSON_HEADERS });
}

// One page of every task, including removed ones, by id. Used by the Google Sheet and the backups.
const TASKS_EXPORT_SQL = `
WITH t AS (
  SELECT * FROM tasks WHERE id > ?1 ORDER BY id LIMIT ?2
)
SELECT
  (SELECT COUNT(*) FROM t) AS n,
  (SELECT MAX(id) FROM t) AS last_id,
  (SELECT COALESCE(MAX(id), 0) FROM task_history) AS tasks_version,
  (SELECT json_group_array(json_object(
      'id', id, 'seq', seq, 'code', code, 'title', title, 'notes', notes, 'stage', stage,
      'due_on', due_on, 'owner', owner, 'position', position, 'client_id', client_id,
      'created_at', created_at, 'updated_at', updated_at, 'done_at', done_at))
   FROM t) AS tasks`;

async function tasksExportPage(env, url) {
  const after = readInt(url.searchParams.get('after_id'), 0, 0, Number.MAX_SAFE_INTEGER);
  const limit = readInt(url.searchParams.get('limit'), 100, 1, MAX_PAGE);
  const row = await env.DB.prepare(TASKS_EXPORT_SQL).bind(after, limit).first();
  const count = row ? Number(row.n) : 0;
  const lastId = row && row.last_id !== null && row.last_id !== undefined ? Number(row.last_id) : after;
  const body = `{"ok":true,"tasks_version":${row ? Number(row.tasks_version) : 0},`
    + `"tasks":${(row && row.tasks) || '[]'},"next_after_id":${lastId},"has_more":${count >= limit}}`;
  return new Response(body, { headers: JSON_HEADERS });
}

/* ---------------- Helpers ---------------- */

function checkSyncKey(request, env) {
  const key = typeof env.SYNC_KEY === 'string' ? env.SYNC_KEY : '';
  if (key.length < 20) {
    return json({ ok: false, error: 'The sync key is not set on the server. Run: npx wrangler secret put SYNC_KEY' }, 503);
  }
  const header = request.headers.get('authorization') || '';
  const given = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  return sameText(given, key) ? 'ok' : json({ ok: false, error: 'Wrong sync key.' }, 401);
}

async function readJson(request) {
  const type = request.headers.get('content-type') || '';
  if (!type.includes('application/json')) return { ok: false, error: 'Expected JSON.' };
  const declared = Number(request.headers.get('content-length') || 0);
  if (declared > MAX_BODY_CHARS) return { ok: false, error: 'This entry is too long.' };
  const text = await request.text();
  if (text.length > MAX_BODY_CHARS) return { ok: false, error: 'This entry is too long.' };
  try {
    const value = JSON.parse(text);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return { ok: false, error: 'Expected an object.' };
    return { ok: true, value };
  } catch {
    return { ok: false, error: 'The entry could not be read.' };
  }
}

function isClientId(value) {
  return typeof value === 'string' && /^[A-Za-z0-9-]{8,64}$/.test(value);
}

function isToken(value) {
  return typeof value === 'string' && /^[a-f0-9]{32,128}$/.test(value);
}

function readInt(value, fallback, min, max) {
  const n = Number.parseInt(value ?? '', 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(n, min), max);
}

async function sha256Hex(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Compares two strings in a way that takes the same time whether they match or not.
function sameText(a, b) {
  const length = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < length; i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

function json(value, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: JSON_HEADERS });
}

function methodNotAllowed(allowed) {
  return new Response(JSON.stringify({ ok: false, error: `Use ${allowed}.` }), {
    status: 405,
    headers: { ...JSON_HEADERS, allow: allowed },
  });
}
