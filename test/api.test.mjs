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
  assert.ok(problems.some((p) => p.includes('is already used by another form')));
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
  assert.equal(r.data.fields.student_name, undefined, 'nothing is mandatory');
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
    if (f.kind === 'name' || f.kind === 'student') data[f.key] = long(80);
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

/* ---------------- Version 2: student and teacher registers ---------------- */

async function people(env, kind = 'student') {
  const r = await call(env, 'GET', `/api/people?kind=${kind}`, { headers: { 'x-successpath': '1' } });
  assert.equal(r.status, 200, r.text);
  return r.data.people.sort((a, b) => a.code.localeCompare(b.code));
}

async function cancel(env, saved, code, reason = 'Wrong entry') {
  const r = await call(env, 'POST', `/api/entries/${code}/cancel`, { headers: { 'x-successpath': '1' }, body: { token: saved.cancel_token, reason } });
  assert.equal(r.status, 200, r.text);
}

test('a fee for a new student adds them to the register once', async () => {
  const env = freshEnv();
  const a = await save(env, 'fee', fee({ phone: '9876543210' }));
  assert.equal(a.status, 201);
  assert.deepEqual(a.data.person, { code: 'STU-0001', name: 'Rahul Sharma', kind: 'student', added: true });
  const b = await save(env, 'fee', fee({ student_name: '  rahul   SHARMA ' }));
  assert.equal(b.data.person.code, 'STU-0001');
  assert.equal(b.data.person.added, false);
  const list = await people(env);
  assert.equal(list.length, 1);
  assert.equal(list[0].total_paid, 3000);
  assert.equal(list[0].phone, '9876543210');
  const linked = env.DB.sqlite.prepare("SELECT COUNT(*) AS n FROM entries WHERE person_id = 1").get().n;
  assert.equal(linked, 2);
});

test('same name in another class is a different student, unless the phone matches', async () => {
  const env = freshEnv();
  await save(env, 'fee', fee({ phone: '9876543210' }));
  const other = await save(env, 'fee', fee({ class: 'Class 5' }));
  assert.equal(other.data.person.code, 'STU-0002');
  assert.equal(other.data.person.added, true);
  const promoted = await save(env, 'fee', fee({ class: 'Class 10', phone: '9876543210' }));
  assert.equal(promoted.data.person.code, 'STU-0001');
  const list = await people(env);
  assert.deepEqual(list.map((p) => `${p.code}:${p.class}`), ['STU-0001:Class 10', 'STU-0002:Class 5']);
});

test('a student picked from the list is used even if the class changed', async () => {
  const env = freshEnv();
  await save(env, 'fee', fee());
  const picked = await save(env, 'fee', fee({ class: 'Class 10' }), { person_code: 'STU-0001' });
  assert.equal(picked.data.person.code, 'STU-0001');
  const list = await people(env);
  assert.equal(list.length, 1);
  assert.equal(list[0].class, 'Class 10');
});

test('an admission fills the register, and leaving and cancelling update the status', async () => {
  const env = freshEnv();
  await save(env, 'fee', fee());
  const adm = await save(env, 'admission', { date: today, student_name: 'Rahul Sharma', class: 'Class 9', parent_name: 'Mohan Sharma', fee_amount: '1500', fee_plan: 'Monthly', school: 'Doon School' });
  assert.equal(adm.data.person.code, 'STU-0001');
  let detail = await call(env, 'GET', '/api/people/STU-0001', { headers: { 'x-successpath': '1' } });
  assert.equal(detail.data.person.details.parent_name, 'Mohan Sharma');
  assert.equal(detail.data.person.details.fee_amount, 1500);
  assert.equal(detail.data.person.joined_on, today);
  assert.equal(detail.data.entries.length, 2);
  const left = await save(env, 'student_left', { date: today, student_name: 'Rahul Sharma', class: 'Class 9', reason: 'Moved to another city' });
  detail = await call(env, 'GET', '/api/people/STU-0001', { headers: { 'x-successpath': '1' } });
  assert.equal(detail.data.person.status, 'Left');
  assert.equal(detail.data.person.left_on, today);
  await cancel(env, left, left.data.entry.code);
  detail = await call(env, 'GET', '/api/people/STU-0001', { headers: { 'x-successpath': '1' } });
  assert.equal(detail.data.person.status, 'Active');
  assert.equal(detail.data.person.left_on, null);
});

test('cancelling the entry that added a mistyped name hides that name', async () => {
  const env = freshEnv();
  const typo = await save(env, 'fee', fee({ student_name: 'Rahul Shrama' }));
  await cancel(env, typo, typo.data.entry.code, 'Name spelt wrong');
  assert.equal((await people(env)).length, 0);
  const notFound = await call(env, 'GET', '/api/people/STU-0001', { headers: { 'x-successpath': '1' } });
  assert.equal(notFound.status, 404);
  const fixed = await save(env, 'fee', fee({ student_name: 'Rahul Sharma' }));
  assert.equal(fixed.data.person.code, 'STU-0002');
  assert.equal(fixed.data.person.added, true);
  assert.deepEqual((await people(env)).map((p) => p.name), ['Rahul Sharma']);
});

test('entering a cancelled entry again brings its student back instead of adding a copy', async () => {
  const env = freshEnv();
  const wrong = await save(env, 'fee', fee({ amount: '1400' }));
  await cancel(env, wrong, wrong.data.entry.code, 'Wrong amount');
  assert.equal((await people(env)).length, 0);
  const again = await save(env, 'fee', fee(), { person_code: 'STU-0001' });
  assert.equal(again.data.person.code, 'STU-0001');
  const typedAgain = await save(env, 'fee', fee());
  assert.equal(typedAgain.data.person.code, 'STU-0001');
  const list = await people(env);
  assert.equal(list.length, 1);
  assert.equal(list[0].status, 'Active');
  assert.equal(list[0].total_paid, 3000);
});

test('marks for a new name add the student, and marks above the total are refused', async () => {
  const env = freshEnv();
  const newcomer = await save(env, 'marks', { date: today, student_name: 'Nobody Yet', class: 'Class 8', test: 'Unit test 1', marks: '40', out_of: '50' });
  assert.equal(newcomer.status, 201);
  assert.deepEqual(newcomer.data.person, { code: 'STU-0001', name: 'Nobody Yet', kind: 'student', added: true });
  const env2 = freshEnv();
  await save(env2, 'fee', fee());
  const typedOnly = await save(env2, 'marks', { student_name: 'Rahul Sharma', test: 'Unit test 0', marks: '20', out_of: '50' });
  assert.equal(typedOnly.data.person.code, 'STU-0001', 'a typed name with no class finds the only Rahul Sharma');
});

test('marks link to the right student', async () => {
  const env = freshEnv();
  await save(env, 'fee', fee());
  const typed = await save(env, 'marks', { date: today, student_name: 'Rahul Sharma', test: 'Unit test 1', marks: '40', out_of: '50' });
  assert.equal(typed.status, 201);
  assert.equal(typed.data.person.code, 'STU-0001');
  const tooMany = await save(env, 'marks', { date: today, student_name: 'Rahul Sharma', test: 'Unit test 2', marks: '60', out_of: '50' }, { person_code: 'STU-0001' });
  assert.equal(tooMany.status, 422);
  assert.match(tooMany.data.fields.marks, /cannot be more than/);
  const list = await people(env);
  assert.equal(list[0].last_percent, 80);
});

test('teacher payments add the teacher once and keep their payment history', async () => {
  const env = freshEnv();
  const pay = { date: today, teacher_name: 'Anita Negi', amount: '12000', mode: 'Bank transfer', payment_for: 'Salary', paid_for: ['Nov 2026'] };
  const a = await save(env, 'teacher_payment', pay);
  assert.deepEqual(a.data.person, { code: 'TR-0001', name: 'Anita Negi', kind: 'teacher', added: true });
  const b = await save(env, 'teacher_payment', { ...pay, amount: '2000', payment_for: 'Bonus' });
  assert.equal(b.data.person.code, 'TR-0001');
  const joined = await save(env, 'teacher', { date: today, teacher_name: 'anita negi', phone: '9411122233', subjects: 'Physics', salary: '12000' });
  assert.equal(joined.data.person.code, 'TR-0001');
  const note = await save(env, 'note', { date: today, person_name: 'Anita Negi', note: 'Asked for a raise' }, { person_code: 'TR-0001' });
  assert.equal(note.status, 201);
  const teachers = await people(env, 'teacher');
  assert.equal(teachers.length, 1);
  assert.equal(teachers[0].total_paid, 14000);
  assert.equal(teachers[0].phone, '9411122233');
  const detail = await call(env, 'GET', '/api/people/TR-0001', { headers: { 'x-successpath': '1' } });
  assert.equal(detail.data.person.details.subjects, 'Physics');
  assert.deepEqual(detail.data.entries.map((e) => e.type).sort(), ['note', 'teacher', 'teacher_payment', 'teacher_payment']);
});

test('sending the same entry twice adds the student once', async () => {
  const env = freshEnv();
  const first = await save(env, 'fee', fee({ student_name: 'Aman Negi' }));
  const again = await call(env, 'POST', '/api/entries', {
    headers: { 'x-successpath': '1' },
    body: { client_id: first.client_id, cancel_token: first.cancel_token, type: 'fee', data: fee({ student_name: 'Aman Negi' }) },
  });
  assert.equal(again.data.duplicate, true);
  assert.equal(again.data.person.code, 'STU-0001');
  assert.equal((await people(env)).length, 1);
  assert.equal(env.DB.sqlite.prepare('SELECT COUNT(*) AS n FROM entries').get().n, 1);
});

test('students cannot be deleted and every change is in their history', async () => {
  const env = freshEnv();
  await save(env, 'fee', fee());
  await save(env, 'admission', { date: today, student_name: 'Rahul Sharma', class: 'Class 9', parent_name: 'Mohan Sharma' });
  const db = env.DB.sqlite;
  assert.throws(() => db.exec('DELETE FROM people'), /cannot be deleted/);
  assert.throws(() => db.exec("UPDATE people SET code = 'STU-9999'"), /cannot be changed/);
  assert.throws(() => db.exec('DELETE FROM people_history'), /read-only/);
  const actions = db.prepare('SELECT action FROM people_history ORDER BY id').all().map((r) => r.action);
  assert.deepEqual(actions, ['created', 'changed', 'changed']);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM students").get().n, 1);
});

test('the analytics page gets fees, dues, classes and marks to watch', async () => {
  const env = freshEnv();
  const month = today.slice(0, 7);
  const label = `${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][Number(month.slice(5)) - 1]} ${month.slice(0, 4)}`;
  await save(env, 'fee', fee({ fee_for: [label] }));
  await save(env, 'admission', { date: today, student_name: 'Priya Rawat', class: 'Class 10', phone: '9837011223', fee_plan: 'Monthly' });
  await save(env, 'enquiry', { date: today, student_name: 'Priya Rawat', class: 'Class 10', phone: '9837011223', source: 'Walk-in' });
  await save(env, 'enquiry', { date: today, student_name: 'Someone Else', class: 'Class 8', source: 'Social media' });
  await save(env, 'teacher_payment', { date: today, teacher_name: 'Anita Negi', amount: '5000', mode: 'Cash', payment_for: 'Salary' });
  await save(env, 'marks', { date: '2026-01-10', student_name: 'Rahul Sharma', test: 'Test 1', marks: '45', out_of: '50' }, { person_code: 'STU-0001' });
  await save(env, 'marks', { date: '2026-02-10', student_name: 'Rahul Sharma', test: 'Test 2', marks: '30', out_of: '50' }, { person_code: 'STU-0001' });
  const r = await call(env, 'GET', '/api/analytics', { headers: { 'x-successpath': '1' } });
  assert.equal(r.status, 200, r.text);
  const a = r.data;
  assert.equal(a.fees.length, 6);
  assert.equal(a.fees[5].amount, 1500);
  assert.equal(a.teacher_payments[5].amount, 5000);
  assert.equal(a.students.active, 2);
  assert.deepEqual(a.not_paid.map((s) => s.name), ['Priya Rawat']);
  assert.deepEqual(a.conversion, { enquiries: 2, joined: 1 });
  assert.equal(a.this_month.enquiries, 2);
  assert.equal(a.marks_attention.length, 1);
  assert.equal(a.marks_attention[0].pct, 60);
  assert.equal(a.marks_attention[0].prev_pct, 90);
  assert.ok(a.by_class.some((c) => c.label === 'Class 10' && c.n === 1));
  assert.equal((await call(env, 'GET', '/api/analytics')).status, 400, 'needs the page header');
});

test('the sheet gets person IDs and the registers', async () => {
  const env = freshEnv();
  const auth = { authorization: `Bearer ${KEY}` };
  await save(env, 'fee', fee());
  await save(env, 'teacher_payment', { date: today, teacher_name: 'Anita Negi', amount: '5000', mode: 'Cash', payment_for: 'Salary' });
  const feed = await call(env, 'GET', '/api/sync?after=0', { headers: auth });
  assert.deepEqual(feed.data.changes.map((c) => c.entry.person_code), ['STU-0001', 'TR-0001']);
  assert.ok(feed.data.people_version > 0);
  assert.equal(feed.data.schema.registers.length, 2);
  const feesTab = feed.data.schema.tabs.find((t) => t.type === 'fee');
  assert.equal(feesTab.columns[2].label, 'Student ID');
  assert.equal((await call(env, 'GET', '/api/registers')).status, 401);
  const reg = await call(env, 'GET', '/api/registers?after_id=0', { headers: auth });
  assert.deepEqual(reg.data.people.map((p) => `${p.code}:${p.total_paid}`), ['STU-0001:1500', 'TR-0001:5000']);
  const exp = await call(env, 'GET', '/api/export?after_id=0', { headers: auth });
  assert.equal(exp.data.entries[0].person_code, 'STU-0001');
});

test('the migration builds the registers from entries saved before version 2', async () => {
  const { DatabaseSync } = await import('node:sqlite');
  const { readFileSync } = await import('node:fs');
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(join(ROOT, 'migrations/0001_init.sql'), 'utf8'));
  const add = (type, code, name, data, phone = null) => db.prepare(
    'INSERT INTO entries (type, seq, code, entry_date, name, phone, data, client_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(type, Number(code.slice(-4)), code, today, name, phone, JSON.stringify(data), `old-${code}`);
  add('fee', 'FEE-0001', 'Rahul Sharma', { class: 'Class 9', amount: 1500 }, '9876543210');
  add('fee', 'FEE-0002', 'rahul sharma', { class: 'Class 9', amount: 1500 });
  add('admission', 'ADM-0001', 'Rahul Sharma', { class: 'Class 9', parent_name: 'Mohan Sharma', fee_plan: 'Monthly' });
  add('fee', 'FEE-0003', 'Priya Rawat', { class: 'Class 10', amount: 2000 });
  add('student_left', 'STL-0001', 'Priya Rawat', { class: 'Class 10', reason: 'Other' });
  add('teacher', 'TCH-0001', 'Anita Negi', { subjects: 'Physics', salary: 12000 }, '9411122233');
  db.exec(readFileSync(join(ROOT, 'migrations/0002_people.sql'), 'utf8'));
  const ppl = db.prepare('SELECT code, name, class, phone, status, details, joined_on, created_from FROM people ORDER BY id').all().map((r) => ({ ...r }));
  assert.equal(ppl.length, 3);
  assert.deepEqual(ppl.map((p) => `${p.code}:${p.name}:${p.status}`), ['STU-0001:Rahul Sharma:Active', 'STU-0002:Priya Rawat:Left', 'TR-0001:Anita Negi:Active']);
  assert.equal(ppl[0].phone, '9876543210');
  assert.equal(JSON.parse(ppl[0].details).parent_name, 'Mohan Sharma');
  assert.equal(ppl[0].joined_on, today);
  assert.equal(ppl[0].created_from, 'FEE-0001');
  assert.equal(JSON.parse(ppl[2].details).subjects, 'Physics');
  const unlinked = db.prepare('SELECT COUNT(*) AS n FROM entries WHERE person_id IS NULL').get().n;
  assert.equal(unlinked, 0);
});

test('no field is mandatory, but a completely empty form is refused', async () => {
  const env = freshEnv();
  const empty = await save(env, 'fee', { date: today });
  assert.equal(empty.status, 422);
  assert.match(empty.data.error, /at least one thing/);
  const marksDefaults = await save(env, 'marks', { date: today, out_of: '100' });
  assert.equal(marksDefaults.status, 422, 'the pre-filled date and "out of" do not count');
  const onlyAmount = await save(env, 'fee', { amount: '500' });
  assert.equal(onlyAmount.status, 201);
  assert.equal(onlyAmount.data.person, null, 'no name, so no student record');
  const onlyName = await save(env, 'admission', { student_name: 'Meera Joshi' });
  assert.equal(onlyName.status, 201);
  assert.equal(onlyName.data.person.code, 'STU-0001');
  const note = await save(env, 'note', { note: 'General note, not about anyone' });
  assert.equal(note.status, 201);
  for (const form of FORMS) for (const f of form.fields) assert.ok(!f.required, `${form.type}.${f.key} should be optional`);
});

test('a cancellation does not need a reason', async () => {
  const env = freshEnv();
  const saved = await save(env, 'fee', fee());
  const r = await call(env, 'POST', '/api/entries/FEE-0001/cancel', { headers: { 'x-successpath': '1' }, body: { token: saved.cancel_token } });
  assert.equal(r.status, 200);
  const row = await env.DB.prepare('SELECT status, cancel_reason FROM entries WHERE code = ?1').bind('FEE-0001').first();
  assert.deepEqual(row, { status: 'Cancelled', cancel_reason: null });
});

test('other payments are saved and counted in analytics', async () => {
  const env = freshEnv();
  const rent = await save(env, 'expense', { date: today, what_for: 'Rent', paid_to: 'Landlord', amount: '15000', mode: 'Bank transfer' });
  assert.equal(rent.status, 201);
  assert.equal(rent.data.entry.code, 'EXP-0001');
  assert.equal(rent.data.person, null);
  await save(env, 'expense', { date: today, what_for: 'Electricity', amount: '2300', mode: 'UPI' });
  await save(env, 'expense', { date: today, what_for: 'Stationery' });
  const r = await call(env, 'GET', '/api/analytics', { headers: { 'x-successpath': '1' } });
  assert.equal(r.data.other_payments[5].amount, 17300);
  assert.deepEqual(r.data.other_types.map((t) => `${t.label}:${t.amount}`), ['Rent:15000', 'Electricity:2300']);
  const tab = sheetSchema().tabs.find((t) => t.type === 'expense');
  assert.equal(tab.tab, 'Other Payments');
});

const inDays = (n) => {
  const [y, m, d] = today.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};
const VIEW = { 'x-successpath': '1' };
let taskCounter = 0;
function addTask(env, body) {
  taskCounter += 1;
  return call(env, 'POST', '/api/tasks', { headers: VIEW, body: { client_id: `task-${String(taskCounter).padStart(6, '0')}-xyz`, ...body } });
}
const moveTask = (env, code, body) => call(env, 'POST', `/api/tasks/${code}`, { headers: VIEW, body });
const board = (env) => call(env, 'GET', '/api/tasks', { headers: VIEW });

test('tasks: added at the top of To do, only a title is needed, and repeats are saved once', async () => {
  const env = freshEnv();
  const noHeader = await call(env, 'POST', '/api/tasks', { body: { client_id: 'task-000000-nohdr', title: 'X' } });
  assert.equal(noHeader.status, 400);
  const empty = await addTask(env, { title: '   ' });
  assert.equal(empty.status, 422);
  assert.equal(empty.data.fields.title, 'Write what needs doing.');
  const badDate = await addTask(env, { title: 'Book hall', due_on: '2026-02-31' });
  assert.equal(badDate.status, 422);
  assert.ok(badDate.data.fields.due_on);

  const first = await addTask(env, { title: 'Hire a maths teacher', due_on: inDays(7), owner: 'Papa', notes: 'Class 9 and 10\nMornings' });
  assert.equal(first.status, 201);
  assert.equal(first.data.task.code, 'TSK-0001');
  assert.equal(first.data.task.stage, 'To do');
  assert.equal(first.data.task.notes, 'Class 9 and 10\nMornings');
  const again = await call(env, 'POST', '/api/tasks', { headers: VIEW, body: { client_id: `task-${String(taskCounter).padStart(6, '0')}-xyz`, title: 'Hire a maths teacher' } });
  assert.equal(again.status, 200);
  assert.equal(again.data.duplicate, true);
  assert.equal(again.data.task.code, 'TSK-0001');

  const second = await addTask(env, { title: 'Market the crash course' });
  assert.equal(second.data.task.code, 'TSK-0002');
  assert.equal((await board(env)).status, 200);
  assert.equal((await call(env, 'GET', '/api/tasks')).status, 400, 'the board is only for the page');
  const b = (await board(env)).data;
  assert.deepEqual(b.open.map((t) => t.code), ['TSK-0002', 'TSK-0001'], 'newest on top');
  assert.deepEqual(b.owners, ['Papa']);
  assert.equal(b.done_total, 0);
});

test('tasks: moving between columns, editing, and removing from the board', async () => {
  const env = freshEnv();
  await addTask(env, { title: 'Print new leaflets' });
  await addTask(env, { title: 'Call parents about the exam week' });
  const doing = await moveTask(env, 'TSK-0001', { stage: 'Doing' });
  assert.equal(doing.status, 200);
  assert.equal(doing.data.task.stage, 'Doing');
  assert.equal(doing.data.task.done_at, null);
  const done = await moveTask(env, 'TSK-0001', { stage: 'Done' });
  assert.ok(done.data.task.done_at, 'done time is kept');
  const reopened = await moveTask(env, 'TSK-0001', { stage: 'To do' });
  assert.equal(reopened.data.task.done_at, null);
  let b = (await board(env)).data;
  assert.deepEqual(b.open.filter((t) => t.stage === 'To do').map((t) => t.code), ['TSK-0001', 'TSK-0002'], 'a moved card goes to the top');

  const placed = await moveTask(env, 'TSK-0001', { position: 5 });
  assert.equal(placed.data.task.position, 5);
  b = (await board(env)).data;
  assert.deepEqual(b.open.map((t) => t.code), ['TSK-0002', 'TSK-0001']);

  const edited = await moveTask(env, 'TSK-0002', { title: 'Call parents', notes: '', owner: 'Ayush', due_on: inDays(2) });
  assert.equal(edited.data.task.title, 'Call parents');
  assert.equal(edited.data.task.notes, null);
  assert.equal(edited.data.task.owner, 'Ayush');
  assert.equal((await moveTask(env, 'TSK-0002', { title: '' })).status, 422);
  assert.equal((await moveTask(env, 'TSK-0002', { stage: 'Later' })).status, 422);
  assert.equal((await moveTask(env, 'TSK-0002', {})).status, 400);
  assert.equal((await moveTask(env, 'TSK-0099', { stage: 'Done' })).status, 404);
  assert.equal((await call(env, 'GET', '/api/tasks/TSK-0002')).status, 405);

  await moveTask(env, 'TSK-0002', { stage: 'Done' });
  const removed = await moveTask(env, 'TSK-0002', { stage: 'Removed' });
  assert.equal(removed.data.task.stage, 'Removed');
  assert.ok(removed.data.task.done_at, 'removing keeps the done time');
  b = (await board(env)).data;
  assert.deepEqual([...b.open, ...b.done].map((t) => t.code), ['TSK-0001']);
  const undo = await moveTask(env, 'TSK-0002', { stage: 'Done', position: removed.data.task.position });
  assert.equal(undo.data.task.stage, 'Done');

  await assert.rejects(env.DB.prepare('DELETE FROM tasks').run(), /cannot be deleted/);
  await assert.rejects(env.DB.prepare("UPDATE tasks SET code = 'TSK-0100' WHERE code = 'TSK-0001'").run(), /cannot be changed/);
  const history = await env.DB.prepare('SELECT COUNT(*) AS n FROM task_history').first();
  assert.ok(history.n >= 10);
});

test('tasks: the sheet gets every task, including removed ones, and a version to notice changes', async () => {
  const env = freshEnv();
  const sync0 = await call(env, 'GET', '/api/sync', { headers: { authorization: `Bearer ${KEY}` } });
  assert.equal(sync0.data.tasks_version, 0);
  await addTask(env, { title: 'Hire a teacher' });
  await addTask(env, { title: 'Wrong task' });
  await moveTask(env, 'TSK-0002', { stage: 'Removed' });
  const sync1 = await call(env, 'GET', '/api/sync', { headers: { authorization: `Bearer ${KEY}` } });
  assert.equal(sync1.data.tasks_version, 3);
  assert.equal((await call(env, 'GET', '/api/tasks-export')).status, 401);
  const page = await call(env, 'GET', '/api/tasks-export?limit=1', { headers: { authorization: `Bearer ${KEY}` } });
  assert.equal(page.data.tasks.length, 1);
  assert.equal(page.data.has_more, true);
  const rest = await call(env, 'GET', `/api/tasks-export?after_id=${page.data.next_after_id}`, { headers: { authorization: `Bearer ${KEY}` } });
  assert.deepEqual(rest.data.tasks.map((t) => `${t.code}:${t.stage}`), ['TSK-0002:Removed']);
  const exp = await call(env, 'GET', '/api/export', { headers: { authorization: `Bearer ${KEY}` } });
  assert.equal(exp.data.tasks_version, 3);
  assert.equal(sheetSchema().tasks.tab, 'Tasks');
});

test('exam dates: for one student or a whole class, on the student page and on the board', async () => {
  const env = freshEnv();
  const adm = await save(env, 'admission', { date: today, student_name: 'Riya Verma', class: 'Class 10', school: 'Doon Public School' });
  assert.equal(adm.data.person.code, 'STU-0001');
  const wrongOrder = await save(env, 'exam', { class: 'Class 10', exam: 'Half-yearly', starts_on: inDays(10), ends_on: inDays(5) });
  assert.equal(wrongOrder.status, 422);
  assert.match(wrongOrder.data.fields.ends_on, /before "Starts on"/);

  const classWide = await save(env, 'exam', { class: 'Class 10', school: 'doon public school', exam: 'Half-yearly', starts_on: inDays(10), ends_on: inDays(20), subjects: 'Maths 2 Dec\nScience 4 Dec' });
  assert.equal(classWide.status, 201);
  assert.equal(classWide.data.person, null, 'no student, so it is for the class');
  await save(env, 'exam', { class: 'Class 10', school: 'Another School', exam: 'Half-yearly', starts_on: inDays(12) });
  await save(env, 'exam', { class: 'Class 9', exam: 'Half-yearly', starts_on: inDays(11) });
  const own = await save(env, 'exam', { student_name: 'Riya Verma', class: 'Class 10', exam: 'Unit test', starts_on: inDays(3) }, { person_code: 'STU-0001' });
  assert.equal(own.data.person.code, 'STU-0001');
  await save(env, 'exam', { class: 'Class 10', exam: 'Annual', starts_on: inDays(60) });
  await save(env, 'exam', { class: 'Class 10', exam: 'Unit test', starts_on: inDays(-10), ends_on: inDays(-8) });
  await save(env, 'exam', { class: 'Class 10', exam: 'Pre-board', starts_on: inDays(-2), ends_on: inDays(2) });

  const page = await call(env, 'GET', '/api/people/STU-0001', { headers: VIEW });
  assert.deepEqual(page.data.entries.filter((e) => e.type === 'exam').map((e) => e.data.exam), ['Unit test']);
  const classExams = page.data.class_exams.map((e) => `${e.data.exam}:${e.data.school || '-'}`).sort();
  assert.deepEqual(classExams, ['Annual:-', 'Half-yearly:doon public school', 'Pre-board:-', 'Unit test:-'],
    'same class, same school or no school; not another school or another class');

  const b = (await board(env)).data;
  assert.equal(b.exam_days, 45);
  assert.deepEqual(b.exams.map((x) => `${x.exam}|${x.class}|${x.student_name || ''}`), [
    'Pre-board|Class 10|', 'Unit test|Class 10|Riya Verma', 'Half-yearly|Class 10|', 'Half-yearly|Class 9|', 'Half-yearly|Class 10|',
  ], 'only exams not over yet and starting within 45 days, soonest first');
  assert.equal(b.exams[1].person_code, 'STU-0001');

  const marks = await save(env, 'marks', { date: today, student_name: 'Riya Verma', class: 'Class 10', exam: 'Half-yearly', subject: 'Maths', marks: '71', out_of: '80' }, { person_code: 'STU-0001' });
  assert.equal(marks.status, 201);
  const teacherPage = await save(env, 'teacher', { date: today, teacher_name: 'Mr Rawat' });
  const t = await call(env, 'GET', `/api/people/${teacherPage.data.person.code}`, { headers: VIEW });
  assert.deepEqual(t.data.class_exams, []);
});
