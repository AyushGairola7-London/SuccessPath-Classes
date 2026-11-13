// SuccessPath Classes: the server.
//
// Runs on Cloudflare Workers. The web page in /public is served by Cloudflare directly;
// this file only answers the /api/ addresses:
//
//   POST /api/entries               save a new entry (used by the web page)
//   POST /api/entries/<id>/cancel   mark an entry as cancelled (only from the device that saved it)
//   GET  /api/health                quick check that the server and database are working
//   GET  /api/sync                  changes since the last sync   (Google Sheet only, needs SYNC_KEY)
//   GET  /api/export                every entry, page by page     (Google Sheet backups, needs SYNC_KEY)
//
// Nothing here ever shows stored data to the web page, so the page needs no login.

import { APP_NAME, APP_VERSION, getForm, validateEntry, fixedColumns, sheetSchema, indiaToday } from '../public/forms.js';

const SCHEMA_JSON = JSON.stringify(sheetSchema());
const MAX_BODY_CHARS = 20000;
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
      if (/no such table/i.test(message)) {
        return json({ ok: false, error: 'The database is not set up yet. Run: npm run db:setup' }, 503);
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
    await env.DB.prepare('SELECT id FROM entries LIMIT 1').first();
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

  if (path === '/api/sync' || path === '/api/export') {
    if (method !== 'GET') return methodNotAllowed('GET');
    const auth = checkSyncKey(request, env);
    if (auth !== 'ok') return auth;
    return path === '/api/sync' ? syncFeed(env, url) : exportPage(env, url);
  }

  return json({ ok: false, error: 'Not found' }, 404);
}

/* ---------------- Saving an entry ---------------- */

const INSERT_SQL = `
INSERT INTO entries (type, seq, code, entry_date, name, phone, amount, data, client_id, cancel_hash)
SELECT ?1, nx.n, printf('%s-%04d', ?2, nx.n), ?3, ?4, ?5, ?6, ?7, ?8, ?9
FROM (SELECT COALESCE(MAX(seq), 0) + 1 AS n FROM entries WHERE type = ?1) AS nx
WHERE true
ON CONFLICT (client_id) DO NOTHING
RETURNING code, status, created_at`;

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
    return json({ ok: false, error: 'Please check the fields marked in red.', fields: checked.errors }, 422);
  }

  const fixed = fixedColumns(form, checked.data);
  const cancelHash = await sha256Hex(input.cancel_token);
  const inserted = await env.DB.prepare(INSERT_SQL)
    .bind(
      form.type, form.prefix,
      fixed.entry_date, fixed.name, fixed.phone, fixed.amount,
      JSON.stringify(checked.data), input.client_id, cancelHash,
    )
    .first();
  if (inserted) return json({ ok: true, entry: inserted }, 201);

  // The device sent the same entry again (for example after a weak connection). Do not save it twice.
  const existing = await env.DB.prepare('SELECT code, type, status, created_at FROM entries WHERE client_id = ?1')
    .bind(input.client_id)
    .first();
  if (existing && existing.type === form.type) {
    return json({ ok: true, duplicate: true, entry: { code: existing.code, status: existing.status, created_at: existing.created_at } });
  }
  return json({ ok: false, error: 'Please reload the page and try again.' }, 409);
}

/* ---------------- Cancelling an entry ---------------- */

const CANCEL_SQL = `
UPDATE entries
SET status = 'Cancelled',
    cancel_reason = ?2,
    cancelled_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
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
  if (reason.length < 3) {
    return json({ ok: false, error: 'Please write why this entry is being cancelled.', fields: { reason: 'Please write a short reason.' } }, 422);
  }

  const hash = await sha256Hex(token);
  const updated = await env.DB.prepare(CANCEL_SQL).bind(code, reason.slice(0, 300), hash).first();
  if (updated) return json({ ok: true, entry: updated });

  const existing = await env.DB.prepare('SELECT status, cancel_hash FROM entries WHERE code = ?1').bind(code).first();
  if (!existing) return json({ ok: false, error: `Entry ${code} was not found.` }, 404);
  if (existing.cancel_hash !== hash) {
    return json({ ok: false, error: 'This entry can only be cancelled on the device it was saved from.' }, 403);
  }
  return json({ ok: true, already: true, entry: { code, status: existing.status } });
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
  (SELECT json_group_array(json_object(
      'log_id', h.id,
      'entry', json_object(
        'id', e.id, 'type', e.type, 'seq', e.seq, 'code', e.code, 'status', e.status,
        'data', json(e.data), 'created_at', e.created_at, 'updated_at', e.updated_at,
        'cancelled_at', e.cancelled_at, 'cancel_reason', e.cancel_reason)))
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
  (SELECT COUNT(*) FROM entries) AS total,
  (SELECT json_group_array(json_object(
      'id', id, 'type', type, 'seq', seq, 'code', code, 'status', status,
      'entry_date', entry_date, 'name', name, 'phone', phone, 'amount', amount,
      'data', json(data), 'client_id', client_id,
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
    + `"entries":${(row && row.entries) || '[]'},"next_after_id":${lastId},"has_more":${count >= limit}}`;
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
