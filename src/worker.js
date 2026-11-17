// SuccessPath Classes: the server.
//
// Runs on Cloudflare Workers. The web page in /public is served by Cloudflare directly;
// this file only answers the /api/ addresses:
//
//   POST /api/entries               save a new entry, and add or update the student/teacher it is about
//   POST /api/entries/<id>/cancel   mark an entry as cancelled (only from the device that saved it)
//   GET  /api/people?kind=student   the Students (or Teachers) list
//   GET  /api/people/<STU-0001>     one student or teacher with their full history
//   POST /api/people/<STU-0001>     change their details (name, class, phone, fee plan and so on)
//   POST /api/people/<STU-0001>/delete   delete a student or teacher added by mistake, with a note
//   POST /api/people/<STU-0001>/restore  put a deleted student or teacher back, with their entries
//   GET  /api/log                   the Activity log: everything saved by the office, teachers and students
//   GET  /api/analytics             numbers for the Analytics page
//   GET  /api/calendar?month=YYYY-MM teachers' leave and holidays in a month, for the leave calendar
//   GET  /api/tasks                 the Tasks board, with the exams coming up
//   POST /api/tasks                 add a task
//   POST /api/tasks/<TSK-0001>      change a task: move it, edit it, or remove it from the board
//   GET  /api/health                quick check that the server and database are working
//   POST /api/login                 log in: the office (password), a teacher or a student (username + password)
//   POST /api/logout                log out on this device
//   GET  /api/session?role=admin    is this device logged in (and are logins switched on)?
//   GET  /api/portal/teacher        the teacher portal: their details, leave and holidays (no salary)
//   GET  /api/portal/teacher/students        current students, with "mine" for the teacher's classes
//   GET  /api/portal/teacher/students/<STU>  one student's marks, exam dates and messages to this teacher
//   GET  /api/portal/teacher/enquiries       messages from students to this teacher, and exam dates
//   GET  /api/portal/student        the student portal: their details, marks, exam dates, teachers, messages
//   POST /api/portal/student/messages        send a teacher a message
//   POST /api/portal/student/exams           add an exam date
//   GET  /api/portal/teacher/calendar?month= the leave calendar, for a teacher
//   GET  /api/portal/teacher/leave           their leave requests, leave and the holidays
//   POST /api/portal/teacher/leave-requests  ask for leave; it waits for the office
//   POST /api/portal/teacher/leave-requests/<LRQ>/withdraw
//   GET  /api/leave-requests        the office: leave requests waiting (?status=all for the latest)
//   POST /api/leave-requests/<LRQ>  the office: {"action":"approve"} or {"action":"decline","note":"..."}
//
// Logins switch on when ADMIN_PASSWORD is set (npx wrangler secret put ADMIN_PASSWORD). Until then
// the office pages stay open, as before, and the portals stay closed.
//   GET  /api/sync                  changes since the last sync       (Google Sheet only, needs SYNC_KEY)
//   GET  /api/export                every entry, page by page         (Google Sheet backups, needs SYNC_KEY)
//   GET  /api/registers             every student and teacher         (Google Sheet, needs SYNC_KEY)
//   GET  /api/tasks-export          every task, page by page          (Google Sheet, needs SYNC_KEY)

import {
  APP_NAME, APP_VERSION, PEOPLE, TASK_STAGES, getForm, getPeople, validateEntry, swapForMinus, fixedColumns, sheetSchema,
  classesFromText, MESSAGE_KINDS,
  indiaToday, nameKey, monthLabel, isRealDate, feeIsDue, PERSON_EDIT_FIELDS, validatePersonEdit,
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
      // a missing table, or a status the old people table does not allow yet (before migration 0004)
      if (/no such (table|column)/i.test(message) || (/CHECK constraint failed: status IN/i.test(message) && !/'Demo'/.test(message))) {
        return json({ ok: false, error: 'The database is not up to date yet. Run: npm run db:setup' }, 503);
      }
      if (/UNIQUE constraint failed: people\.kind, people\.name_key/i.test(message)) {
        return json({ ok: false, error: 'Someone else in the list already has this full name. Add a surname or initial to tell them apart.' }, 409);
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
    return json({ ok: true, app: APP_NAME, version: APP_VERSION, logins: loginsOn(env) });
  }

  if (path === '/api/login') {
    if (method !== 'POST') return methodNotAllowed('POST');
    return login(request, env);
  }
  if (path === '/api/logout') {
    if (method !== 'POST') return methodNotAllowed('POST');
    return logout(request, env);
  }
  if (path === '/api/session') {
    if (method !== 'GET') return methodNotAllowed('GET');
    return session(request, env, url);
  }
  if (path === '/api/portal/teacher' || path.startsWith('/api/portal/teacher/')
    || path === '/api/portal/student' || path.startsWith('/api/portal/student/')) {
    return portalApi(request, env, path, method);
  }

  if (path === '/api/entries') {
    if (method !== 'POST') return methodNotAllowed('POST');
    const denied = await checkAdmin(request, env);
    return denied || createEntry(request, env);
  }

  const cancel = /^\/api\/entries\/([A-Z]{2,5}-\d{1,12})\/cancel$/.exec(path);
  if (cancel) {
    if (method !== 'POST') return methodNotAllowed('POST');
    const denied = await checkAdmin(request, env);
    return denied || cancelEntry(request, env, cancel[1]);
  }

  const editing = /^\/api\/people\/((?:STU|TR)-\d{1,12})$/.exec(path);
  if (editing && method === 'POST') {
    const denied = await checkAdmin(request, env);
    return denied || editPerson(request, env, editing[1]);
  }

  const removing = /^\/api\/people\/((?:STU|TR)-\d{1,12})\/(delete|restore)$/.exec(path);
  if (removing) {
    if (method !== 'POST') return methodNotAllowed('POST');
    const denied = await checkAdmin(request, env);
    if (denied) return denied;
    return removing[2] === 'delete' ? deletePerson(request, env, removing[1]) : restorePerson(request, env, removing[1]);
  }

  if (path === '/api/log') {
    if (method !== 'GET') return methodNotAllowed('GET');
    const denied = await checkAdmin(request, env);
    return denied || activityLog(env, url);
  }

  if (path === '/api/people' || path.startsWith('/api/people/') || path === '/api/analytics' || path === '/api/calendar') {
    if (method !== 'GET') return methodNotAllowed('GET');
    const denied = await checkAdmin(request, env);
    if (denied) return denied;
    if (path === '/api/analytics') return analytics(env);
    if (path === '/api/calendar') return leaveCalendar(env, url);
    if (path === '/api/people') return peopleList(env, url);
    const code = /^\/api\/people\/((?:STU|TR)-\d{1,12})$/.exec(path);
    return code ? personDetail(env, code[1]) : json({ ok: false, error: 'Not found' }, 404);
  }

  if (path === '/api/notices' || path === '/api/notices/seen') {
    if (method !== (path === '/api/notices' ? 'GET' : 'POST')) return methodNotAllowed(path === '/api/notices' ? 'GET' : 'POST');
    const denied = await checkAdmin(request, env);
    return denied || (path === '/api/notices' ? notices(env, 'office', null) : noticesSeen(env, 'office', null));
  }

  if (path === '/api/leave-requests') {
    if (method !== 'GET') return methodNotAllowed('GET');
    const denied = await checkAdmin(request, env);
    return denied || listLeaveRequests(env, url);
  }
  const deciding = /^\/api\/leave-requests\/(LRQ-\d{1,12})$/.exec(path);
  if (deciding) {
    if (method !== 'POST') return methodNotAllowed('POST');
    const denied = await checkAdmin(request, env);
    return denied || decideLeaveRequest(request, env, deciding[1]);
  }

  // The Tasks board is shared by the office and the teachers.
  if (path === '/api/tasks') {
    if (method !== 'GET' && method !== 'POST') return methodNotAllowed('GET, POST');
    const who = await tasksUser(request, env);
    if (who.response) return who.response;
    return method === 'POST' ? createTask(request, env, who.name) : tasksBoard(env);
  }

  const task = /^\/api\/tasks\/(TSK-\d{1,12})$/.exec(path);
  if (task) {
    if (method !== 'POST') return methodNotAllowed('POST');
    const who = await tasksUser(request, env);
    if (who.response) return who.response;
    return updateTask(request, env, task[1], who.name);
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

/* ---------------- Logins ---------------- */

// The office (Papa) logs in with ADMIN_PASSWORD. Teachers and students log in with a username,
// their name and the year they joined (for example ayushsingh2026), and the shared portal password
// (PORTAL_PASSWORD, or 1234 when it is not set). A login is remembered in a cookie signed with a
// key made from SYNC_KEY and ADMIN_PASSWORD, so changing the admin password logs everyone out.
const COOKIE = { admin: 'sp_admin', teacher: 'sp_teacher', student: 'sp_student' };
const SESSION_DAYS = { admin: 365, teacher: 180, student: 180 };
const DEFAULT_PORTAL_PASSWORD = '1234';
const WRONG_TRIES = { admin: 10, teacher: 30, student: 30 }; // per 15 minutes from one address
const ROLES = ['admin', 'teacher', 'student'];

function loginsOn(env) {
  return typeof env.ADMIN_PASSWORD === 'string' && env.ADMIN_PASSWORD.length > 0
    && typeof env.SYNC_KEY === 'string' && env.SYNC_KEY.length >= 20;
}

const keyCache = { id: '', key: null };
async function sessionKey(env) {
  const id = `${env.SYNC_KEY}\u0000${env.ADMIN_PASSWORD}`;
  if (keyCache.id !== id) {
    const raw = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`successpath-session\u0000${id}`));
    keyCache.key = await crypto.subtle.importKey('raw', raw, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
    keyCache.id = id;
  }
  return keyCache.key;
}

function b64url(bytes) {
  let text = '';
  for (const b of bytes) text += String.fromCharCode(b);
  return btoa(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64url(text) {
  const plain = atob(text.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((text.length + 3) % 4));
  return Uint8Array.from(plain, (c) => c.charCodeAt(0));
}

async function makeSession(env, role, personId) {
  const expires = Math.floor(Date.now() / 1000) + SESSION_DAYS[role] * 86400;
  const body = b64url(new TextEncoder().encode(JSON.stringify({ r: role, p: personId || 0, e: expires })));
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', await sessionKey(env), new TextEncoder().encode(body)));
  return `${body}.${b64url(sig)}`;
}

function cookieValue(request, name) {
  for (const part of (request.headers.get('cookie') || '').split(';')) {
    const at = part.indexOf('=');
    if (at > 0 && part.slice(0, at).trim() === name) return part.slice(at + 1).trim();
  }
  return '';
}

function cookieHeader(request, name, value, maxAge) {
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
  return `${name}=${value}; Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=Lax${secure}`;
}

/** The person (or the office) logged in on this device for a role, or null. */
async function readSession(request, env, role) {
  if (!loginsOn(env)) return null;
  const raw = cookieValue(request, COOKIE[role]);
  const dot = raw.indexOf('.');
  if (dot < 1) return null;
  const body = raw.slice(0, dot);
  try {
    const ok = await crypto.subtle.verify('HMAC', await sessionKey(env), fromB64url(raw.slice(dot + 1)), new TextEncoder().encode(body));
    if (!ok) return null;
    const s = JSON.parse(new TextDecoder().decode(fromB64url(body)));
    if (!s || s.r !== role || !(s.e > Date.now() / 1000)) return null;
    return { role, personId: Number(s.p) || null };
  } catch {
    return null;
  }
}

// The office pages (forms, Students, Teachers, Analytics) go through here.
async function checkAdmin(request, env) {
  if (request.headers.get('x-successpath') !== '1') {
    return json({ ok: false, error: 'Please open the SuccessPath page.' }, 400);
  }
  if (!loginsOn(env)) return null; // no admin password yet: open, as before version 3
  if (await readSession(request, env, 'admin')) return null;
  return json({ ok: false, error: 'Please log in again.', login: 'admin' }, 401);
}

// The Tasks board: the office, or a teacher who is still teaching here.
async function tasksUser(request, env) {
  if (request.headers.get('x-successpath') !== '1') {
    return { response: json({ ok: false, error: 'Please open the SuccessPath page.' }, 400) };
  }
  if (!loginsOn(env)) return { name: 'Office' };
  const order = request.headers.get('x-successpath-as') === 'teacher' ? ['teacher', 'admin'] : ['admin', 'teacher'];
  for (const role of order) {
    const s = await readSession(request, env, role);
    if (!s) continue;
    if (role === 'admin') return { name: 'Office' };
    const t = await env.DB.prepare("SELECT name FROM people WHERE id = ?1 AND kind = 'teacher' AND status = 'Active'").bind(s.personId).first();
    if (t) return { name: t.name };
  }
  return { response: json({ ok: false, error: 'Please log in again.', login: order[0] }, 401) };
}

/* ---------------- Usernames for the portals ---------------- */

function usernameBase(name, year) {
  const letters = String(name || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z]/g, '');
  return `${letters || 'user'}${year}`;
}

function cleanUsername(text) {
  return String(text || '').toLowerCase().replace(/[\s._]+/g, '').replace(/[^a-z0-9-]/g, '').slice(0, 80);
}

// Name and the year they joined: ayushsingh2026. Two people with the same name and year: the later
// one gets -2, -3 and so on. Worked out each time, so it follows changes made in Edit details.
async function portalUsernames(env, kind) {
  const rows = (await env.DB.prepare(`
    SELECT id, seq, code, name, class, status, joined_on, created_at, details FROM people
    WHERE kind = ?1 AND status <> 'Cancelled' ORDER BY seq`).bind(kind).all()).results;
  const seen = new Map();
  for (const r of rows) {
    const base = usernameBase(r.name, String(r.joined_on || r.created_at || '').slice(0, 4) || '0000');
    const n = (seen.get(base) || 0) + 1;
    seen.set(base, n);
    r.username = n === 1 ? base : `${base}-${n}`;
  }
  return rows;
}

function portalPassword(env) {
  return typeof env.PORTAL_PASSWORD === 'string' && env.PORTAL_PASSWORD ? env.PORTAL_PASSWORD : DEFAULT_PORTAL_PASSWORD;
}

async function sameSecret(given, wanted) {
  return sameText(await sha256Hex(String(given || '')), await sha256Hex(String(wanted || '')));
}

async function login(request, env) {
  if (request.headers.get('x-successpath') !== '1') return json({ ok: false, error: 'Please open the SuccessPath page.' }, 400);
  const body = await readJson(request);
  if (!body.ok) return json({ ok: false, error: body.error }, 400);
  const { role, username, password } = body.value;
  if (!ROLES.includes(role)) return json({ ok: false, error: 'Unknown login.' }, 400);
  if (!loginsOn(env)) {
    if (role === 'admin') return json({ ok: true, role, open: true });
    return json({ ok: false, error: 'The portals are not open yet. Please ask the office.' }, 403);
  }
  const ip = request.headers.get('cf-connecting-ip') || 'unknown';
  const since = new Date(Date.now() - 15 * 60000).toISOString();
  const tries = await env.DB.prepare('SELECT COUNT(*) AS n FROM login_failures WHERE ip = ?1 AND role = ?2 AND at > ?3')
    .bind(ip, role, since).first();
  if (tries && Number(tries.n) >= WRONG_TRIES[role]) {
    return json({ ok: false, error: 'Too many wrong tries. Please wait 15 minutes and try again.' }, 429);
  }
  let person = null;
  let good = false;
  if (role === 'admin') {
    good = await sameSecret(password, env.ADMIN_PASSWORD);
  } else {
    const want = cleanUsername(username);
    const rows = want ? await portalUsernames(env, role) : [];
    person = rows.find((r) => r.username === want && r.status === 'Active') || null;
    good = Boolean(person) && await sameSecret(password, portalPassword(env));
  }
  if (!good) {
    await env.DB.batch([
      env.DB.prepare('INSERT INTO login_failures (ip, role, username) VALUES (?1, ?2, ?3)').bind(ip, role, String(username || '').slice(0, 80) || null),
      env.DB.prepare('DELETE FROM login_failures WHERE at < ?1').bind(new Date(Date.now() - 86400000).toISOString()),
    ]);
    return json({ ok: false, error: role === 'admin' ? 'That password is not right.' : 'That username or password is not right.' }, 401);
  }
  const value = await makeSession(env, role, person && person.id);
  return json({ ok: true, role, name: person ? person.name : null },
    200, { 'set-cookie': cookieHeader(request, COOKIE[role], value, SESSION_DAYS[role] * 86400) });
}

async function logout(request, env) {
  if (request.headers.get('x-successpath') !== '1') return json({ ok: false, error: 'Please open the SuccessPath page.' }, 400);
  const body = await readJson(request);
  const role = body.ok && ROLES.includes(body.value.role) ? body.value.role : 'admin';
  return json({ ok: true }, 200, { 'set-cookie': cookieHeader(request, COOKIE[role], '', 0) });
}

async function session(request, env, url) {
  const role = ROLES.includes(url.searchParams.get('role')) ? url.searchParams.get('role') : 'admin';
  const on = loginsOn(env);
  const s = await readSession(request, env, role);
  let name = null;
  if (s && role !== 'admin') {
    const p = await env.DB.prepare('SELECT name FROM people WHERE id = ?1 AND kind = ?2 AND status = ?3').bind(s.personId, role, 'Active').first();
    if (!p) return json({ ok: true, role, logins: on, signed_in: false });
    name = p.name;
  }
  return json({ ok: true, role, logins: on, signed_in: role === 'admin' ? (!on || Boolean(s)) : Boolean(s), name });
}

/* ---------------- Saving an entry ---------------- */

// Adds the student or teacher to the register, unless someone with the same full name is already
// there (one record per name). Runs in the same transaction as the entry itself.
const ADD_PERSON_SQL = `
INSERT INTO people (kind, seq, code, name, name_key, class, phone, status, created_from_client)
SELECT ?1, nx.n, printf('%s-%04d', ?2, nx.n), ?3, ?4, ?5, ?6, ?7, ?8
FROM (SELECT COALESCE(MAX(seq), 0) + 1 AS n FROM people WHERE kind = ?1) AS nx
WHERE NOT EXISTS (SELECT 1 FROM people WHERE kind = ?1 AND name_key = ?4)
  AND NOT EXISTS (SELECT 1 FROM entries WHERE client_id = ?8)
ON CONFLICT (created_from_client) DO NOTHING`;

const INSERT_ENTRY_SQL = `
INSERT INTO entries (type, seq, code, entry_date, name, phone, amount, data, client_id, cancel_hash, person_id)
SELECT ?1, nx.n, printf('%s-%04d', ?2, nx.n), ?3, ?4, ?5, ?6, ?7, ?8, ?9,
  COALESCE(?10, (
    SELECT id FROM people
    WHERE kind = ?11 AND name_key = ?12
    ORDER BY CASE status WHEN 'Cancelled' THEN 1 ELSE 0 END, id ASC
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
UPDATE people SET status = ?2, updated_at = ${NOW}
WHERE id = (SELECT person_id FROM entries WHERE client_id = ?1) AND status = 'Cancelled'
  AND NOT EXISTS (SELECT 1 FROM people q WHERE q.kind = people.kind AND q.name_key = people.name_key
                  AND q.status <> 'Cancelled' AND q.id <> people.id)`;

async function createEntry(request, env) {
  if (request.headers.get('x-successpath') !== '1') {
    return json({ ok: false, error: 'Please use the SuccessPath page to add entries.' }, 400);
  }
  const body = await readJson(request);
  if (!body.ok) return json({ ok: false, error: body.error }, 400);
  const input = body.value;

  // A hidden field on the page that people never see. Only robots fill it in.
  if (input.website) return json({ ok: false, error: 'Rejected.' }, 400);

  let form = getForm(input.type);
  if (!form) return json({ ok: false, error: 'This form does not exist. Please reload the page.' }, 400);
  if (!isClientId(input.client_id) || !isToken(input.cancel_token)) {
    return json({ ok: false, error: 'Please reload the page and try again.' }, 400);
  }

  let checked = validateEntry(form, input.data, indiaToday());
  // A fee with a minus amount is money given back (the page already does this; this covers other senders).
  const swap = checked.ok ? swapForMinus(form, checked.data, indiaToday()) : null;
  if (swap) {
    form = swap.form;
    checked = validateEntry(form, swap.data, indiaToday());
  }
  if (!checked.ok) {
    return json({ ok: false, error: checked.errors._form || 'Please check the fields marked in red.', fields: checked.errors }, 422);
  }
  return storeEntry(env, form, checked.data, input);
}

// Saves a checked entry, with the student or teacher it is about. The office's forms and the student
// portal both save through here. `input` has client_id, cancel_token and person_code.
async function storeEntry(env, form, data, input) {
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

  // One admission per student: a second "New admission" (or "New teacher") for someone already
  // admitted with that form is refused, so nothing is counted twice. Completing the details of a
  // student first added by a fee, an enquiry becoming an admission, and rejoining after leaving
  // are all fine.
  if (link && link.add && link.status === 'Active' && data[link.field] !== undefined) {
    const resent = await env.DB.prepare('SELECT 1 FROM entries WHERE client_id = ?1').bind(input.client_id).first();
    const current = resent ? null : await env.DB.prepare(`
      SELECT p.code, p.name FROM people p
      WHERE ${personId !== null ? 'p.id = ?1' : "p.kind = ?2 AND p.name_key = ?3 AND p.status <> 'Cancelled'"}
        AND p.status = 'Active'
        AND EXISTS (SELECT 1 FROM entries e WHERE e.person_id = p.id AND e.type = ?4 AND e.status = 'Active')
      LIMIT 1`).bind(personId, link.kind, nameKey(data[link.field]), form.type).first();
    if (current) {
      const what = link.kind === 'teacher' ? 'already joined as a teacher' : 'already admitted';
      return json({
        ok: false,
        error: `${current.name} is ${what} (${current.code}). To change their details, open their page and tap Edit details.`,
        fields: { [link.field]: `${current.name} is ${what} (${current.code}).` },
      }, 422);
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
      ['Left', 'Enquiry', 'Demo'].includes(link.status) ? link.status : 'Active', input.client_id,
    ));
  }
  const entryIndex = statements.length;
  statements.push(env.DB.prepare(INSERT_ENTRY_SQL).bind(
    form.type, form.prefix,
    fixed.entry_date, fixed.name, fixed.phone, fixed.amount,
    JSON.stringify(data), input.client_id, cancelHash,
    personId, willAdd ? link.kind : null, willAdd ? key : null,
  ));
  if (willAdd) statements.push(env.DB.prepare(MARK_CREATOR_SQL).bind(input.client_id));
  if (link && link.add) statements.push(env.DB.prepare(REVIVE_SQL).bind(input.client_id, ['Enquiry', 'Demo'].includes(link.status) ? link.status : 'Active'));
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

// For entries about someone already in the register (marks, complaints): a typed name is the
// person with that full name.
async function onlyMatch(env, link, data) {
  const rows = await env.DB.prepare(`
    SELECT id FROM people WHERE kind = ?1 AND status <> 'Cancelled' AND name_key = ?2 LIMIT 2`)
    .bind(link.kind, nameKey(data[link.field])).all();
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
    // An enquiry or demo about someone already studying or teaching here only fills in what is missing.
    const merged = ['Enquiry', 'Demo'].includes(link.status)
      ? `CASE WHEN status IN ('Enquiry', 'Demo') THEN json_patch(details, ${p}) ELSE json_patch(${p}, details) END`
      : `json_patch(details, ${p})`;
    sets.push(`details = ${merged}`);
    differs.push(`details IS NOT ${merged}`);
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
  } else if (link.status === 'Demo') {
    // Enquiry to Demo; a student already admitted (or who left) stays as they are.
    sets.push("status = CASE WHEN status = 'Enquiry' THEN 'Demo' ELSE status END");
    differs.push("status = 'Enquiry'");
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
  'enrollment', json_extract(p.details, '$.enrollment_no'), 'demo_from', json_extract(p.details, '$.demo_from'),
  'total_paid', (SELECT COALESCE(SUM(e.amount), 0) FROM entries e WHERE e.person_id = p.id AND e.type = ?2 AND e.status = 'Active'),
  'last_paid_on', (SELECT MAX(e.entry_date) FROM entries e WHERE e.person_id = p.id AND e.type = ?2 AND e.status = 'Active'),
  'paid_this_month', EXISTS (SELECT 1 FROM entries e WHERE e.person_id = p.id AND e.type = ?2 AND e.status = 'Active' AND ${coversMonth(3, 4, 5)}),
  'last_percent', ${LAST_PERCENT},
  'on_leave_today', EXISTS (SELECT 1 FROM entries e WHERE e.person_id = p.id AND e.type = 'leave' AND e.status = 'Active'
    AND COALESCE(e.entry_date, json_extract(e.data, '$.to')) <= ?6 AND COALESCE(json_extract(e.data, '$.to'), e.entry_date) >= ?6)
)) AS people
FROM people p
WHERE p.kind = ?1 AND p.status <> 'Cancelled'`;

async function peopleList(env, url) {
  const people = getPeople(url.searchParams.get('kind') || 'student');
  if (!people) return json({ ok: false, error: 'Unknown list.' }, 400);
  const today = indiaToday();
  const row = await env.DB.prepare(PEOPLE_LIST_SQL)
    .bind(people.kind, people.paymentType, `$.${people.monthsField}`, monthLabel(today), today.slice(0, 7), today)
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

// What deleting this person would cancel, for the Delete panel: their active entries by form.
const ACTIVE_COUNTS_SQL = `
SELECT json_group_array(json_object('type', type, 'n', n, 'amount', amount)) AS counts
FROM (SELECT type, COUNT(*) AS n, SUM(amount) AS amount FROM entries
      WHERE person_id = ?1 AND status = 'Active' GROUP BY type ORDER BY n DESC, type)`;

// The last delete or restore of a person: a delete means they are deleted now.
const LAST_REMOVAL_SQL = `
SELECT id, action, note, by_name, details, created_at FROM audit_log
WHERE person_id = ?1 AND action IN ('delete', 'restore') ORDER BY id DESC LIMIT 1`;

async function personDetail(env, code) {
  const person = await env.DB.prepare(`
    SELECT id, kind, code, name, class, phone, status, details, joined_on, left_on, created_from, created_at, updated_at
    FROM people WHERE code = ?1`).bind(code).first();
  if (!person) return json({ ok: false, error: `${code} was not found.` }, 404);
  // Hidden people are not shown, except someone the office deleted: their page offers Restore.
  let deleted = null;
  if (person.status === 'Cancelled') {
    const last = await env.DB.prepare(LAST_REMOVAL_SQL).bind(person.id).first();
    if (!last || last.action !== 'delete') return json({ ok: false, error: `${code} was not found.` }, 404);
    const d = parseDetails(last.details);
    deleted = {
      at: last.created_at, note: last.note, by: last.by_name,
      entries: Array.isArray(d.entries) ? d.entries.length : 0,
      requests: Array.isArray(d.requests) ? d.requests.length : 0,
    };
  }
  const { id, details, ...rest } = person;
  let parsed = {};
  try { parsed = JSON.parse(details || '{}'); } catch { /* keep empty */ }
  const school = typeof parsed.school === 'string' && parsed.school.trim() ? parsed.school.trim() : null;
  const statements = [env.DB.prepare(PERSON_ENTRIES_SQL).bind(id), env.DB.prepare(ACTIVE_COUNTS_SQL).bind(id)];
  statements.push(person.kind === 'student'
    ? env.DB.prepare(CLASS_EXAMS_SQL).bind(person.class, school)
    : env.DB.prepare(TEACHER_MESSAGES_SQL).bind(code, null));
  if (person.kind === 'teacher') statements.push(env.DB.prepare(LEAVE_REQUESTS_SQL).bind(1, id));
  const [own, counts, extra, requests] = await env.DB.batch(statements);
  const first = (r) => (r && r.results && r.results[0]) || null;
  // How this person logs in to their portal (shown only in the office app).
  const rows = await portalUsernames(env, person.kind);
  const mine = rows.find((r) => r.id === id);
  const portal = {
    username: mine ? mine.username : null, password: portalPassword(env), open: loginsOn(env),
    can_log_in: person.status === 'Active',
    classes_taught: person.kind === 'teacher' ? classesFromText(parsed.classes) : undefined,
  };
  const body = `{"ok":true,"month":${JSON.stringify(monthLabel(indiaToday()))},`
    + `"person":${JSON.stringify({ ...rest, details: parsed })},`
    + `"portal":${JSON.stringify(portal)},`
    + `"entries":${(first(own) && first(own).entries) || '[]'},`
    + `"class_exams":${person.kind === 'student' ? (first(extra) && first(extra).entries) || '[]' : '[]'},`
    + `"messages_to":${person.kind === 'teacher' ? (first(extra) && first(extra).messages) || '[]' : '[]'},`
    + `"leave_requests":${person.kind === 'teacher' ? (first(requests) && first(requests).requests) || '[]' : '[]'},`
    + `"counts":${(first(counts) && first(counts).counts) || '[]'},`
    + `"deleted":${JSON.stringify(deleted)}}`;
  return new Response(body, { headers: JSON_HEADERS });
}

/* ---------------- The teacher and student portals ---------------- */

// What the portals show is chosen here: no phone numbers, addresses, fees or salaries.

function parseDetails(text) {
  try { return JSON.parse(text || '{}') || {}; } catch { return {}; }
}

function randomToken() {
  return [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function portalUser(request, env, role) {
  if (request.headers.get('x-successpath') !== '1') {
    return { response: json({ ok: false, error: 'Please open the SuccessPath page.' }, 400) };
  }
  if (!loginsOn(env)) {
    return { response: json({ ok: false, error: 'The portals are not open yet. Please ask the office.', login: role }, 403) };
  }
  const s = await readSession(request, env, role);
  if (!s) return { response: json({ ok: false, error: 'Please log in.', login: role }, 401) };
  const me = await env.DB.prepare('SELECT id, kind, seq, code, name, class, status, joined_on, details, created_at FROM people WHERE id = ?1')
    .bind(s.personId).first();
  if (!me || me.kind !== role || me.status !== 'Active') {
    return { response: json({ ok: false, error: 'This login is not active any more. Please ask the office.', login: role }, 401) };
  }
  me.details = parseDetails(me.details);
  return { me };
}

async function portalApi(request, env, path, method) {
  const role = path.startsWith('/api/portal/teacher') ? 'teacher' : 'student';
  const who = await portalUser(request, env, role);
  if (who.response) return who.response;
  const me = who.me;
  if (role === 'teacher') {
    if (path === '/api/portal/teacher/leave-requests') {
      return method === 'POST' ? teacherAskLeave(request, env, me) : methodNotAllowed('POST');
    }
    const withdraw = /^\/api\/portal\/teacher\/leave-requests\/(LRQ-\d{1,12})\/withdraw$/.exec(path);
    if (withdraw) return method === 'POST' ? teacherWithdrawLeave(env, me, withdraw[1]) : methodNotAllowed('POST');
    if (path === '/api/portal/teacher/messages' && method === 'POST') return teacherMessage(request, env, me);
    if (path === '/api/portal/teacher/notices/seen') return method === 'POST' ? noticesSeen(env, 'teacher', me) : methodNotAllowed('POST');
    if (method !== 'GET') return methodNotAllowed('GET');
    if (path === '/api/portal/teacher/notices') return notices(env, 'teacher', me);
    if (path === '/api/portal/teacher/messages') return conversationList(env, 'teacher', me);
    const chat = /^\/api\/portal\/teacher\/messages\/(STU-\d{1,12})$/.exec(path);
    if (chat) return conversationWith(env, 'teacher', me, chat[1]);
    if (path === '/api/portal/teacher/calendar') return teacherCalendar(env, me, new URL(request.url));
    if (path === '/api/portal/teacher/leave') return teacherLeave(env, me);
    if (path === '/api/portal/teacher') return teacherHome(env, me);
    if (path === '/api/portal/teacher/students') return teacherStudents(env, me);
    const one = /^\/api\/portal\/teacher\/students\/(STU-\d{1,12})$/.exec(path);
    if (one) return teacherStudent(env, me, one[1]);
    if (path === '/api/portal/teacher/enquiries') return teacherEnquiries(env, me);
  } else {
    if (path === '/api/portal/student') return method === 'GET' ? studentHome(env, me) : methodNotAllowed('GET');
    if (path === '/api/portal/student/messages') return method === 'POST' ? studentMessage(request, env, me) : conversationList(env, 'student', me);
    const chat = /^\/api\/portal\/student\/messages\/(TR-\d{1,12})$/.exec(path);
    if (chat) return method === 'GET' ? conversationWith(env, 'student', me, chat[1]) : methodNotAllowed('GET');
    if (path === '/api/portal/student/notices') return method === 'GET' ? notices(env, 'student', me) : methodNotAllowed('GET');
    if (path === '/api/portal/student/notices/seen') return method === 'POST' ? noticesSeen(env, 'student', me) : methodNotAllowed('POST');
    if (path === '/api/portal/student/exams') return method === 'POST' ? studentExam(request, env, me) : methodNotAllowed('POST');
  }
  return json({ ok: false, error: 'Not found' }, 404);
}

async function usernameOf(env, me) {
  const rows = await portalUsernames(env, me.kind);
  const row = rows.find((r) => r.id === me.id);
  return row ? row.username : null;
}

function teacherPublic(p, username) {
  const d = p.details || {};
  return {
    code: p.code, name: p.name, username, subjects: d.subjects || null, classes: d.classes || null,
    classes_taught: classesFromText(d.classes), qualification: d.qualification || null,
    experience: d.experience || null, joined_on: p.joined_on || null,
  };
}

function studentPublic(p, username) {
  const d = p.details || {};
  return {
    code: p.code, name: p.name, username, class: p.class || null, school: d.school || null,
    subjects: d.subjects || null, enrollment_no: d.enrollment_no || null, joined_on: p.joined_on || null,
  };
}

const ENTRY_JSON = `json_object('code', code, 'type', type, 'status', status, 'entry_date', entry_date,
  'data', json(data), 'created_at', created_at)`;

// One kind of entry about one student: their marks, or their own exam dates.
const OWN_ENTRIES_SQL = `
SELECT json_group_array(${ENTRY_JSON}) AS entries
FROM (SELECT * FROM entries WHERE person_id = ?1 AND type = ?2 AND status = 'Active'
      ORDER BY COALESCE(entry_date, substr(created_at, 1, 10)) DESC, id DESC LIMIT 100)`;

const MESSAGE_JSON = `json_object('code', e.code, 'entry_date', e.entry_date, 'created_at', e.created_at,
  'about', json_extract(e.data, '$.about'), 'message', json_extract(e.data, '$.message'),
  'from', COALESCE(json_extract(e.data, '$.from'), 'Student'),
  'teacher_name', json_extract(e.data, '$.teacher_name'), 'teacher_code', json_extract(e.data, '$.teacher_code'),
  'student_name', COALESCE(p.name, e.name), 'student_code', p.code,
  'class', COALESCE(p.class, json_extract(e.data, '$.class')), 'student_active', p.status = 'Active')`;

// Messages sent to one teacher (?1 = TR code), and optionally only from one student (?2 = person id).
const TEACHER_MESSAGES_SQL = `
SELECT json_group_array(${MESSAGE_JSON}) AS messages
FROM (SELECT * FROM entries
      WHERE type = 'portal_message' AND status = 'Active' AND json_extract(data, '$.teacher_code') = ?1
        AND (?2 IS NULL OR person_id = ?2)
      ORDER BY id DESC LIMIT 300) AS e
LEFT JOIN people p ON p.id = e.person_id`;

// Messages one student sent (?1 = person id).
const SENT_MESSAGES_SQL = `
SELECT json_group_array(${MESSAGE_JSON}) AS messages
FROM (SELECT * FROM entries WHERE type = 'portal_message' AND status = 'Active' AND person_id = ?1
      ORDER BY id DESC LIMIT 200) AS e
LEFT JOIN people p ON p.id = e.person_id`;

const PORTAL_STUDENTS_SQL = `
SELECT json_group_array(json_object(
  'code', p.code, 'name', p.name, 'class', p.class,
  'school', json_extract(p.details, '$.school'), 'subjects', json_extract(p.details, '$.subjects'),
  'last_percent', ${LAST_PERCENT})) AS people
FROM (SELECT * FROM people WHERE kind = 'student' AND status = 'Active' ORDER BY name) AS p`;

// Exam dates from a week ago to six months ahead, of current students and whole classes.
const PORTAL_EXAMS_SQL = `
SELECT (SELECT json_group_array(json_object(
  'code', x.code, 'starts_on', x.starts_on, 'ends_on', x.ends_on, 'exam', x.exam, 'class', x.class,
  'school', x.school, 'subjects', x.subjects, 'notes', x.notes, 'student_name', x.student_name,
  'person_code', x.person_code, 'added_by', x.added_by))
FROM (
  SELECT e.code, e.id,
    COALESCE(e.entry_date, json_extract(e.data, '$.ends_on')) AS starts_on,
    COALESCE(json_extract(e.data, '$.ends_on'), e.entry_date) AS ends_on,
    json_extract(e.data, '$.exam') AS exam,
    COALESCE(json_extract(e.data, '$.class'), p.class) AS class,
    json_extract(e.data, '$.school') AS school,
    json_extract(e.data, '$.subjects') AS subjects,
    json_extract(e.data, '$.notes') AS notes,
    json_extract(e.data, '$.added_by') AS added_by,
    p.name AS student_name, p.code AS person_code
  FROM entries e LEFT JOIN people p ON p.id = e.person_id
  WHERE e.type = 'exam' AND e.status = 'Active'
    AND COALESCE(json_extract(e.data, '$.ends_on'), e.entry_date) >= ?1
    AND COALESCE(e.entry_date, json_extract(e.data, '$.ends_on')) <= ?2
    AND (e.person_id IS NULL OR p.status = 'Active')
  ORDER BY starts_on, e.id
  LIMIT 300) AS x) AS exams`;

const firstJson = (r, key) => (r && r.results && r.results[0] && r.results[0][key]) || '[]';

async function teacherHome(env, me) {
  const today = indiaToday();
  const [leave, holidays, count] = await env.DB.batch([
    env.DB.prepare(`SELECT code, entry_date, json_extract(data, '$.to') AS to_date, json_extract(data, '$.reason') AS reason
      FROM entries WHERE person_id = ?1 AND type = 'leave' AND status = 'Active'
        AND COALESCE(json_extract(data, '$.to'), entry_date) >= ?2
      ORDER BY entry_date LIMIT 30`).bind(me.id, today),
    env.DB.prepare(`SELECT code, entry_date, json_extract(data, '$.to') AS to_date, COALESCE(json_extract(data, '$.holiday'), name) AS name
      FROM entries WHERE type = 'holiday' AND status = 'Active' AND COALESCE(json_extract(data, '$.to'), entry_date) >= ?1
      ORDER BY entry_date LIMIT 30`).bind(today),
    env.DB.prepare(`SELECT COUNT(*) AS n FROM entries
      WHERE type = 'portal_message' AND status = 'Active' AND json_extract(data, '$.teacher_code') = ?1`).bind(me.code),
  ]);
  return json({
    ok: true, today, me: teacherPublic(me, await usernameOf(env, me)),
    leave: leave.results, holidays: holidays.results, messages: Number(count.results[0].n),
  });
}

async function teacherStudents(env, me) {
  const row = await env.DB.prepare(PORTAL_STUDENTS_SQL).first();
  const taught = classesFromText(me.details.classes);
  const people = JSON.parse((row && row.people) || '[]').map((p) => ({ ...p, mine: taught.includes(p.class) }));
  return json({ ok: true, today: indiaToday(), classes_taught: taught, people });
}

async function teacherStudent(env, me, code) {
  const p = await env.DB.prepare(`SELECT id, kind, code, name, class, joined_on, details FROM people
    WHERE code = ?1 AND kind = 'student' AND status = 'Active'`).bind(code).first();
  if (!p) return json({ ok: false, error: 'This student is not in the current list.' }, 404);
  p.details = parseDetails(p.details);
  const school = typeof p.details.school === 'string' && p.details.school.trim() ? p.details.school.trim() : null;
  const [marks, exams, classExams, messages] = await env.DB.batch([
    env.DB.prepare(OWN_ENTRIES_SQL).bind(p.id, 'marks'),
    env.DB.prepare(OWN_ENTRIES_SQL).bind(p.id, 'exam'),
    env.DB.prepare(CLASS_EXAMS_SQL).bind(p.class, school),
    env.DB.prepare(TEACHER_MESSAGES_SQL).bind(me.code, p.id),
  ]);
  const student = { ...studentPublic(p, null), mine: classesFromText(me.details.classes).includes(p.class) };
  delete student.username;
  const body = `{"ok":true,"today":${JSON.stringify(indiaToday())},"student":${JSON.stringify(student)},`
    + `"marks":${firstJson(marks, 'entries')},"exams":${firstJson(exams, 'entries')},`
    + `"class_exams":${firstJson(classExams, 'entries')},"messages":${firstJson(messages, 'messages')}}`;
  return new Response(body, { headers: JSON_HEADERS });
}

async function teacherEnquiries(env, me) {
  const today = indiaToday();
  const [messages, exams] = await env.DB.batch([
    env.DB.prepare(TEACHER_MESSAGES_SQL).bind(me.code, null),
    env.DB.prepare(PORTAL_EXAMS_SQL).bind(addDaysIso(today, -7), addDaysIso(today, 183)),
  ]);
  const taught = classesFromText(me.details.classes);
  const examList = JSON.parse(firstJson(exams, 'exams')).map((x) => ({ ...x, mine: taught.includes(x.class) }));
  const body = `{"ok":true,"today":${JSON.stringify(today)},"classes_taught":${JSON.stringify(taught)},`
    + `"messages":${firstJson(messages, 'messages')},"exams":${JSON.stringify(examList)}}`;
  return new Response(body, { headers: JSON_HEADERS });
}

async function studentHome(env, me) {
  const school = typeof me.details.school === 'string' && me.details.school.trim() ? me.details.school.trim() : null;
  const [marks, exams, classExams, sent, teachers] = await env.DB.batch([
    env.DB.prepare(OWN_ENTRIES_SQL).bind(me.id, 'marks'),
    env.DB.prepare(OWN_ENTRIES_SQL).bind(me.id, 'exam'),
    env.DB.prepare(CLASS_EXAMS_SQL).bind(me.class, school),
    env.DB.prepare(SENT_MESSAGES_SQL).bind(me.id),
    env.DB.prepare(`SELECT code, name, json_extract(details, '$.subjects') AS subjects, json_extract(details, '$.classes') AS classes
      FROM people WHERE kind = 'teacher' AND status = 'Active' ORDER BY name`),
  ]);
  const list = (teachers.results || []).map((t) => ({
    code: t.code, name: t.name, subjects: t.subjects || null, mine: classesFromText(t.classes).includes(me.class),
  }));
  const examForm = getForm('exam');
  const body = `{"ok":true,"today":${JSON.stringify(indiaToday())},`
    + `"me":${JSON.stringify(studentPublic(me, await usernameOf(env, me)))},`
    + `"marks":${firstJson(marks, 'entries')},"exams":${firstJson(exams, 'entries')},"class_exams":${firstJson(classExams, 'entries')},`
    + `"messages":${firstJson(sent, 'messages')},"teachers":${JSON.stringify(list)},`
    + `"message_kinds":${JSON.stringify(MESSAGE_KINDS)},`
    + `"exam_kinds":${JSON.stringify(examForm.fields.find((f) => f.key === 'exam').options)}}`;
  return new Response(body, { headers: JSON_HEADERS });
}

const PORTAL_DAILY_LIMIT = { portal_message: 30, exam: 20 };

// Saving from the student portal: the student and their class come from the login, not the page.
async function portalSave(env, me, type, input, data) {
  if (!isClientId(input.client_id)) return json({ ok: false, error: 'Please reload the page and try again.' }, 400);
  const today = indiaToday();
  const resent = await env.DB.prepare('SELECT 1 FROM entries WHERE client_id = ?1').bind(input.client_id).first();
  if (!resent) {
    const n = await env.DB.prepare(`SELECT COUNT(*) AS n FROM entries WHERE type = ?1 AND person_id = ?2
      AND created_at >= ?3`).bind(type, me.id, new Date(Date.now() - 86400000).toISOString()).first();
    if (n && Number(n.n) >= PORTAL_DAILY_LIMIT[type]) {
      return json({ ok: false, error: 'That is a lot for one day. Please try again tomorrow.' }, 429);
    }
  }
  const form = getForm(type);
  const checked = validateEntry(form, data, today);
  if (!checked.ok) {
    return json({ ok: false, error: checked.errors._form || 'Please check the fields marked in red.', fields: checked.errors }, 422);
  }
  return storeEntry(env, form, checked.data, { client_id: input.client_id, cancel_token: randomToken(), person_code: me.code });
}

async function studentMessage(request, env, me) {
  const body = await readJson(request);
  if (!body.ok) return json({ ok: false, error: body.error }, 400);
  const input = body.value;
  const fields = {};
  const teacher = typeof input.teacher_code === 'string' && /^TR-\d{1,12}$/.test(input.teacher_code)
    ? await env.DB.prepare("SELECT code, name FROM people WHERE code = ?1 AND kind = 'teacher' AND status = 'Active'").bind(input.teacher_code).first()
    : null;
  if (!teacher) fields.teacher_code = 'Choose a teacher.';
  if (input.about && !MESSAGE_KINDS.includes(input.about)) fields.about = 'Choose what it is about.';
  if (typeof input.message !== 'string' || !input.message.trim()) fields.message = 'Write your message.';
  if (Object.keys(fields).length) return json({ ok: false, error: 'Please check the fields marked in red.', fields }, 422);
  return portalSave(env, me, 'portal_message', input, {
    date: indiaToday(), student_name: me.name, class: me.class || undefined,
    teacher_name: teacher.name, teacher_code: teacher.code, from: 'Student', about: input.about || undefined, message: input.message,
  });
}

async function studentExam(request, env, me) {
  const body = await readJson(request);
  if (!body.ok) return json({ ok: false, error: body.error }, 400);
  const input = body.value;
  if (typeof input.starts_on !== 'string' || !isRealDate(input.starts_on)) {
    return json({ ok: false, error: 'Please check the fields marked in red.', fields: { starts_on: 'Pick the first day of the exam.' } }, 422);
  }
  return portalSave(env, me, 'exam', input, {
    student_name: me.name, class: me.class || undefined, school: me.details.school || undefined,
    exam: input.exam, starts_on: input.starts_on, ends_on: input.ends_on, subjects: input.subjects, notes: input.notes,
    added_by: 'Student portal',
  });
}

/* ---------------- Messages: conversations between a student and a teacher ---------------- */

// Every message is a portal_message entry about the student (person_id), with the teacher's code in
// its data and who wrote it in data.from ('Student', or 'Teacher'; the first messages had none).
const CONVERSATION_SQL = `
SELECT e.id, e.code, e.created_at, e.entry_date,
  COALESCE(json_extract(e.data, '$.from'), 'Student') AS sender,
  json_extract(e.data, '$.about') AS about, json_extract(e.data, '$.message') AS message,
  json_extract(e.data, '$.teacher_code') AS teacher_code, json_extract(e.data, '$.teacher_name') AS teacher_name,
  p.code AS student_code, COALESCE(p.name, e.name) AS student_name, p.class AS class, p.status AS student_status
FROM entries e LEFT JOIN people p ON p.id = e.person_id
WHERE e.type = 'portal_message' AND e.status = 'Active'`;

async function readsOf(env, reader) {
  const rows = (await env.DB.prepare('SELECT topic, last_id, last_at FROM portal_reads WHERE reader = ?1').bind(reader).all()).results;
  return Object.fromEntries(rows.map((r) => [r.topic, r]));
}

function markRead(env, reader, topic, lastId) {
  return env.DB.prepare(`INSERT INTO portal_reads (reader, topic, last_id, updated_at) VALUES (?1, ?2, ?3, ${NOW})
    ON CONFLICT (reader, topic) DO UPDATE SET last_id = MAX(last_id, excluded.last_id), updated_at = excluded.updated_at`)
    .bind(reader, topic, lastId || 0);
}

function shapeMessage(m, side) {
  return {
    code: m.code, id: m.id, at: m.created_at, date: m.entry_date, from: m.sender, mine: m.sender === (side === 'teacher' ? 'Teacher' : 'Student'),
    about: m.about, message: m.message, teacher_code: m.teacher_code, teacher_name: m.teacher_name,
    student_code: m.student_code, student_name: m.student_name, class: m.class,
  };
}

/** One row per person this teacher (or student) has messages with: the last message and how many are unread. */
async function conversations(env, side, me) {
  const rows = side === 'teacher'
    ? (await env.DB.prepare(`${CONVERSATION_SQL} AND json_extract(e.data, '$.teacher_code') = ?1 ORDER BY e.id DESC LIMIT 2000`).bind(me.code).all()).results
    : (await env.DB.prepare(`${CONVERSATION_SQL} AND e.person_id = ?1 ORDER BY e.id DESC LIMIT 2000`).bind(me.id).all()).results;
  const reads = await readsOf(env, me.code);
  const theirs = side === 'teacher' ? 'Student' : 'Teacher';
  const byOther = new Map();
  for (const m of rows) {
    const other = side === 'teacher' ? m.student_code : m.teacher_code;
    if (!other) continue;
    let c = byOther.get(other);
    if (!c) {
      c = side === 'teacher'
        ? { code: other, name: m.student_name, class: m.class, active: m.student_status === 'Active', last: shapeMessage(m, side), count: 0, unread: 0 }
        : { code: other, name: m.teacher_name, last: shapeMessage(m, side), count: 0, unread: 0 };
      byOther.set(other, c);
    }
    c.count += 1;
    const seen = (reads[`chat:${other}`] && reads[`chat:${other}`].last_id) || 0;
    if (m.sender === theirs && m.id > seen) c.unread += 1;
  }
  const list = [...byOther.values()];
  return { list, unread: list.reduce((s, c) => s + c.unread, 0) };
}

async function conversationList(env, side, me) {
  const { list, unread } = await conversations(env, side, me);
  return json({ ok: true, conversations: list, unread });
}

/** Every message between this teacher and one student, oldest first; opening it marks it read. */
async function conversationWith(env, side, me, otherCode) {
  let other;
  let rows;
  if (side === 'teacher') {
    other = await env.DB.prepare(`SELECT id, code, name, class, status FROM people WHERE code = ?1 AND kind = 'student' AND status <> 'Cancelled'`).bind(otherCode).first();
    if (!other) return json({ ok: false, error: 'This student was not found.' }, 404);
    rows = (await env.DB.prepare(`${CONVERSATION_SQL} AND json_extract(e.data, '$.teacher_code') = ?1 AND e.person_id = ?2 ORDER BY e.id LIMIT 1000`)
      .bind(me.code, other.id).all()).results;
  } else {
    other = await env.DB.prepare(`SELECT id, code, name, status, json_extract(details, '$.subjects') AS subjects FROM people WHERE code = ?1 AND kind = 'teacher' AND status <> 'Cancelled'`).bind(otherCode).first();
    if (!other) return json({ ok: false, error: 'This teacher was not found.' }, 404);
    rows = (await env.DB.prepare(`${CONVERSATION_SQL} AND e.person_id = ?1 AND json_extract(e.data, '$.teacher_code') = ?2 ORDER BY e.id LIMIT 1000`)
      .bind(me.id, other.code).all()).results;
  }
  const lastId = rows.length ? rows[rows.length - 1].id : 0;
  if (lastId) await markRead(env, me.code, `chat:${other.code}`, lastId).run();
  const who = side === 'teacher'
    ? { code: other.code, name: other.name, class: other.class, active: other.status === 'Active' }
    : { code: other.code, name: other.name, subjects: other.subjects || null, active: other.status === 'Active' };
  return json({ ok: true, with: who, messages: rows.map((m) => shapeMessage(m, side)), kinds: MESSAGE_KINDS });
}

// A teacher writes to a student: a new conversation, or a reply.
async function teacherMessage(request, env, me) {
  const body = await readJson(request);
  if (!body.ok) return json({ ok: false, error: body.error }, 400);
  const input = body.value;
  if (!isClientId(input.client_id)) return json({ ok: false, error: 'Please reload the page and try again.' }, 400);
  const fields = {};
  const student = typeof input.student_code === 'string' && /^STU-\d{1,12}$/.test(input.student_code)
    ? await env.DB.prepare("SELECT id, code, name, class FROM people WHERE code = ?1 AND kind = 'student' AND status = 'Active'").bind(input.student_code).first()
    : null;
  if (!student) fields.student_code = 'Choose a current student.';
  if (typeof input.message !== 'string' || !input.message.trim()) fields.message = 'Write your message.';
  if (input.about && !MESSAGE_KINDS.includes(input.about)) fields.about = 'Choose what it is about.';
  if (Object.keys(fields).length) return json({ ok: false, error: 'Please check the fields marked in red.', fields }, 422);
  const resent = await env.DB.prepare('SELECT 1 FROM entries WHERE client_id = ?1').bind(input.client_id).first();
  if (!resent) {
    const n = await env.DB.prepare(`SELECT COUNT(*) AS n FROM entries WHERE type = 'portal_message' AND created_at >= ?2
      AND json_extract(data, '$.teacher_code') = ?1 AND json_extract(data, '$.from') = 'Teacher'`)
      .bind(me.code, new Date(Date.now() - 86400000).toISOString()).first();
    if (n && Number(n.n) >= 100) return json({ ok: false, error: 'That is a lot of messages for one day. Please try again tomorrow.' }, 429);
  }
  const form = getForm('portal_message');
  const today = indiaToday();
  const checked = validateEntry(form, {
    date: today, student_name: student.name, class: student.class || undefined, teacher_name: me.name, teacher_code: me.code,
    from: 'Teacher', about: input.about || undefined, message: input.message,
  }, today);
  if (!checked.ok) return json({ ok: false, error: checked.errors._form || 'Please check the fields marked in red.', fields: checked.errors }, 422);
  return storeEntry(env, form, checked.data, { client_id: input.client_id, cancel_token: randomToken(), person_code: student.code });
}

/* ---------------- The notification bell ---------------- */

// Worked out each time from what is in the database; portal_reads remembers when the bell was opened,
// so items newer than that count as new. Leave requests waiting always count for the office.

const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function dayMon(iso) {
  const [, m, d] = String(iso || '').split('-').map(Number);
  return d && m ? `${d} ${SHORT_MONTHS[m - 1]}` : '';
}

function datesText(from, to) {
  return !to || to === from ? dayMon(from) : `${dayMon(from)} to ${dayMon(to)}`;
}

function cut(text, n = 140) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
}

async function notices(env, side, me) {
  const reader = side === 'office' ? 'office' : me.code;
  const reads = await readsOf(env, reader);
  const seenAt = (reads.notices && reads.notices.last_at) || '';
  const since = (days) => new Date(Date.now() - days * 86400000).toISOString();
  const items = [];
  if (side === 'office') {
    const [requests, messages, exams] = await env.DB.batch([
      env.DB.prepare(LEAVE_REQUESTS_SQL).bind(0, null),
      env.DB.prepare(`${CONVERSATION_SQL} AND COALESCE(json_extract(e.data, '$.from'), 'Student') = 'Student' AND e.created_at >= ?1 ORDER BY e.id DESC LIMIT 30`).bind(since(14)),
      env.DB.prepare(`SELECT e.code, e.created_at, e.entry_date, json_extract(e.data, '$.exam') AS exam, p.code AS person_code, p.name AS name
        FROM entries e JOIN people p ON p.id = e.person_id
        WHERE e.type = 'exam' AND e.status = 'Active' AND json_extract(e.data, '$.added_by') IS NOT NULL AND e.created_at >= ?1
        ORDER BY e.id DESC LIMIT 20`).bind(since(14)),
    ]);
    for (const r of JSON.parse((requests.results[0] && requests.results[0].requests) || '[]')) {
      items.push({ kind: 'leave_request', at: r.created_at, code: r.code, action: true,
        text: `${r.name} asked for leave`, sub: [datesText(r.from, r.to), r.reason, r.notes].filter(Boolean).join(', '),
        from: r.from, to: r.to, href: `#/teachers/${r.person_code}` });
    }
    for (const m of messages.results) {
      items.push({ kind: 'message', at: m.created_at, code: m.code,
        text: `${m.about || 'Message'} from ${m.student_name} to ${m.teacher_name || 'a teacher'}`, sub: cut(m.message),
        href: m.student_code ? `#/students/${m.student_code}` : '#/' });
    }
    for (const x of exams.results) {
      items.push({ kind: 'exam', at: x.created_at, code: x.code, text: `${x.name} added an exam date`,
        sub: [x.exam, dayMon(x.entry_date)].filter(Boolean).join(', '), href: `#/students/${x.person_code}` });
    }
  } else if (side === 'teacher') {
    const taught = classesFromText(me.details.classes);
    const [messages, decided, tasks, exams] = await env.DB.batch([
      env.DB.prepare(`${CONVERSATION_SQL} AND json_extract(e.data, '$.teacher_code') = ?1
        AND COALESCE(json_extract(e.data, '$.from'), 'Student') = 'Student' AND e.created_at >= ?2 ORDER BY e.id DESC LIMIT 30`).bind(me.code, since(30)),
      env.DB.prepare(`SELECT code, from_date, to_date, status, decision_note, decided_at FROM leave_requests
        WHERE person_id = ?1 AND status IN ('Approved', 'Declined') AND decided_at >= ?2 ORDER BY decided_at DESC LIMIT 20`).bind(me.id, since(30)),
      env.DB.prepare(`SELECT code, title, due_on, updated_at FROM tasks
        WHERE lower(owner) = lower(?1) AND COALESCE(changed_by, '') <> ?1 AND stage IN ('To do', 'Doing') AND updated_at >= ?2
        ORDER BY updated_at DESC LIMIT 20`).bind(me.name, since(14)),
      env.DB.prepare(`SELECT e.code, e.created_at, e.entry_date, json_extract(e.data, '$.exam') AS exam, p.code AS person_code, p.name AS name, p.class AS class
        FROM entries e JOIN people p ON p.id = e.person_id
        WHERE e.type = 'exam' AND e.status = 'Active' AND json_extract(e.data, '$.added_by') IS NOT NULL AND e.created_at >= ?1 AND p.status = 'Active'
        ORDER BY e.id DESC LIMIT 30`).bind(since(14)),
    ]);
    const reads2 = reads;
    for (const m of messages.results) {
      const seen = (reads2[`chat:${m.student_code}`] && reads2[`chat:${m.student_code}`].last_id) || 0;
      items.push({ kind: 'message', at: m.created_at, code: m.code, read: m.id <= seen,
        text: `${m.about || 'Message'} from ${m.student_name}${m.class ? `, ${m.class}` : ''}`, sub: cut(m.message),
        href: `#/messages/${m.student_code}` });
    }
    for (const r of decided.results) {
      items.push({ kind: 'leave', at: r.decided_at, code: r.code,
        text: `Your leave was ${r.status.toLowerCase()}`, sub: [datesText(r.from_date, r.to_date), r.decision_note].filter(Boolean).join(', '),
        href: '#/leave' });
    }
    for (const t of tasks.results) {
      items.push({ kind: 'task', at: t.updated_at, code: t.code, text: `A task for you: ${cut(t.title, 80)}`,
        sub: t.due_on ? `End date ${dayMon(t.due_on)}` : '', href: '#/tasks' });
    }
    for (const x of exams.results.filter((e) => taught.includes(e.class))) {
      items.push({ kind: 'exam', at: x.created_at, code: x.code, text: `${x.name} added an exam date`,
        sub: [x.exam, dayMon(x.entry_date)].filter(Boolean).join(', '), href: `#/students/${x.person_code}` });
    }
  } else {
    const [messages, marks, exams] = await env.DB.batch([
      env.DB.prepare(`${CONVERSATION_SQL} AND e.person_id = ?1 AND json_extract(e.data, '$.from') = 'Teacher' AND e.created_at >= ?2
        ORDER BY e.id DESC LIMIT 30`).bind(me.id, since(30)),
      env.DB.prepare(`SELECT code, created_at, json_extract(data, '$.subject') AS subject, json_extract(data, '$.marks') AS marks,
        json_extract(data, '$.out_of') AS out_of FROM entries
        WHERE type = 'marks' AND status = 'Active' AND person_id = ?1 AND created_at >= ?2 ORDER BY id DESC LIMIT 20`).bind(me.id, since(30)),
      env.DB.prepare(`SELECT code, created_at, entry_date, json_extract(data, '$.exam') AS exam FROM entries
        WHERE type = 'exam' AND status = 'Active' AND json_extract(data, '$.added_by') IS NULL AND created_at >= ?2
          AND (person_id = ?1 OR (person_id IS NULL AND json_extract(data, '$.class') = ?3))
        ORDER BY id DESC LIMIT 20`).bind(me.id, since(30), me.class || ''),
    ]);
    for (const m of messages.results) {
      const seen = (reads[`chat:${m.teacher_code}`] && reads[`chat:${m.teacher_code}`].last_id) || 0;
      items.push({ kind: 'message', at: m.created_at, code: m.code, read: m.id <= seen,
        text: `${m.teacher_name || 'Your teacher'} wrote to you`, sub: cut(m.message), href: `#/messages/${m.teacher_code}` });
    }
    for (const k of marks.results) {
      items.push({ kind: 'marks', at: k.created_at, code: k.code, text: 'New marks',
        sub: [k.subject, k.marks !== null && k.out_of ? `${k.marks} out of ${k.out_of}` : k.marks].filter((v) => v !== null && v !== undefined && v !== '').join(', '),
        href: '#/' });
    }
    for (const x of exams.results) {
      items.push({ kind: 'exam', at: x.created_at, code: x.code, text: 'An exam date was added for you',
        sub: [x.exam, dayMon(x.entry_date)].filter(Boolean).join(', '), href: '#/' });
    }
  }
  items.sort((a, b) => String(b.at).localeCompare(String(a.at)));
  for (const it of items) it.new = it.action || (!it.read && String(it.at) > seenAt);
  const list = items.slice(0, 40);
  return json({ ok: true, items: list, unread: list.filter((it) => it.new).length, seen_at: seenAt || null });
}

async function noticesSeen(env, side, me) {
  const reader = side === 'office' ? 'office' : me.code;
  await env.DB.prepare(`INSERT INTO portal_reads (reader, topic, last_at, updated_at) VALUES (?1, 'notices', ${NOW}, ${NOW})
    ON CONFLICT (reader, topic) DO UPDATE SET last_at = excluded.last_at, updated_at = excluded.updated_at`).bind(reader).run();
  return json({ ok: true });
}

/* ---------------- Analytics ---------------- */

async function analytics(env) {
  const today = indiaToday();
  const month = today.slice(0, 7);
  const label = monthLabel(today);
  const prevMonth = shiftMonth(month, -1);
  const since6 = `${shiftMonth(month, -5)}-01`;
  const since12 = `${shiftMonth(month, -11)}-01`;
  // The money chart covers this session (it starts in April), and at least the last 6 months.
  const sessionStart = `${Number(month.slice(0, 4)) - (Number(month.slice(5, 7)) < 4 ? 1 : 0)}-04`;
  const firstMonth = sessionStart < shiftMonth(month, -5) ? sessionStart : shiftMonth(month, -5);
  const chartSince = `${firstMonth}-01`;
  const since3 = `${shiftMonth(month, -2)}-01`;
  const q = (sql, ...params) => env.DB.prepare(sql).bind(...params);

  const [
    feesByMonth, refundsByMonth, payByMonth, otherByMonth, otherTypes, feesByMode, people, byClass, counts, notPaid,
    sources, conversion, leftReasons, marks, complaints,
  ] = await env.DB.batch([
    // fees collected (money returned to students is money paid out, the next series)
    q(`SELECT substr(entry_date, 1, 7) AS month, SUM(amount) AS amount, COUNT(*) AS n FROM entries
       WHERE type = 'fee' AND status = 'Active' AND entry_date >= ?1 GROUP BY 1 ORDER BY 1`, chartSince),
    q(`SELECT substr(entry_date, 1, 7) AS month, SUM(amount) AS amount, COUNT(*) AS n FROM entries
       WHERE type = 'refund' AND status = 'Active' AND entry_date >= ?1 GROUP BY 1 ORDER BY 1`, chartSince),
    q(`SELECT substr(entry_date, 1, 7) AS month, SUM(amount) AS amount, COUNT(*) AS n FROM entries
       WHERE type = 'teacher_payment' AND status = 'Active' AND entry_date >= ?1 GROUP BY 1 ORDER BY 1`, chartSince),
    q(`SELECT substr(entry_date, 1, 7) AS month, SUM(amount) AS amount, COUNT(*) AS n FROM entries
       WHERE type = 'expense' AND status = 'Active' AND entry_date >= ?1 GROUP BY 1 ORDER BY 1`, chartSince),
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
    // each enquirer counts once, however many times they came back; they joined if they were admitted
    q(`SELECT COUNT(*) AS enquiries, COALESCE(SUM(joined), 0) AS joined, COALESCE(SUM(demo), 0) AS demo FROM (
         SELECT COALESCE('p' || e.person_id, 'n' || lower(COALESCE(e.name, e.code))) AS who,
           MAX(EXISTS (SELECT 1 FROM people p WHERE p.kind = 'student'
             AND (p.id = e.person_id OR (e.person_id IS NULL AND p.name_key = lower(e.name) AND p.status <> 'Cancelled'))
             AND (p.status = 'Active' OR EXISTS (SELECT 1 FROM entries a WHERE a.person_id = p.id AND a.type = 'admission' AND a.status = 'Active'))))
             AS joined,
           MAX(EXISTS (SELECT 1 FROM people p WHERE p.id = e.person_id AND p.status = 'Demo')) AS demo
         FROM entries e WHERE e.type = 'enquiry' AND e.status = 'Active' AND e.entry_date >= ?1
         GROUP BY who)`, since6),
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
  const months = [];
  for (let m = firstMonth; m <= month && months.length < 13; m = shiftMonth(m, 1)) months.push(m);
  const series = (r) => {
    const map = Object.fromEntries(rows(r).map((x) => [x.month, x]));
    return months.map((m) => ({ month: m, label: monthLabel(`${m}-01`), amount: map[m] ? map[m].amount || 0 : 0, n: map[m] ? map[m].n : 0 }));
  };
  const count = (kind, status) => rows(people).filter((x) => x.kind === kind && (!status || x.status === status)).reduce((s, x) => s + x.n, 0);
  const countOf = (type, m) => {
    const hit = rows(counts).find((x) => x.type === type && x.month === m);
    return hit ? hit.n : 0;
  };
  const due = rows(notPaid).filter((s) => feeIsDue(s.plan, s.last_paid_on, today));
  const conv = rows(conversion)[0] || { enquiries: 0, joined: 0 };

  return json({
    ok: true,
    today,
    month,
    month_label: label,
    prev_month_label: monthLabel(`${prevMonth}-01`),
    fees: series(feesByMonth),
    refunds: series(refundsByMonth),
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
    conversion: { enquiries: conv.enquiries || 0, joined: conv.joined || 0, demo: conv.demo || 0 },
    left_reasons: rows(leftReasons),
    marks_attention: rows(marks),
    complaints: rows(complaints),
  });
}

function shiftMonth(yyyymm, by) {
  const [y, m] = yyyymm.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + by, 1));
  return d.toISOString().slice(0, 7);
}

/* ---------------- Changing a student's or teacher's details ---------------- */

const PERSON_FIELDS = 'code, kind, name, class, phone, status, details, joined_on, left_on, updated_at';
const CHANGED_MEANWHILE = 'These details were changed by someone else in the meantime. Open the page again and make your change.';

async function editPerson(request, env, code) {
  if (request.headers.get('x-successpath') !== '1') {
    return json({ ok: false, error: 'Please use the SuccessPath page to change details.' }, 400);
  }
  const body = await readJson(request);
  if (!body.ok) return json({ ok: false, error: body.error }, 400);
  const input = body.value;
  const kind = code.startsWith('TR-') ? 'teacher' : 'student';
  const checked = validatePersonEdit(kind, input.changes, indiaToday());
  if (!checked.ok) {
    return json({ ok: false, error: checked.errors._form || 'Please check the fields marked in red.', fields: checked.errors }, 422);
  }
  const row = await env.DB.prepare(`SELECT ${PERSON_FIELDS} FROM people WHERE code = ?1 AND status <> 'Cancelled'`).bind(code).first();
  if (!row) return json({ ok: false, error: `${code} was not found.` }, 404);
  // Saved from a page opened before someone else changed the same person.
  if (input.updated_at && input.updated_at !== row.updated_at) return json({ ok: false, error: CHANGED_MEANWHILE }, 409);

  const next = { name: row.name, class: row.class, phone: row.phone, joined_on: row.joined_on, left_on: row.left_on, status: row.status };
  let details = {};
  try { details = JSON.parse(row.details || '{}'); } catch { details = {}; }
  for (const field of PERSON_EDIT_FIELDS[kind]) {
    if (!(field.key in checked.values)) continue;
    const value = checked.values[field.key];
    if (field.to) {
      if (field.ifLeft && row.status !== 'Left') continue;
      if (field.ifStatus && !field.ifStatus.includes(row.status)) continue;
      if (field.values) {
        if (value !== null) next[field.to] = field.values[value];
        continue;
      }
      next[field.to] = value;
    } else if (value === null) {
      delete details[field.key];
    } else {
      details[field.key] = value;
    }
  }
  if (nameKey(next.name) !== nameKey(row.name)) {
    const taken = await env.DB.prepare(`SELECT code FROM people WHERE kind = ?1 AND name_key = ?2 AND status <> 'Cancelled' AND code <> ?3`)
      .bind(kind, nameKey(next.name), code).first();
    if (taken) {
      const message = `${taken.code} already has this full name. Add a surname or initial to tell them apart.`;
      return json({ ok: false, error: message, fields: { name: message } }, 422);
    }
  }
  const changes = personChanges(kind, row, next, details);
  const statements = [env.DB.prepare(`
    UPDATE people SET name = ?2, name_key = ?3, class = ?4, phone = ?5, joined_on = ?6, left_on = ?7, details = ?8,
      status = ?10, updated_at = ${NOW}
    WHERE code = ?1 AND updated_at = ?9
    RETURNING ${PERSON_FIELDS}`)
    .bind(code, next.name, nameKey(next.name), next.class, next.phone, next.joined_on, next.left_on, JSON.stringify(details), row.updated_at, next.status)];
  // For the Activity log: only when the change above was saved (changes() counts its rows).
  if (changes.length) {
    statements.push(env.DB.prepare(`
      INSERT INTO audit_log (action, person_id, details)
      SELECT 'edit', id, ?2 FROM people WHERE code = ?1 AND changes() > 0`).bind(code, JSON.stringify({ changes })));
  }
  const [saved] = await env.DB.batch(statements);
  const updated = saved && saved.results && saved.results[0];
  if (!updated) return json({ ok: false, error: CHANGED_MEANWHILE }, 409);
  let parsed = {};
  try { parsed = JSON.parse(updated.details || '{}'); } catch { /* keep empty */ }
  return json({ ok: true, person: { ...updated, details: parsed } });
}

// What Edit details changed, field by field, in words for the Activity log.
const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function shownValue(field, value) {
  if (value === null || value === undefined || value === '') return 'empty';
  if (field.kind === 'money' && Number.isFinite(Number(value))) return `₹${Number(value).toLocaleString('en-IN')}`;
  if (field.kind === 'date' && /^\d{4}-\d\d-\d\d$/.test(String(value))) {
    const [y, m, d] = String(value).split('-').map(Number);
    return `${d} ${MONTHS_SHORT[m - 1]} ${y}`;
  }
  return cut(value, 80);
}

function personChanges(kind, row, next, details) {
  let before = {};
  try { before = JSON.parse(row.details || '{}') || {}; } catch { before = {}; }
  const out = [];
  for (const field of PERSON_EDIT_FIELDS[kind]) {
    let a = field.to ? row[field.to] : before[field.key];
    let b = field.to ? next[field.to] : details[field.key];
    if (field.values) {
      const label = (v) => Object.keys(field.values).find((k) => field.values[k] === v) || v;
      a = label(a);
      b = label(b);
    }
    if (String(a ?? '') === String(b ?? '')) continue;
    out.push({ label: field.label, from: shownValue(field, a), to: shownValue(field, b) });
  }
  return out;
}

/* ---------------- Deleting a student or teacher added by mistake ---------------- */

// Nothing is removed from the database. The person is hidden (status Cancelled, like a mistyped name
// whose only entry was cancelled), their entries are cancelled with the note, leave requests still
// waiting are declined, and the audit_log row records what was changed, so Restore can put it back.
const NOTE_MAX = 300;

function deleteReason(code, note) {
  return `Deleted with ${code}: ${note}`;
}

async function deletePerson(request, env, code) {
  const body = await readJson(request);
  if (!body.ok) return json({ ok: false, error: body.error }, 400);
  const input = body.value || {};
  if (!isClientId(input.client_id)) return json({ ok: false, error: 'Missing client_id.' }, 400);
  const note = typeof input.note === 'string' ? input.note.replace(/\s+/g, ' ').trim() : '';
  if (!note || note.length > NOTE_MAX) {
    const message = note ? `Keep the note under ${NOTE_MAX} letters.` : 'Write what was wrong, for example "added twice" or "test entry".';
    return json({ ok: false, error: message, fields: { note: message } }, 422);
  }
  if (await env.DB.prepare('SELECT 1 FROM audit_log WHERE client_id = ?1').bind(input.client_id).first()) {
    return json({ ok: true, duplicate: true });
  }
  const person = await env.DB.prepare('SELECT id, kind, code, name, status FROM people WHERE code = ?1').bind(code).first();
  if (!person) return json({ ok: false, error: `${code} was not found.` }, 404);
  if (person.status === 'Cancelled') return json({ ok: false, error: `${person.name} was already deleted.` }, 409);
  const reason = deleteReason(code, note);
  const results = await env.DB.batch([
    env.DB.prepare(`
      INSERT INTO audit_log (action, person_id, note, details, client_id)
      SELECT 'delete', p.id, ?2, json_object(
          'name', p.name, 'kind', p.kind, 'status', p.status,
          'entries', json((SELECT json_group_array(code) FROM
            (SELECT code FROM entries WHERE person_id = p.id AND status = 'Active' ORDER BY id))),
          'requests', json((SELECT json_group_array(code) FROM
            (SELECT code FROM leave_requests WHERE person_id = p.id AND status = 'Pending' ORDER BY id)))),
        ?3
      FROM people p WHERE p.id = ?1 AND p.status <> 'Cancelled'
      ON CONFLICT (client_id) DO NOTHING`).bind(person.id, note, input.client_id),
    env.DB.prepare(`
      UPDATE entries SET status = 'Cancelled', cancel_reason = ?2, cancelled_at = ${NOW}, updated_at = ${NOW}
      WHERE status = 'Active' AND code IN (SELECT value FROM json_each(
        (SELECT json_extract(details, '$.entries') FROM audit_log WHERE client_id = ?1)))
      RETURNING code`).bind(input.client_id, reason),
    env.DB.prepare(`
      UPDATE leave_requests
      SET status = 'Declined', decided_by = 'Office', decided_at = ${NOW}, decision_note = ?2, updated_at = ${NOW}
      WHERE status = 'Pending' AND code IN (SELECT value FROM json_each(
        (SELECT json_extract(details, '$.requests') FROM audit_log WHERE client_id = ?1)))`).bind(input.client_id, reason),
    env.DB.prepare(`
      UPDATE people SET status = 'Cancelled', updated_at = ${NOW}
      WHERE id = ?1 AND status <> 'Cancelled'
        AND EXISTS (SELECT 1 FROM audit_log WHERE client_id = ?2 AND person_id = ?1)`).bind(person.id, input.client_id),
  ]);
  const cancelled = (results[1] && results[1].results) || [];
  return json({ ok: true, person: { code: person.code, name: person.name, kind: person.kind }, entries: cancelled.length });
}

async function restorePerson(request, env, code) {
  const body = await readJson(request);
  if (!body.ok) return json({ ok: false, error: body.error }, 400);
  const input = body.value || {};
  if (!isClientId(input.client_id)) return json({ ok: false, error: 'Missing client_id.' }, 400);
  if (await env.DB.prepare('SELECT 1 FROM audit_log WHERE client_id = ?1').bind(input.client_id).first()) {
    return json({ ok: true, duplicate: true });
  }
  const person = await env.DB.prepare('SELECT id, kind, code, name, name_key, status FROM people WHERE code = ?1').bind(code).first();
  if (!person) return json({ ok: false, error: `${code} was not found.` }, 404);
  const last = await env.DB.prepare(LAST_REMOVAL_SQL).bind(person.id).first();
  if (person.status !== 'Cancelled' || !last || last.action !== 'delete') {
    return json({ ok: false, error: `${person.name} is not deleted.` }, 409);
  }
  const taken = await env.DB.prepare(`
    SELECT code FROM people WHERE kind = ?1 AND name_key = ?2 AND status <> 'Cancelled' AND id <> ?3`)
    .bind(person.kind, person.name_key, person.id).first();
  if (taken) {
    return json({ ok: false, error: `${taken.code} is called ${person.name} now. Change that name first, then restore.` }, 409);
  }
  const d = parseDetails(last.details);
  const status = ['Active', 'Left', 'Enquiry', 'Demo'].includes(d.status) ? d.status : 'Active';
  const entries = JSON.stringify(Array.isArray(d.entries) ? d.entries : []);
  const results = await env.DB.batch([
    env.DB.prepare(`
      INSERT INTO audit_log (action, person_id, details, client_id)
      SELECT 'restore', ?1, json_object('of', ?2, 'status', ?3, 'entries', json(?4)), ?5
      WHERE EXISTS (SELECT 1 FROM people WHERE id = ?1 AND status = 'Cancelled')
      ON CONFLICT (client_id) DO NOTHING`).bind(person.id, last.id, status, entries, input.client_id),
    env.DB.prepare(`
      UPDATE people SET status = ?2, updated_at = ${NOW}
      WHERE id = ?1 AND status = 'Cancelled' AND EXISTS (SELECT 1 FROM audit_log WHERE client_id = ?3)`)
      .bind(person.id, status, input.client_id),
    env.DB.prepare(`
      UPDATE entries SET status = 'Active', cancel_reason = NULL, cancelled_at = NULL, updated_at = ${NOW}
      WHERE status = 'Cancelled' AND cancel_reason LIKE ?2 AND code IN (SELECT value FROM json_each(?3))
        AND EXISTS (SELECT 1 FROM audit_log WHERE client_id = ?1)
      RETURNING code`).bind(input.client_id, `${deleteReason(code, '')}%`, entries),
  ]);
  const back = (results[2] && results[2].results) || [];
  return json({ ok: true, person: { code: person.code, name: person.name, kind: person.kind, status }, entries: back.length });
}

/* ---------------- The Activity log ---------------- */

// What changed in the last 30 days and who made it (when that is known), newest first, read from the
// tables that already keep it: entries (saved and cancelled), audit_log (details changed, deleted,
// restored), task_history and leave_request_history. Older changes drop off the page by themselves;
// the records stay in the database. Each source is read newest first, and a page only goes as far
// back as every source has been read; "before" and "skip" ask for the next page.
//   ?who=office|teacher|student   ?what=entries|messages|cancelled|details|deleted|tasks|leave
//   ?when=today|week|month (month: the last 30 days, the most the log keeps)   ?q=words
const LOG_PAGE = 40;
const LOG_DAYS = { week: 7, month: 30 };
const LOG_WHAT = {
  entries: ['e'], messages: ['e'], cancelled: ['c'], details: ['a'], deleted: ['a'], tasks: ['t'], leave: ['l'],
};
const FAR_FUTURE = '9999-12-31T23:59:59.999Z';
const MESSAGE_FROM_TEACHER = "json_extract(e.data, '$.from') = 'Teacher'";
const BY_STUDENT = `((e.type = 'portal_message' AND NOT COALESCE(${MESSAGE_FROM_TEACHER}, 0))
  OR (e.type = 'exam' AND json_extract(e.data, '$.added_by') IS NOT NULL))`;

function logSources(who, what) {
  const wanted = (key) => what === 'all' || LOG_WHAT[what].includes(key);
  const entryWhat = { entries: "e.type <> 'portal_message'", messages: "e.type = 'portal_message'" }[what] || '1';
  const auditWhat = { details: "a.action = 'edit'", deleted: "a.action IN ('delete', 'restore')" }[what] || '1';
  const entryWho = {
    all: '1',
    office: `NOT (e.type = 'portal_message' OR (e.type = 'exam' AND json_extract(e.data, '$.added_by') IS NOT NULL))`,
    teacher: `e.type = 'portal_message' AND COALESCE(${MESSAGE_FROM_TEACHER}, 0)`,
    student: BY_STUDENT,
  }[who];
  const list = [];
  if (wanted('e')) {
    list.push({
      key: 'e',
      sql: `SELECT e.id, e.type, e.code, e.status, e.entry_date, e.name, e.amount, json(e.data) AS data,
          e.cancel_reason, e.created_at AS at, p.code AS person_code, p.name AS person_name, p.kind AS person_kind
        FROM entries e LEFT JOIN people p ON p.id = e.person_id
        WHERE e.created_at <= ?1 AND e.created_at >= ?4 AND e.client_id NOT LIKE 'leave-request-%'
          AND ${entryWho} AND ${entryWhat}
          AND (?3 IS NULL OR e.code LIKE ?3 OR e.name LIKE ?3 OR p.name LIKE ?3 OR e.data LIKE ?3)
        ORDER BY e.created_at DESC LIMIT ?2`,
    });
  }
  if ((who === 'all' || who === 'office') && wanted('c')) {
    list.push({
      key: 'c',
      sql: `SELECT e.id, e.type, e.code, e.status, e.entry_date, e.name, e.amount, json(e.data) AS data,
          e.cancel_reason, e.cancelled_at AS at, p.code AS person_code, p.name AS person_name, p.kind AS person_kind
        FROM entries e LEFT JOIN people p ON p.id = e.person_id
        WHERE e.cancelled_at IS NOT NULL AND e.cancelled_at <= ?1 AND e.cancelled_at >= ?4 AND e.status = 'Cancelled'
          AND COALESCE(e.cancel_reason, '') NOT LIKE 'Deleted with %'
          AND (?3 IS NULL OR e.code LIKE ?3 OR e.name LIKE ?3 OR p.name LIKE ?3 OR e.cancel_reason LIKE ?3)
        ORDER BY e.cancelled_at DESC LIMIT ?2`,
    });
  }
  if ((who === 'all' || who === 'office') && wanted('a')) {
    list.push({
      key: 'a',
      sql: `SELECT a.id, a.action, a.by_name, a.note, a.details, a.created_at AS at,
          p.code AS person_code, p.name AS person_name, p.kind AS person_kind, p.status AS person_status
        FROM audit_log a JOIN people p ON p.id = a.person_id
        WHERE a.created_at <= ?1 AND a.created_at >= ?4 AND ${auditWhat}
          AND (?3 IS NULL OR p.name LIKE ?3 OR p.code LIKE ?3 OR a.note LIKE ?3 OR a.details LIKE ?3)
        ORDER BY a.created_at DESC LIMIT ?2`,
    });
  }
  if (who !== 'student' && wanted('t')) {
    // Tasks changed before version 3 do not say who changed them: they are left out of "Office" and "Teachers".
    const taskWho = { all: '1', office: "json_extract(h.snapshot, '$.changed_by') = 'Office'",
      teacher: "json_extract(h.snapshot, '$.changed_by') <> 'Office'" }[who];
    list.push({
      key: 't',
      sql: `SELECT h.id, h.action, h.snapshot, h.changed_at AS at,
          (SELECT h2.snapshot FROM task_history h2 WHERE h2.task_id = h.task_id AND h2.id < h.id
           ORDER BY h2.id DESC LIMIT 1) AS before
        FROM task_history h
        WHERE h.changed_at <= ?1 AND h.changed_at >= ?4 AND ${taskWho} AND (?3 IS NULL OR h.snapshot LIKE ?3)
        ORDER BY h.changed_at DESC LIMIT ?2`,
    });
  }
  if (who !== 'student' && wanted('l')) {
    const leaveWho = { all: "h.action IN ('asked', 'withdrawn', 'approved', 'declined')",
      office: "h.action IN ('approved', 'declined')", teacher: "h.action IN ('asked', 'withdrawn')" }[who];
    list.push({
      key: 'l',
      sql: `SELECT h.id, h.action, h.snapshot, h.at, r.code, p.code AS person_code, p.name AS person_name
        FROM leave_request_history h JOIN leave_requests r ON r.id = h.request_id JOIN people p ON p.id = r.person_id
        WHERE h.at <= ?1 AND h.at >= ?4 AND ${leaveWho}
          AND NOT (h.action = 'declined' AND COALESCE(json_extract(h.snapshot, '$.decision_note'), '') LIKE 'Deleted with %')
          AND (?3 IS NULL OR p.name LIKE ?3 OR r.code LIKE ?3 OR h.snapshot LIKE ?3)
        ORDER BY h.at DESC LIMIT ?2`,
    });
  }
  return list;
}

const TASK_WORDS = ['title', 'notes', 'stage', 'start_on', 'due_on', 'budget', 'owner'];

function logItem(source, row) {
  const person = row.person_code ? { code: row.person_code, name: row.person_name, kind: row.person_kind } : null;
  const base = { key: `${source}${row.id}`, at: row.at };
  if (source === 'e' || source === 'c') {
    const data = parseDetails(row.data);
    const entry = {
      code: row.code, type: row.type, status: row.status, entry_date: row.entry_date, name: row.name,
      amount: row.amount, data, cancel_reason: row.cancel_reason,
    };
    let who = { role: 'office', name: 'Office' };
    if (source === 'e' && row.type === 'portal_message') {
      who = data.from === 'Teacher'
        ? { role: 'teacher', name: data.teacher_name || 'A teacher', code: data.teacher_code || null }
        : { role: 'student', name: data.student_name || (person && person.name) || 'A student', code: person && person.code };
    } else if (source === 'e' && row.type === 'exam' && data.added_by) {
      who = { role: 'student', name: data.student_name || (person && person.name) || 'A student', code: person && person.code };
    }
    return { ...base, source: source === 'e' ? 'entry' : 'cancel', who, entry, person };
  }
  if (source === 'a') {
    return {
      ...base, source: 'audit', who: { role: 'office', name: row.by_name || 'Office' }, action: row.action,
      note: row.note, details: parseDetails(row.details), person: { ...person, status: row.person_status },
    };
  }
  if (source === 't') {
    const task = parseDetails(row.snapshot);
    const before = row.before ? parseDetails(row.before) : null;
    // Dragging a card up or down the same column changes nothing worth logging.
    if (row.action !== 'created' && before && TASK_WORDS.every((k) => String(task[k] ?? '') === String(before[k] ?? ''))) return null;
    const by = task.changed_by || null; // not known for changes saved before version 3
    const pick = (t) => t && Object.fromEntries(['code', ...TASK_WORDS].map((k) => [k, t[k] ?? null]));
    return {
      ...base, source: 'task',
      who: by === null ? null : by === 'Office' ? { role: 'office', name: 'Office' } : { role: 'teacher', name: by },
      action: row.action === 'created' ? 'created' : 'changed', task: pick(task), before: row.action === 'created' ? null : pick(before),
    };
  }
  const snap = parseDetails(row.snapshot);
  const teacher = { role: 'teacher', name: row.person_name, code: row.person_code };
  return {
    ...base, source: 'leave', action: row.action,
    who: row.action === 'asked' || row.action === 'withdrawn' ? teacher : { role: 'office', name: snap.decided_by || 'Office' },
    request: {
      code: row.code, from: snap.from, to: snap.to, reason: snap.reason, notes: snap.notes,
      decision_note: snap.decision_note || null, leave_code: snap.leave_code || null,
    },
    person: { code: row.person_code, name: row.person_name, kind: 'teacher' },
  };
}

async function activityLog(env, url) {
  const pick = (name, allowed, otherwise) => (allowed.includes(url.searchParams.get(name)) ? url.searchParams.get(name) : otherwise);
  const who = pick('who', ['office', 'teacher', 'student'], 'all');
  const what = pick('what', Object.keys(LOG_WHAT), 'all');
  const when = pick('when', ['today', 'week', 'month'], 'month');
  const since = when === 'today'
    ? new Date(`${indiaToday()}T00:00:00+05:30`).toISOString()
    : new Date(Date.now() - LOG_DAYS[when] * 86400000).toISOString();
  const q = (url.searchParams.get('q') || '').replace(/[%_]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);
  const like = q ? `%${q}%` : null;
  const cursor = url.searchParams.get('before') || '';
  const before = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?Z$/.test(cursor) ? cursor : FAR_FUTURE;
  const skip = new Set((url.searchParams.get('skip') || '').split(',').filter((k) => /^[ecatl]\d{1,12}$/.test(k)).slice(0, 200));
  const limit = LOG_PAGE + skip.size;
  const sources = logSources(who, what);
  const results = sources.length
    ? await env.DB.batch(sources.map((src) => env.DB.prepare(src.sql).bind(before, limit, like, since)))
    : [];

  // Only as far back as every source was read: a source that filled its limit may have older rows.
  let horizon = null;
  const raw = [];
  sources.forEach((src, i) => {
    const rows = (results[i] && results[i].results) || [];
    if (rows.length >= limit) {
      const oldest = rows[rows.length - 1].at;
      if (horizon === null || oldest > horizon) horizon = oldest;
    }
    for (const row of rows) raw.push({ source: src.key, row });
  });
  let items = [];
  for (const { source, row } of raw) {
    if (skip.has(`${source}${row.id}`)) continue;
    if (horizon !== null && row.at < horizon) continue;
    const item = logItem(source, row);
    if (item) items.push(item);
  }
  items.sort((a, b) => (a.at === b.at ? (a.key < b.key ? 1 : -1) : (a.at < b.at ? 1 : -1)));
  let next = null;
  let handled = [];
  if (items.length > LOG_PAGE) {
    // The page is full: the next one starts at its last item, skipping what was shown at that time.
    items = items.slice(0, LOG_PAGE);
    next = items[items.length - 1].at;
    handled = items.filter((it) => it.at === next).map((it) => it.key);
  } else if (horizon !== null) {
    // Every row read at the horizon was shown (or had nothing worth showing): skip them all.
    next = horizon;
    handled = raw.filter(({ row }) => row.at === next).map(({ source, row }) => `${source}${row.id}`);
  }
  const nextSkip = next ? [...new Set([...(next === before ? skip : []), ...handled])] : [];
  return json({ ok: true, who, what, when, since, q, items, next: next ? { before: next, skip: nextSkip } : null });
}

/* ---------------- Leave calendar ---------------- */

// For one month: every teacher (to work out who is on staff each day), the leave that touches the
// month, and the institute's holidays. Dates of one-day leave or holidays have no "to".
const CALENDAR_SQL = `
SELECT
  (SELECT json_group_array(json_object('code', code, 'name', name, 'status', status, 'joined_on', joined_on, 'left_on', left_on))
   FROM (SELECT * FROM people WHERE kind = 'teacher' AND status IN ('Active', 'Left') ORDER BY name COLLATE NOCASE)) AS teachers,
  (SELECT json_group_array(json_object('code', x.code, 'person_code', x.person_code, 'name', x.name, 'from', x.d1, 'to', x.d2,
      'reason', x.reason, 'notes', x.notes))
   FROM (
     SELECT e.code, e.id, p.code AS person_code, COALESCE(p.name, e.name) AS name,
       COALESCE(e.entry_date, json_extract(e.data, '$.to')) AS d1,
       COALESCE(json_extract(e.data, '$.to'), e.entry_date) AS d2,
       json_extract(e.data, '$.reason') AS reason, json_extract(e.data, '$.notes') AS notes
     FROM entries e LEFT JOIN people p ON p.id = e.person_id
     WHERE e.type = 'leave' AND e.status = 'Active'
       AND COALESCE(e.entry_date, json_extract(e.data, '$.to')) <= ?2
       AND COALESCE(json_extract(e.data, '$.to'), e.entry_date) >= ?1
     ORDER BY d1, e.id
     LIMIT 400) AS x) AS leaves,
  (SELECT json_group_array(json_object('code', x.code, 'name', x.name, 'from', x.d1, 'to', x.d2, 'notes', x.notes))
   FROM (
     SELECT e.code, e.id, e.name,
       COALESCE(e.entry_date, json_extract(e.data, '$.to')) AS d1,
       COALESCE(json_extract(e.data, '$.to'), e.entry_date) AS d2,
       json_extract(e.data, '$.notes') AS notes
     FROM entries e
     WHERE e.type = 'holiday' AND e.status = 'Active'
       AND COALESCE(e.entry_date, json_extract(e.data, '$.to')) <= ?2
       AND COALESCE(json_extract(e.data, '$.to'), e.entry_date) >= ?1
     ORDER BY d1, e.id
     LIMIT 100) AS x) AS holidays,
  (SELECT json_group_array(json_object('code', r.code, 'person_code', p.code, 'name', p.name, 'from', r.from_date,
      'to', r.to_date, 'reason', r.reason, 'status', r.status))
   FROM leave_requests r JOIN people p ON p.id = r.person_id
   WHERE r.status = 'Pending' AND r.from_date <= ?2 AND r.to_date >= ?1) AS requests`;

async function leaveCalendar(env, url) {
  const today = indiaToday();
  const asked = url.searchParams.get('month') || '';
  const month = /^(19|20)\d\d-(0[1-9]|1[0-2])$/.test(asked) ? asked : today.slice(0, 7);
  const row = await env.DB.prepare(CALENDAR_SQL).bind(`${month}-01`, `${month}-31`).first();
  const body = `{"ok":true,"month":${JSON.stringify(month)},"today":${JSON.stringify(today)},`
    + `"teachers":${(row && row.teachers) || '[]'},"leaves":${(row && row.leaves) || '[]'},`
    + `"holidays":${(row && row.holidays) || '[]'},"requests":${(row && row.requests) || '[]'}}`;
  return new Response(body, { headers: JSON_HEADERS });
}

/* ---------------- Leave requests: a teacher asks, the office approves ---------------- */

const LEAVE_REQUEST_JSON = `json_object('code', r.code, 'person_code', p.code, 'name', p.name, 'from', r.from_date,
  'to', r.to_date, 'reason', r.reason, 'notes', r.notes, 'status', r.status, 'decided_by', r.decided_by,
  'decided_at', r.decided_at, 'decision_note', r.decision_note, 'leave_code', r.leave_code, 'created_at', r.created_at)`;

// ?1 = 1 for every status (newest first), otherwise only the ones waiting (soonest first); ?2 = a teacher's id or null.
const LEAVE_REQUESTS_SQL = `
SELECT json_group_array(${LEAVE_REQUEST_JSON}) AS requests
FROM (SELECT * FROM leave_requests WHERE (?1 = 1 OR status = 'Pending') AND (?2 IS NULL OR person_id = ?2)
      ORDER BY CASE WHEN ?1 = 1 THEN -id ELSE 0 END, from_date, id LIMIT 100) AS r
JOIN people p ON p.id = r.person_id`;

async function listLeaveRequests(env, url) {
  const all = url.searchParams.get('status') === 'all' ? 1 : 0;
  const row = await env.DB.prepare(LEAVE_REQUESTS_SQL).bind(all, null).first();
  return new Response(`{"ok":true,"requests":${(row && row.requests) || '[]'}}`, { headers: JSON_HEADERS });
}

async function oneLeaveRequest(env, code) {
  const row = await env.DB.prepare(`SELECT ${LEAVE_REQUEST_JSON} AS request FROM leave_requests r JOIN people p ON p.id = r.person_id WHERE r.code = ?1`)
    .bind(code).first();
  return row ? JSON.parse(row.request) : null;
}

async function decideLeaveRequest(request, env, code) {
  const body = await readJson(request);
  if (!body.ok) return json({ ok: false, error: body.error }, 400);
  const { action } = body.value;
  if (!['approve', 'decline'].includes(action)) return json({ ok: false, error: 'Choose approve or decline.' }, 400);
  const note = typeof body.value.note === 'string' && body.value.note.trim() ? body.value.note.trim().slice(0, 300) : null;
  const r = await oneLeaveRequest(env, code);
  if (!r) return json({ ok: false, error: 'This leave request was not found.' }, 404);
  if (r.status !== 'Pending') {
    // a tap sent twice over a weak connection is answered as done
    if ((r.status === 'Approved' && action === 'approve') || (r.status === 'Declined' && action === 'decline')) {
      return json({ ok: true, request: r, already: true });
    }
    return json({ ok: false, error: `This request was already ${r.status.toLowerCase()}.`, request: r }, 409);
  }
  let leaveCode = null;
  if (action === 'approve') {
    // The approved leave is an ordinary Teacher leave entry, so the calendar, the teacher's page and
    // the Google Sheet show it like leave booked by the office.
    const form = getForm('leave');
    const checked = validateEntry(form, {
      teacher_name: r.name, from: r.from, to: r.to !== r.from ? r.to : undefined,
      reason: r.reason || undefined, notes: r.notes || undefined, request_code: r.code,
    }, indiaToday());
    if (!checked.ok) return json({ ok: false, error: checked.errors._form || 'This request cannot be saved as leave.', fields: checked.errors }, 422);
    const saved = await storeEntry(env, form, checked.data, { client_id: `leave-request-${r.code}`, cancel_token: randomToken(), person_code: r.person_code });
    const out = await saved.json();
    if (!out.ok) return json(out, saved.status);
    leaveCode = out.entry.code;
  }
  await env.DB.prepare(`UPDATE leave_requests SET status = ?2, decided_by = 'Office', decided_at = ${NOW},
      decision_note = ?3, leave_code = ?4, updated_at = ${NOW}
    WHERE code = ?1 AND status = 'Pending'`).bind(code, action === 'approve' ? 'Approved' : 'Declined', note, leaveCode).run();
  return json({ ok: true, request: await oneLeaveRequest(env, code) });
}

const LEAVE_DAYS_MAX = 62;

async function teacherAskLeave(request, env, me) {
  const body = await readJson(request);
  if (!body.ok) return json({ ok: false, error: body.error }, 400);
  const input = body.value;
  if (!isClientId(input.client_id)) return json({ ok: false, error: 'Please reload the page and try again.' }, 400);
  const resent = await env.DB.prepare(`SELECT r.code FROM leave_requests r WHERE r.client_id = ?1`).bind(input.client_id).first();
  if (resent) return json({ ok: true, request: await oneLeaveRequest(env, resent.code), duplicate: true });

  const today = indiaToday();
  const reasons = getForm('leave').fields.find((f) => f.key === 'reason').options;
  const fields = {};
  const from = typeof input.from === 'string' ? input.from.trim() : '';
  const to = typeof input.to === 'string' && input.to.trim() ? input.to.trim() : from;
  if (!isRealDate(from)) fields.from = 'Pick the first day of leave.';
  else if (from < today) fields.from = 'Pick today or a later day. The office books leave that has already been taken.';
  if (!fields.from) {
    if (!isRealDate(to)) fields.to = 'Pick the last day of leave.';
    else if (to < from) fields.to = 'The last day cannot be before the first day.';
    else if (daysBetween(from, to) + 1 > LEAVE_DAYS_MAX) fields.to = 'Ask for up to 2 months at a time.';
  }
  const reason = typeof input.reason === 'string' && input.reason ? input.reason : null;
  if (reason && !reasons.includes(reason)) fields.reason = 'Choose a reason from the list.';
  const notes = typeof input.notes === 'string' && input.notes.trim() ? input.notes.trim() : null;
  if (notes && notes.length > 500) fields.notes = 'Please keep this under 500 characters.';
  if (Object.keys(fields).length) return json({ ok: false, error: 'Please check the fields marked in red.', fields }, 422);

  const [asked, booked, today_n] = await env.DB.batch([
    env.DB.prepare(`SELECT code FROM leave_requests WHERE person_id = ?1 AND status IN ('Pending', 'Approved')
      AND from_date <= ?3 AND to_date >= ?2 LIMIT 1`).bind(me.id, from, to),
    env.DB.prepare(`SELECT code FROM entries WHERE type = 'leave' AND status = 'Active' AND person_id = ?1
      AND COALESCE(entry_date, json_extract(data, '$.to')) <= ?3 AND COALESCE(json_extract(data, '$.to'), entry_date) >= ?2 LIMIT 1`).bind(me.id, from, to),
    env.DB.prepare(`SELECT COUNT(*) AS n FROM leave_requests WHERE person_id = ?1 AND created_at >= ?2`)
      .bind(me.id, new Date(Date.now() - 86400000).toISOString()),
  ]);
  if (asked.results.length) return json({ ok: false, error: `You already asked for leave on some of these days (${asked.results[0].code}).`, fields: { from: 'These days are already asked for.' } }, 422);
  if (booked.results.length) return json({ ok: false, error: 'The office has already booked leave for you on some of these days.', fields: { from: 'Leave is already booked on these days.' } }, 422);
  if (Number(today_n.results[0].n) >= 10) return json({ ok: false, error: 'That is a lot of requests for one day. Please ask the office.' }, 429);

  await env.DB.prepare(`
    INSERT INTO leave_requests (seq, code, person_id, from_date, to_date, reason, notes, client_id)
    SELECT nx.n, printf('LRQ-%04d', nx.n), ?1, ?2, ?3, ?4, ?5, ?6
    FROM (SELECT COALESCE(MAX(seq), 0) + 1 AS n FROM leave_requests) AS nx
    WHERE true
    ON CONFLICT (client_id) DO NOTHING`).bind(me.id, from, to, reason, notes, input.client_id).run();
  const made = await env.DB.prepare('SELECT code FROM leave_requests WHERE client_id = ?1').bind(input.client_id).first();
  return json({ ok: true, request: await oneLeaveRequest(env, made.code) }, 201);
}

async function teacherWithdrawLeave(env, me, code) {
  const res = await env.DB.prepare(`UPDATE leave_requests SET status = 'Withdrawn', decided_by = ?3, decided_at = ${NOW}, updated_at = ${NOW}
    WHERE code = ?1 AND person_id = ?2 AND status = 'Pending'`).bind(code, me.id, me.name).run();
  const r = await oneLeaveRequest(env, code);
  if (!r || r.person_code !== me.code) return json({ ok: false, error: 'This leave request was not found.' }, 404);
  if (!res.meta || !res.meta.changes) {
    if (r.status === 'Withdrawn') return json({ ok: true, request: r, already: true });
    return json({ ok: false, error: `This request was already ${r.status.toLowerCase()}.`, request: r }, 409);
  }
  return json({ ok: true, request: r });
}

// The leave calendar for a teacher: who is away (names only; the reasons are their own business),
// holidays, and this teacher's own requests.
async function teacherCalendar(env, me, url) {
  const today = indiaToday();
  const asked = url.searchParams.get('month') || '';
  const month = /^(19|20)\d\d-(0[1-9]|1[0-2])$/.test(asked) ? asked : today.slice(0, 7);
  const [row, mine] = await env.DB.batch([
    env.DB.prepare(CALENDAR_SQL).bind(`${month}-01`, `${month}-31`),
    env.DB.prepare(`SELECT json_group_array(json_object('code', code, 'from', from_date, 'to', to_date, 'reason', reason, 'status', status)) AS requests
      FROM leave_requests WHERE person_id = ?1 AND status IN ('Pending', 'Declined') AND from_date <= ?3 AND to_date >= ?2`)
      .bind(me.id, `${month}-01`, `${month}-31`),
  ]);
  const r = row.results[0] || {};
  const leaves = JSON.parse(r.leaves || '[]').map((l) => (l.person_code === me.code ? l : { ...l, reason: null, notes: null }));
  const teachers = JSON.parse(r.teachers || '[]').map((t) => ({ code: t.code, name: t.name, status: t.status, joined_on: t.joined_on, left_on: t.left_on }));
  return json({
    ok: true, month, today, me: me.code, teachers, leaves, holidays: JSON.parse(r.holidays || '[]'),
    requests: JSON.parse((mine.results[0] && mine.results[0].requests) || '[]'),
  });
}

async function teacherLeave(env, me) {
  const today = indiaToday();
  const [requests, leave, holidays] = await env.DB.batch([
    env.DB.prepare(LEAVE_REQUESTS_SQL).bind(1, me.id),
    env.DB.prepare(`SELECT code, entry_date AS "from", COALESCE(json_extract(data, '$.to'), entry_date) AS "to",
        json_extract(data, '$.reason') AS reason, json_extract(data, '$.request_code') AS request_code
      FROM entries WHERE person_id = ?1 AND type = 'leave' AND status = 'Active'
        AND COALESCE(json_extract(data, '$.to'), entry_date) >= ?2
      ORDER BY entry_date LIMIT 30`).bind(me.id, today),
    env.DB.prepare(`SELECT code, entry_date AS "from", COALESCE(json_extract(data, '$.to'), entry_date) AS "to",
        COALESCE(json_extract(data, '$.holiday'), name) AS name
      FROM entries WHERE type = 'holiday' AND status = 'Active' AND COALESCE(json_extract(data, '$.to'), entry_date) >= ?1
      ORDER BY entry_date LIMIT 30`).bind(today),
  ]);
  return json({
    ok: true, today, requests: JSON.parse((requests.results[0] && requests.results[0].requests) || '[]'),
    leave: leave.results, holidays: holidays.results,
    reasons: getForm('leave').fields.find((f) => f.key === 'reason').options,
  });
}

/* ---------------- The Tasks board ---------------- */

const TASK_JSON = `json_object(
  'code', code, 'title', title, 'notes', notes, 'stage', stage, 'start_on', start_on, 'due_on', due_on,
  'budget', budget, 'owner', owner, 'changed_by', changed_by,
  'position', position, 'created_at', created_at, 'updated_at', updated_at, 'done_at', done_at)`;
const TASK_FIELDS = 'code, title, notes, stage, start_on, due_on, budget, owner, changed_by, position, created_at, updated_at, done_at';
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
  (SELECT json_group_array(name) FROM (
     SELECT name FROM people WHERE kind = 'teacher' AND status = 'Active' ORDER BY name)) AS teachers,
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
    + `"teachers":${(row && row.teachers) || '[]'},`
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
  for (const key of ['start_on', 'due_on']) {
    if (!(key in input) || input[key] === undefined) continue;
    const d = input[key] === null ? '' : String(input[key]).trim();
    if (d && !isRealDate(d)) fields[key] = 'Pick a date.';
    else value[key] = d || null;
  }
  if (value.start_on && value.due_on && value.due_on < value.start_on) fields.due_on = 'The end date cannot be before the start date.';
  if ('budget' in input && input.budget !== undefined) {
    const text = input.budget === null ? '' : String(input.budget).replace(/[₹,\s]/g, '').replace(/^rs\.?/i, '');
    if (!text) value.budget = null;
    else if (!/^\d+(\.\d{1,2})?$/.test(text) || Number(text) > 10000000) fields.budget = 'Enter the budget in rupees, like 5000.';
    else value.budget = Number(text);
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
INSERT INTO tasks (seq, code, title, notes, due_on, owner, stage, position, client_id, start_on, budget, changed_by)
SELECT nx.n, printf('TSK-%04d', nx.n), ?1, ?2, ?3, ?4, 'To do',
  COALESCE((SELECT MIN(position) FROM tasks WHERE stage = 'To do'), 1) - 1, ?5, ?6, ?7, ?8
FROM (SELECT COALESCE(MAX(seq), 0) + 1 AS n FROM tasks) AS nx
WHERE true
ON CONFLICT (client_id) DO NOTHING
RETURNING ${TASK_FIELDS}`;

async function createTask(request, env, who = 'Office') {
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
    .bind(t.title, t.notes ?? null, t.due_on ?? null, t.owner ?? null, input.client_id, t.start_on ?? null, t.budget ?? null, who)
    .first();
  if (created) return json({ ok: true, task: created }, 201);
  // Sent twice (for example after a weak connection): return the task saved the first time.
  const existing = await env.DB.prepare(`SELECT ${TASK_FIELDS} FROM tasks WHERE client_id = ?1`).bind(input.client_id).first();
  if (!existing) return json({ ok: false, error: 'Please reload the page and try again.' }, 409);
  return json({ ok: true, duplicate: true, task: existing });
}

async function updateTask(request, env, code, who = 'Office') {
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
  for (const key of ['title', 'notes', 'owner', 'start_on', 'due_on', 'budget']) {
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
  sets.push(`updated_at = ${NOW}`, `changed_by = ${param(who)}`);

  const updated = await env.DB.prepare(`UPDATE tasks SET ${sets.join(', ')} WHERE code = ?1 RETURNING ${TASK_FIELDS}`)
    .bind(...params)
    .first();
  if (!updated) return json({ ok: false, error: `Task ${code} was not found.` }, 404);
  return json({ ok: true, task: updated });
}

function daysBetween(a, b) {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
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
      'refunded', (SELECT COALESCE(SUM(r.amount), 0) FROM entries r WHERE r.person_id = p.id AND r.type = 'refund' AND r.status = 'Active'),
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
      'start_on', start_on, 'due_on', due_on, 'budget', budget, 'owner', owner, 'changed_by', changed_by,
      'position', position, 'client_id', client_id,
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

function json(value, status = 200, headers = {}) {
  return new Response(JSON.stringify(value), { status, headers: { ...JSON_HEADERS, ...headers } });
}

function methodNotAllowed(allowed) {
  return new Response(JSON.stringify({ ok: false, error: `Use ${allowed}.` }), {
    status: 405,
    headers: { ...JSON_HEADERS, allow: allowed },
  });
}
