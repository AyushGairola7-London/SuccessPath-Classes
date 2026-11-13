// Tests for the server and the database rules. Run with: npm test
// They use a temporary in-memory database, so nothing real is touched.

import test from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import worker from '../src/worker.js';
import { createD1 } from './d1-mock.mjs';
import { FORMS, checkForms, sheetSchema, validateEntry, getForm } from '../public/forms.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const KEY = 'test-sync-key-0123456789abcdef';

function freshEnv(extra = {}) {
  return { DB: createD1(':memory:', join(ROOT, 'migrations')), SYNC_KEY: KEY, ...extra };
}

let counter = 0;
function ids() {
  counter += 1;
  return {
    client_id: `client-${String(counter).padStart(6, '0')}-abcdef`,
    cancel_token: (counter.toString(16) + '0'.repeat(32)).slice(0, 32),
  };
}

async function call(env, method, path, { body, headers = {}, raw } = {}) {
  const init = { method, headers: { ...headers } };
  if (body !== undefined || raw !== undefined) {
    init.body = raw !== undefined ? raw : JSON.stringify(body);
    if (!init.headers['content-type']) init.headers['content-type'] = 'application/json';
  }
  const res = await worker.fetch(new Request(`https://app.test${path}`, init), env);
  const text = await res.text();
  let data = null;
  try { data = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, data, text };
}

function save(env, type, data, extra = {}) {
  const id = ids();
  return call(env, 'POST', '/api/entries', {
    headers: { 'x-successpath': '1' },
    body: { ...id, type, data, ...extra },
  }).then((r) => ({ ...r, ...id }));
}

const today = new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
const fee = (over = {}) => ({ date: today, student_name: 'Rahul Sharma', class: 'Class 9', amount: '1,500', mode: 'UPI', ...over });

test('the forms file has no mistakes and makes unique sheet columns', () => {
  assert.deepEqual(checkForms(), []);
  for (const tab of sheetSchema().tabs) {
    const labels = tab.columns.map((c) => c.label);
    assert.equal(new Set(labels).size, labels.length, `duplicate column in ${tab.tab}`);
    assert.equal(labels[0], 'Entry ID');
  }
});

test('checkForms catches common mistakes', () => {
  const broken = [
    { ...FORMS[0], prefix: 'fee' },
    { ...FORMS[0], type: 'fee', fields: [{ key: 'x', label: 'X', kind: 'dropdown' }] },
  ];
  const problems = checkForms(broken);
  assert.ok(problems.some((p) => p.includes('prefix')));
  assert.ok(problems.some((p) => p.includes('another form already uses the type')));
  assert.ok(problems.some((p) => p.includes('kind "dropdown"')));
});

test('health check works', async () => {
  const env = freshEnv();
  const r = await call(env, 'GET', '/api/health');
  assert.equal(r.status, 200);
  assert.equal(r.data.ok, true);
});

test('health check explains a missing database setup', async () => {
  const env = { DB: createD1(':memory:'), SYNC_KEY: KEY };
  const r = await call(env, 'GET', '/api/health');
  assert.equal(r.status, 503);
  assert.match(r.data.error, /db:setup/);
});

test('saving entries gives running numbers per form', async () => {
  const env = freshEnv();
  const a = await save(env, 'fee', fee());
  const b = await save(env, 'fee', fee({ student_name: 'Priya' }));
  const c = await save(env, 'enquiry', { date: today, student_name: 'Aman', phone: '9876543210', class: 'Class 10' });
  assert.equal(a.status, 201);
  assert.equal(a.data.entry.code, 'FEE-0001');
  assert.equal(b.data.entry.code, 'FEE-0002');
  assert.equal(c.data.entry.code, 'ENQ-0001');
  assert.equal(a.data.entry.status, 'Active');
  const row = await env.DB.prepare('SELECT * FROM entries WHERE code = ?1').bind('FEE-0001').first();
  assert.equal(row.amount, 1500);
  assert.equal(row.name, 'Rahul Sharma');
  assert.equal(row.entry_date, today);
  assert.deepEqual(JSON.parse(row.data), { date: today, student_name: 'Rahul Sharma', class: 'Class 9', amount: 1500, mode: 'UPI' });
  assert.notEqual(row.cancel_hash, null);
});

test('many entries at once still get unique numbers', async () => {
  const env = freshEnv();
  const results = await Promise.all(Array.from({ length: 25 }, (_, i) => save(env, 'fee', fee({ student_name: `Student ${i}` }))));
  const codes = results.map((r) => r.data.entry.code).sort();
  assert.equal(new Set(codes).size, 25);
  assert.equal(codes[24], 'FEE-0025');
});

test('sending the same entry twice saves it once', async () => {
  const env = freshEnv();
  const first = await save(env, 'fee', fee());
  const again = await call(env, 'POST', '/api/entries', {
    headers: { 'x-successpath': '1' },
    body: { client_id: first.client_id, cancel_token: first.cancel_token, type: 'fee', data: fee() },
  });
  assert.equal(again.status, 200);
  assert.equal(again.data.duplicate, true);
  assert.equal(again.data.entry.code, 'FEE-0001');
  const count = await env.DB.prepare('SELECT COUNT(*) AS n FROM entries').first('n');
  assert.equal(count, 1);
});

test('wrong or missing details are explained field by field', async () => {
  const env = freshEnv();
  const r = await save(env, 'fee', { date: '2099-01-01', student_name: '', class: 'Class 99', amount: 'abc', mode: 'Gold' });
  assert.equal(r.status, 422);
  assert.equal(r.data.fields.student_name, 'Please fill this in.');
  assert.match(r.data.fields.date, /future/);
  assert.equal(r.data.fields.class, 'Please choose one.');
  assert.match(r.data.fields.amount, /rupees/);
  assert.equal(r.data.fields.mode, 'Please choose one.');
  const count = await env.DB.prepare('SELECT COUNT(*) AS n FROM entries').first('n');
  assert.equal(count, 0);
});

test('phone numbers, money and months are tidied', () => {
  const form = getForm('fee');
  const r = validateEntry(form, {
    ...fee({ amount: '₹ 2,000.50', phone: '+91 98765-43210', fee_for: ['Nov 2026', 'Dec 2026', 'Nov 2026'], extra: 'dropped' }),
  }, today);
  assert.equal(r.ok, true);
  assert.equal(r.data.amount, 2000.5);
  assert.equal(r.data.phone, '9876543210');
  assert.equal(r.data.fee_for, 'Nov 2026, Dec 2026');
  assert.equal(r.data.extra, undefined);
  assert.equal(validateEntry(form, fee({ phone: '098765 43210' }), today).data.phone, '9876543210');
  assert.match(validateEntry(form, fee({ phone: '12345' }), today).errors.phone, /10-digit/);
  assert.match(validateEntry(form, fee({ amount: '0' }), today).errors.amount, /at least/);
  assert.equal(validateEntry(form, fee({ date: '2026-02-30' }), today).errors.date, 'Pick a date.');
});

test('requests that do not come from the page are refused', async () => {
  const env = freshEnv();
  const id = ids();
  const noHeader = await call(env, 'POST', '/api/entries', { body: { ...id, type: 'fee', data: fee() } });
  assert.equal(noHeader.status, 400);
  const notJson = await call(env, 'POST', '/api/entries', { headers: { 'x-successpath': '1', 'content-type': 'text/plain' }, raw: 'hello' });
  assert.equal(notJson.status, 400);
  const robot = await save(env, 'fee', fee(), { website: 'http://spam.example' });
  assert.equal(robot.status, 400);
  const unknown = await save(env, 'party', {});
  assert.equal(unknown.status, 400);
  const badId = await call(env, 'POST', '/api/entries', { headers: { 'x-successpath': '1' }, body: { client_id: 'x', cancel_token: id.cancel_token, type: 'fee', data: fee() } });
  assert.equal(badId.status, 400);
  const huge = await save(env, 'fee', fee({ notes: 'x'.repeat(30000) }));
  assert.equal(huge.status, 400);
  const wrongMethod = await call(env, 'GET', '/api/entries');
  assert.equal(wrongMethod.status, 405);
  const count = await env.DB.prepare('SELECT COUNT(*) AS n FROM entries').first('n');
  assert.equal(count, 0);
});

test('only the device that saved an entry can cancel it', async () => {
  const env = freshEnv();
  const saved = await save(env, 'fee', fee());
  const path = '/api/entries/FEE-0001/cancel';
  const headers = { 'x-successpath': '1' };
  const wrong = await call(env, 'POST', path, { headers, body: { token: 'f'.repeat(32), reason: 'Wrong amount' } });
  assert.equal(wrong.status, 403);
  const noReason = await call(env, 'POST', path, { headers, body: { token: saved.cancel_token, reason: ' ' } });
  assert.equal(noReason.status, 422);
  const ok = await call(env, 'POST', path, { headers, body: { token: saved.cancel_token, reason: '  Wrong   amount ' } });
  assert.equal(ok.status, 200);
  assert.equal(ok.data.entry.status, 'Cancelled');
  const twice = await call(env, 'POST', path, { headers, body: { token: saved.cancel_token, reason: 'Wrong amount' } });
  assert.equal(twice.status, 200);
  assert.equal(twice.data.already, true);
  const missing = await call(env, 'POST', '/api/entries/FEE-0099/cancel', { headers, body: { token: saved.cancel_token, reason: 'Wrong amount' } });
  assert.equal(missing.status, 404);
  const row = await env.DB.prepare('SELECT status, cancel_reason FROM entries WHERE code = ?1').bind('FEE-0001').first();
  assert.deepEqual(row, { status: 'Cancelled', cancel_reason: 'Wrong amount' });
});

test('the database refuses deletes and keeps a full history', async () => {
  const env = freshEnv();
  const saved = await save(env, 'fee', fee());
  await call(env, 'POST', '/api/entries/FEE-0001/cancel', { headers: { 'x-successpath': '1' }, body: { token: saved.cancel_token, reason: 'Wrong amount' } });
  const db = env.DB.sqlite;
  assert.throws(() => db.exec('DELETE FROM entries'), /cannot be deleted/);
  assert.throws(() => db.exec("UPDATE entries SET code = 'FEE-9999'"), /cannot be changed/);
  assert.throws(() => db.exec('DELETE FROM entry_history'), /read-only/);
  assert.throws(() => db.exec("UPDATE entry_history SET action = 'x'"), /read-only/);
  db.exec("UPDATE entries SET name = 'Oops' WHERE code = 'FEE-0001'");
  const history = db.prepare('SELECT action, snapshot FROM entry_history ORDER BY id').all();
  assert.deepEqual(history.map((h) => h.action), ['created', 'changed', 'changed']);
  assert.equal(JSON.parse(history[0].snapshot).name, 'Rahul Sharma');
  assert.equal(JSON.parse(history[1].snapshot).status, 'Cancelled');
  assert.equal(JSON.parse(history[2].snapshot).name, 'Oops');
  assert.equal(JSON.parse(history[0].snapshot).data.amount, 1500);
  assert.equal(history[0].snapshot.includes('cancel_hash'), false);
});

test('the sync feed needs the key', async () => {
  const env = freshEnv();
  assert.equal((await call(env, 'GET', '/api/sync')).status, 401);
  assert.equal((await call(env, 'GET', '/api/sync', { headers: { authorization: 'Bearer nope' } })).status, 401);
  assert.equal((await call(env, 'GET', '/api/export', { headers: { authorization: 'Bearer nope' } })).status, 401);
  const noKey = freshEnv({ SYNC_KEY: undefined });
  const r = await call(noKey, 'GET', '/api/sync', { headers: { authorization: `Bearer ${KEY}` } });
  assert.equal(r.status, 503);
  assert.match(r.data.error, /wrangler secret put SYNC_KEY/);
});

test('the sync feed lists every change in order, page by page', async () => {
  const env = freshEnv();
  const auth = { authorization: `Bearer ${KEY}` };
  const a = await save(env, 'fee', fee());
  await save(env, 'enquiry', { date: today, student_name: 'Aman', phone: '9876543210', class: 'Class 10' });
  await save(env, 'fee', fee({ student_name: 'Priya' }));
  await call(env, 'POST', '/api/entries/FEE-0001/cancel', { headers: { 'x-successpath': '1' }, body: { token: a.cancel_token, reason: 'Wrong amount' } });

  const empty = await call(env, 'GET', '/api/sync?after=4', { headers: auth });
  assert.deepEqual(empty.data.changes, []);
  assert.equal(empty.data.next_after, 4);
  assert.equal(empty.data.has_more, false);

  const page1 = await call(env, 'GET', '/api/sync?after=0&limit=2', { headers: auth });
  assert.equal(page1.status, 200);
  assert.equal(page1.data.changes.length, 2);
  assert.equal(page1.data.has_more, true);
  assert.equal(page1.data.next_after, 2);
  assert.ok(Array.isArray(page1.data.schema.tabs));
  const page2 = await call(env, 'GET', `/api/sync?after=${page1.data.next_after}&limit=2`, { headers: auth });
  const all = [...page1.data.changes, ...page2.data.changes].sort((x, y) => x.log_id - y.log_id);
  assert.deepEqual(all.map((c) => c.log_id), [1, 2, 3, 4]);
  assert.deepEqual(all.map((c) => c.entry.code), ['FEE-0001', 'ENQ-0001', 'FEE-0002', 'FEE-0001']);
  // The feed shows the entry as it is now, so the first change already shows Cancelled.
  assert.equal(all[0].entry.status, 'Cancelled');
  assert.equal(all[3].entry.cancel_reason, 'Wrong amount');
  assert.equal(typeof all[0].entry.data, 'object');
  assert.equal(all[0].entry.data.amount, 1500);
});

test('the export gives every entry, page by page, without private tokens', async () => {
  const env = freshEnv();
  const auth = { authorization: `Bearer ${KEY}` };
  for (let i = 0; i < 5; i++) await save(env, 'fee', fee({ student_name: `Student ${i}` }));
  const p1 = await call(env, 'GET', '/api/export?after_id=0&limit=3', { headers: auth });
  assert.equal(p1.status, 200);
  assert.equal(p1.data.total, 5);
  assert.equal(p1.data.max_log_id, 5);
  assert.equal(p1.data.entries.length, 3);
  assert.equal(p1.data.has_more, true);
  const p2 = await call(env, 'GET', `/api/export?after_id=${p1.data.next_after_id}&limit=3`, { headers: auth });
  assert.equal(p2.data.entries.length, 2);
  assert.equal(p2.data.has_more, false);
  const entries = [...p1.data.entries, ...p2.data.entries];
  assert.deepEqual(entries.map((e) => e.seq).sort(), [1, 2, 3, 4, 5]);
  assert.equal(p1.text.includes('cancel_hash'), false);
  assert.equal(entries[0].client_id.startsWith('client-'), true);
  assert.equal(typeof entries[0].data, 'object');
});

test('a full page stays under the 2 MB limit even with very long Hindi text', async () => {
  const env = freshEnv();
  const long = (n) => 'स'.repeat(n); // 3 bytes per letter
  const form = getForm('admission');
  const data = { date: today, phone: '9876543210', class: 'Class 5', fee_plan: 'Monthly', fee_amount: '1500' };
  for (const f of form.fields) {
    if (f.kind === 'textarea') data[f.key] = long(1000);
    if (f.kind === 'text') data[f.key] = long(120);
    if (f.kind === 'name') data[f.key] = long(80);
  }
  for (let i = 0; i < 150; i++) {
    const r = await save(env, 'admission', data);
    assert.equal(r.status, 201, JSON.stringify(r.data));
  }
  const auth = { authorization: `Bearer ${KEY}` };
  const page = await call(env, 'GET', '/api/export?after_id=0&limit=999', { headers: auth });
  assert.equal(page.data.entries.length, 150, 'the server caps a page at 150');
  const bytes = Buffer.byteLength(JSON.stringify(page.data.entries));
  assert.ok(bytes < 2_000_000, `export page is ${bytes} bytes`);
  const feed = await call(env, 'GET', '/api/sync?after=0&limit=999', { headers: auth });
  assert.ok(Buffer.byteLength(JSON.stringify(feed.data.changes)) < 2_000_000);
});

test('unknown addresses answer 404', async () => {
  const env = freshEnv();
  assert.equal((await call(env, 'GET', '/api/nothing')).status, 404);
  assert.equal((await call(env, 'GET', '/somewhere')).status, 404);
});
