// Tests for the server and the database rules. Run with: npm test
// They use a temporary in-memory database, so nothing real is touched.

import test from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import worker from '../src/worker.js';
import { createD1 } from './d1-mock.mjs';
import { FORMS, checkForms, sheetSchema, validateEntry, getForm, classesFromText } from '../public/forms.js';

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
    // one admission per student, so every one of them has their own name
    const r = await save(env, 'admission', { ...data, student_name: long(76) + String(i).padStart(4, '0') });
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

test('one record per full name: the same name in another class is still the same student', async () => {
  const env = freshEnv();
  await save(env, 'fee', fee({ phone: '9876543210' }));
  const other = await save(env, 'fee', fee({ class: 'Class 5', student_name: '  rahul   SHARMA ' }));
  assert.equal(other.data.person.code, 'STU-0001');
  assert.equal(other.data.person.added, false);
  const promoted = await save(env, 'fee', fee({ class: 'Class 10' }));
  assert.equal(promoted.data.person.code, 'STU-0001');
  const list = await people(env);
  assert.deepEqual(list.map((p) => `${p.code}:${p.class}`), ['STU-0001:Class 10']);
  // marks typed with the name find the one record too
  const marks = await save(env, 'marks', { student_name: 'Rahul Sharma', class: 'Class 3', subject: 'Maths', marks: '40', out_of: '50' });
  assert.equal(marks.data.person.code, 'STU-0001');
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
  // this session from April, and at least 6 months
  const m = Number(today.slice(5, 7));
  assert.equal(a.fees.length, Math.max(6, m >= 4 ? m - 3 : m + 9));
  assert.equal(a.fees[0].month <= `${Number(today.slice(0, 4)) - (m < 4 ? 1 : 0)}-04`, true);
  assert.equal(a.fees.at(-1).month, today.slice(0, 7));
  assert.equal(a.fees.at(-1).amount, 1500);
  assert.equal(a.teacher_payments.at(-1).amount, 5000);
  assert.equal(a.students.active, 2);
  assert.deepEqual(a.not_paid.map((s) => s.name), ['Priya Rawat']);
  assert.deepEqual(a.conversion, { enquiries: 2, joined: 1, demo: 0 });
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
  assert.equal(r.data.other_payments.at(-1).amount, 17300);
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

test('leave calendar: who is on leave each day, holidays, and which teachers are on staff', async () => {
  const env = freshEnv();
  const anita = await save(env, 'teacher', { date: '2026-01-05', teacher_name: 'Anita Negi', subjects: 'Physics' });
  const rohit = await save(env, 'teacher', { teacher_name: 'Rohit Rawat' });
  await save(env, 'teacher', { date: '2026-12-15', teacher_name: 'Meena Bisht' });
  await save(env, 'teacher', { date: '2025-06-01', teacher_name: 'Old Teacher' });
  await save(env, 'teacher_left', { date: '2026-12-10', teacher_name: 'Old Teacher' });
  const A = anita.data.person.code;
  const R = rohit.data.person.code;

  const wrongOrder = await save(env, 'leave', { teacher_name: 'Anita Negi', from: '2026-12-07', to: '2026-12-05' }, { person_code: A });
  assert.equal(wrongOrder.status, 422);
  assert.match(wrongOrder.data.fields.to, /before "From"/);

  const sick = await save(env, 'leave', { teacher_name: 'Anita Negi', from: '2026-12-05', to: '2026-12-07', reason: 'Sick' }, { person_code: A });
  assert.equal(sick.status, 201);
  assert.equal(sick.data.entry.code, 'LVE-0001');
  assert.equal(sick.data.person.code, A, 'saved on her record');
  await save(env, 'leave', { teacher_name: 'Rohit Rawat', from: '2026-12-07', reason: 'Family function', notes: 'Back on Tuesday' }, { person_code: R });
  await save(env, 'leave', { teacher_name: 'anita negi', from: '2026-11-28', to: '2026-12-02', reason: 'Travel' });
  await save(env, 'leave', { teacher_name: 'Anita Negi', from: '2027-01-11' }, { person_code: A });
  const cancelled = await save(env, 'leave', { teacher_name: 'Rohit Rawat', from: '2026-12-20' }, { person_code: R });
  await call(env, 'POST', `/api/entries/${cancelled.data.entry.code}/cancel`, { headers: VIEW, body: { token: cancelled.cancel_token } });
  const newName = await save(env, 'leave', { teacher_name: 'Sunil Thapa', from: '2026-12-21' });
  assert.equal(newName.data.person.added, true, 'a new name is added to Teachers');

  const xmas = await save(env, 'holiday', { holiday: 'Christmas', from: '2026-12-25' });
  assert.equal(xmas.data.entry.code, 'HOL-0001');
  assert.equal(xmas.data.person, null);
  await save(env, 'holiday', { holiday: 'Winter break', from: '2026-12-30', to: '2027-01-02' });
  await save(env, 'holiday', { holiday: 'Diwali', from: '2026-11-08', to: '2026-11-10' });

  assert.equal((await call(env, 'GET', '/api/calendar?month=2026-12')).status, 400, 'only for the page');
  const cal = (await call(env, 'GET', '/api/calendar?month=2026-12', { headers: VIEW })).data;
  assert.equal(cal.month, '2026-12');
  assert.deepEqual(cal.teachers.map((t) => `${t.name}:${t.status}:${t.joined_on}:${t.left_on}`), [
    'Anita Negi:Active:2026-01-05:null', 'Meena Bisht:Active:2026-12-15:null', 'Old Teacher:Left:2025-06-01:2026-12-10',
    'Rohit Rawat:Active:null:null', 'Sunil Thapa:Active:null:null',
  ]);
  assert.deepEqual(cal.leaves.map((l) => `${l.code}|${l.name}|${l.from}|${l.to}|${l.reason}|${l.person_code}`), [
    `LVE-0003|Anita Negi|2026-11-28|2026-12-02|Travel|${A}`,
    `LVE-0001|Anita Negi|2026-12-05|2026-12-07|Sick|${A}`,
    `LVE-0002|Rohit Rawat|2026-12-07|2026-12-07|Family function|${R}`,
    'LVE-0006|Sunil Thapa|2026-12-21|2026-12-21|null|TR-0005',
  ], 'leave touching December, a typed name matched to her record, not the cancelled one');
  assert.equal(cal.leaves[2].notes, 'Back on Tuesday');
  assert.deepEqual(cal.holidays.map((h) => `${h.name}|${h.from}|${h.to}`), ['Christmas|2026-12-25|2026-12-25', 'Winter break|2026-12-30|2027-01-02']);

  const jan = (await call(env, 'GET', '/api/calendar?month=2027-01', { headers: VIEW })).data;
  assert.deepEqual(jan.leaves.map((l) => l.from), ['2027-01-11']);
  assert.deepEqual(jan.holidays.map((h) => h.name), ['Winter break']);
  const bad = (await call(env, 'GET', '/api/calendar?month=2026-13', { headers: VIEW })).data;
  assert.equal(bad.month, today.slice(0, 7), 'a wrong month shows this month');

  const page = (await call(env, 'GET', `/api/people/${A}`, { headers: VIEW })).data;
  assert.equal(page.entries.filter((e) => e.type === 'leave').length, 3, 'her page lists her leave');
});

test('the teacher list marks who is on leave today', async () => {
  const env = freshEnv();
  const a = await save(env, 'teacher', { teacher_name: 'Anita Negi' });
  const r = await save(env, 'teacher', { teacher_name: 'Rohit Rawat' });
  await save(env, 'leave', { teacher_name: 'Rohit Rawat', from: inDays(-1), to: inDays(1) }, { person_code: r.data.person.code });
  await save(env, 'leave', { teacher_name: 'Anita Negi', from: inDays(2) }, { person_code: a.data.person.code });
  const list = (await call(env, 'GET', '/api/people?kind=teacher', { headers: VIEW })).data.people;
  assert.deepEqual(list.map((p) => `${p.name}:${p.on_leave_today}`).sort(), ['Anita Negi:0', 'Rohit Rawat:1']);
});

test('edit details: change a student, clear a detail, and keep the history', async () => {
  const env = freshEnv();
  const adm = await save(env, 'admission', { student_name: 'Shina Panwar', enrollment_no: '003', class: 'Class 8', phone: '9876543210', school: 'Doon School', fee_plan: 'Monthly' });
  const code = adm.data.person.code;
  const page = async () => (await call(env, 'GET', `/api/people/${code}`, { headers: VIEW })).data.person;
  const before = await page();
  assert.ok(before.updated_at);

  const path = `/api/people/${code}`;
  assert.equal((await call(env, 'POST', path, { body: { changes: { name: 'X' } } })).status, 400, 'only from the page');
  const blank = await call(env, 'POST', path, { headers: VIEW, body: { changes: { name: '  ' } } });
  assert.equal(blank.status, 422);
  assert.ok(blank.data.fields.name);
  const badPhone = await call(env, 'POST', path, { headers: VIEW, body: { changes: { phone: '12345' } } });
  assert.equal(badPhone.status, 422);
  const badClass = await call(env, 'POST', path, { headers: VIEW, body: { changes: { class: 'Class 99' } } });
  assert.equal(badClass.status, 422);
  assert.equal((await call(env, 'POST', path, { headers: VIEW, body: { changes: {} } })).status, 422);

  const ok = await call(env, 'POST', path, { headers: VIEW, body: {
    updated_at: before.updated_at,
    changes: { name: 'Shiva  Panwar', class: 'Class 9', phone: '+91 91234 56780', school: '', fee_plan: 'One time', fee_amount: '18,000', joined_on: '2026-04-02', left_on: '2026-06-01' },
  } });
  assert.equal(ok.status, 200);
  const p = ok.data.person;
  assert.equal(p.name, 'Shiva Panwar');
  assert.equal(p.class, 'Class 9');
  assert.equal(p.phone, '9123456780');
  assert.equal(p.joined_on, '2026-04-02');
  assert.equal(p.left_on, null, 'the left date is only for someone who left');
  assert.deepEqual(p.details, { enrollment_no: '003', fee_plan: 'One time', fee_amount: 18000 }, 'school cleared, others kept');

  const stale = await call(env, 'POST', path, { headers: VIEW, body: { updated_at: before.updated_at, changes: { class: 'Class 10' } } });
  assert.equal(stale.status, 409, 'an old page cannot overwrite a newer change');
  assert.equal((await call(env, 'POST', '/api/people/STU-0099', { headers: VIEW, body: { changes: { class: 'Class 6' } } })).status, 404);

  // the new name is used to match typed names afterwards
  const fee = await save(env, 'fee', { student_name: 'shiva panwar', class: 'Class 9', amount: '500' });
  assert.equal(fee.data.person.code, code);
  const history = await env.DB.prepare("SELECT COUNT(*) AS n FROM people_history WHERE action = 'changed'").first();
  assert.ok(history.n >= 1);
  const sync = await call(env, 'GET', '/api/registers?kind=student', { headers: { authorization: `Bearer ${KEY}` } });
  assert.equal(sync.status, 200);
});

test('edit details: a teacher, and the left date for someone who left', async () => {
  const env = freshEnv();
  const t = await save(env, 'teacher', { teacher_name: 'Anita Negi', salary: '15000', subjects: 'Physics' });
  const code = t.data.person.code;
  await save(env, 'teacher_left', { date: '2026-10-31', teacher_name: 'Anita Negi' }, { person_code: code });
  const r = await call(env, 'POST', `/api/people/${code}`, { headers: VIEW, body: { changes: { salary: '16000', subjects: 'Physics, Maths', left_on: '2026-10-30', fee_plan: 'Monthly' } } });
  assert.equal(r.status, 200);
  assert.equal(r.data.person.left_on, '2026-10-30');
  assert.equal(r.data.person.status, 'Left');
  assert.deepEqual(r.data.person.details, { salary: 16000, subjects: 'Physics, Maths' }, 'student-only fields are ignored for a teacher');
});

test('teacher enquiries: kept with the teachers, not counted, and can be hired later', async () => {
  const env = freshEnv();
  const anita = await save(env, 'teacher', { date: '2026-01-05', teacher_name: 'Anita Negi' });
  const enq = await save(env, 'teacher_enquiry', { teacher_name: 'Arrushi Kasturiwal', phone: '9876543210', subjects: 'Chemistry', qualification: 'M.Sc.', experience: '2 years', salary_asked: '18000', outcome: 'Not hired' });
  assert.equal(enq.status, 201);
  assert.equal(enq.data.entry.code, 'TEQ-0001');
  assert.equal(enq.data.person.added, true);
  const code = enq.data.person.code;
  const page = async (c) => (await call(env, 'GET', `/api/people/${c}`, { headers: VIEW })).data.person;
  let p = await page(code);
  assert.equal(p.status, 'Enquiry');
  assert.deepEqual(p.details, { subjects: 'Chemistry', qualification: 'M.Sc.', experience: '2 years', salary_asked: 18000 });

  const list = (await call(env, 'GET', '/api/people?kind=teacher', { headers: VIEW })).data.people;
  assert.deepEqual(list.map((x) => `${x.name}:${x.status}`).sort(), ['Anita Negi:Active', 'Arrushi Kasturiwal:Enquiry']);
  const a = (await call(env, 'GET', '/api/analytics', { headers: VIEW })).data;
  assert.equal(a.teachers.active, 1, 'an enquiry is not a teacher');
  const cal = (await call(env, 'GET', '/api/calendar', { headers: VIEW })).data;
  assert.deepEqual(cal.teachers.map((t) => t.name), ['Anita Negi'], 'not on the leave calendar');

  // an enquiry about someone already teaching does not change them
  const again = await save(env, 'teacher_enquiry', { teacher_name: 'Anita Negi', subjects: 'Physics' }, { person_code: anita.data.person.code });
  assert.equal(again.data.person.added, false);
  assert.equal((await page(anita.data.person.code)).status, 'Active');

  // the list-as switch in Edit details
  const sw = await call(env, 'POST', `/api/people/${code}`, { headers: VIEW, body: { changes: { listed_as: 'Teacher' } } });
  assert.equal(sw.data.person.status, 'Active');
  const back = await call(env, 'POST', `/api/people/${code}`, { headers: VIEW, body: { changes: { listed_as: 'Enquiry, not hired' } } });
  assert.equal(back.data.person.status, 'Enquiry');
  assert.equal((await call(env, 'POST', `/api/people/${code}`, { headers: VIEW, body: { changes: { listed_as: 'Boss' } } })).status, 422);

  // hired later with the New teacher form
  const hired = await save(env, 'teacher', { date: '2026-11-16', teacher_name: 'Arrushi Kasturiwal', salary: '17000', subjects: 'Chemistry' }, { person_code: code });
  assert.equal(hired.data.person.code, code);
  p = await page(code);
  assert.equal(p.status, 'Active');
  assert.equal(p.joined_on, '2026-11-16');
  assert.equal(p.details.salary, 17000);
  assert.equal(p.details.experience, '2 years', 'what was known from the enquiry stays');

  // a Left teacher cannot be switched with listed_as
  await save(env, 'teacher_left', { date: '2026-11-20', teacher_name: 'Anita Negi' }, { person_code: anita.data.person.code });
  const ignored = await call(env, 'POST', `/api/people/${anita.data.person.code}`, { headers: VIEW, body: { changes: { listed_as: 'Teacher', subjects: 'Physics' } } });
  assert.equal(ignored.data.person.status, 'Left');

  // a hidden (cancelled) enquiry comes back as an enquiry
  const typo = await save(env, 'teacher_enquiry', { teacher_name: 'Typo Name' });
  await call(env, 'POST', `/api/entries/${typo.data.entry.code}/cancel`, { headers: VIEW, body: { token: typo.cancel_token } });
  const redo = await save(env, 'teacher_enquiry', { teacher_name: 'Typo Name' });
  assert.equal((await page(redo.data.person.code)).status, 'Enquiry');
});

test('money returned: counted as paid out, never taken off the fees collected', async () => {
  const env = freshEnv();
  const adm = await save(env, 'admission', { student_name: 'Ayush Singh', class: 'Class 8', fee_plan: 'One time' });
  const code = adm.data.person.code;
  await save(env, 'fee', { date: today, student_name: 'Ayush Singh', class: 'Class 8', amount: '17000', mode: 'Cash' }, { person_code: code });
  const left = await save(env, 'student_left', { date: today, student_name: 'Ayush Singh', class: 'Class 8' }, { person_code: code });
  assert.equal(left.status, 201);
  const zero = await save(env, 'refund', { student_name: 'Ayush Singh', amount: '0' }, { person_code: code });
  assert.equal(zero.status, 422);
  const r = await save(env, 'refund', { date: today, student_name: 'Ayush Singh', class: 'Class 8', amount: '6,000', mode: 'UPI', reason: 'Left after two months' }, { person_code: code });
  assert.equal(r.status, 201);
  assert.equal(r.data.entry.code, 'RFD-0001');
  assert.equal(r.data.person.code, code);

  const list = (await call(env, 'GET', '/api/people?kind=student', { headers: VIEW })).data.people;
  assert.equal(list.find((x) => x.code === code).total_paid, 17000, 'what the student paid stays as it was');
  const reg = (await call(env, 'GET', '/api/registers?kind=student', { headers: { authorization: `Bearer ${KEY}` } })).data.people;
  assert.equal(reg[0].total_paid, 17000);
  assert.equal(reg[0].refunded, 6000);
  const a = (await call(env, 'GET', '/api/analytics', { headers: VIEW })).data;
  assert.equal(a.fees.at(-1).amount, 17000, 'fees collected are not reduced');
  assert.equal(a.fees.at(-1).n, 1, 'one fee payment');
  assert.equal(a.refunds.at(-1).amount, 6000, 'the money returned is its own paid-out series');

  // a refund alone does not count as paying this month
  const other = await save(env, 'admission', { student_name: 'Riya', class: 'Class 6' });
  await save(env, 'refund', { student_name: 'Riya', amount: '500' }, { person_code: other.data.person.code });
  const riya = (await call(env, 'GET', '/api/people?kind=student', { headers: VIEW })).data.people.find((x) => x.name === 'Riya');
  assert.equal(riya.paid_this_month, 0);
  assert.equal(riya.total_paid, 0);
  // a typed name that is not in the register is still saved
  const loose = await save(env, 'refund', { student_name: 'Someone Else', amount: '100' });
  assert.equal(loose.status, 201);
  assert.equal(loose.data.person, null);
});

test('migration 0004 keeps every student and teacher, with the same ids and rules', async () => {
  const { DatabaseSync } = await import('node:sqlite');
  const { readFileSync } = await import('node:fs');
  const dir = new URL('../migrations/', import.meta.url);
  const db = new DatabaseSync(':memory:');
  for (const f of ['0001_init.sql', '0002_people.sql', '0003_tasks.sql']) db.exec(readFileSync(new URL(f, dir), 'utf8'));
  const ins = db.prepare("INSERT INTO people (kind, seq, code, name, name_key, class, status, details, created_from_client) VALUES (?,?,?,?,?,?,?,?,?)");
  ins.run('student', 1, 'STU-0001', 'Vanya', 'vanya', 'Class 6', 'Active', '{"enrollment_no":"018"}', 'c-0001-aaaaaaaa');
  ins.run('teacher', 1, 'TR-0001', 'Anita Negi', 'anita negi', null, 'Left', '{}', null);
  db.prepare("INSERT INTO entries (type, seq, code, status, name, data, client_id, person_id) VALUES ('teacher_left', 1, 'TCL-0001', 'Active', 'Anita Negi', '{}', 'e-0001-aaaaaaaa', 2)").run();
  const before = db.prepare('SELECT * FROM people ORDER BY id').all();
  const history = db.prepare('SELECT COUNT(*) AS n FROM people_history').get().n;
  db.exec(readFileSync(new URL('0004_teacher_enquiries.sql', dir), 'utf8'));
  assert.deepEqual(db.prepare('SELECT * FROM people ORDER BY id').all(), before);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM people_history').get().n, history);
  ins.run('teacher', 2, 'TR-0002', 'New', 'new', null, 'Enquiry', '{}', null);
  assert.equal(db.prepare("SELECT id FROM people WHERE code = 'TR-0002'").get().id, 3);
  assert.throws(() => ins.run('teacher', 3, 'TR-0003', 'X', 'x', null, 'Bogus', '{}', null), /CHECK/);
  assert.throws(() => db.prepare("DELETE FROM people WHERE id = 1").run(), /cannot be deleted/);
  db.prepare("UPDATE entries SET status = 'Cancelled' WHERE code = 'TCL-0001'").run();
  assert.equal(db.prepare("SELECT status FROM people WHERE code = 'TR-0001'").get().status, 'Active');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM teachers').get().n, 2);
});

test('a teacher enquiry saved before migration 0004 asks for db:setup and stays queued', async () => {
  const { mkdtempSync, copyFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const dir = mkdtempSync(join(tmpdir(), 'sp-old-'));
  for (const f of ['0001_init.sql', '0002_people.sql', '0003_tasks.sql']) copyFileSync(join(ROOT, 'migrations', f), join(dir, f));
  const env = { DB: createD1(':memory:', dir), SYNC_KEY: KEY };
  const res = await save(env, 'teacher_enquiry', { teacher_name: 'Arrushi Kasturiwal' });
  assert.equal(res.status, 503, 'the page keeps it and sends it again later');
  assert.match(res.data.error, /npm run db:setup/);
  // everything else still works on the old database
  assert.equal((await save(env, 'teacher', { teacher_name: 'Anita Negi' })).status, 201);
  const list = (await call(env, 'GET', '/api/people?kind=teacher', { headers: VIEW })).data.people;
  assert.deepEqual(list.map((p) => p.name), ['Anita Negi'], 'nothing half-saved from the refused enquiry');
});

test('a fee typed with a minus amount is saved as money returned', async () => {
  const env = freshEnv();
  const adm = await save(env, 'admission', { student_name: 'Ayush Singh', class: 'Class 8', fee_plan: 'One time' });
  const code = adm.data.person.code;
  await save(env, 'fee', fee({ student_name: 'Ayush Singh', class: 'Class 8', amount: '17000' }), { person_code: code });
  const r = await save(env, 'fee', fee({ student_name: 'Ayush Singh', class: 'Class 8', amount: '-6,000', reference: 'UTR 4411' }), { person_code: code });
  assert.equal(r.status, 201);
  assert.match(r.data.entry.code, /^RFD-/);
  const page = (await call(env, 'GET', `/api/people/${code}`, { headers: VIEW })).data;
  const back = page.entries.find((e) => e.code === r.data.entry.code);
  assert.equal(back.type, 'refund');
  assert.equal(back.amount, 6000);
  assert.equal(back.data.mode, 'UPI');
  assert.match(back.data.notes, /UPI or cheque number: UTR 4411/);
  const list = (await call(env, 'GET', '/api/people?kind=student', { headers: VIEW })).data.people;
  assert.equal(list.find((x) => x.code === code).total_paid, 17000);

  // the sign is not needed on Money returned, and other amounts refuse it with a clear message
  const plain = await save(env, 'refund', { student_name: 'Ayush Singh', amount: '−500' }, { person_code: code });
  assert.equal(plain.status, 201);
  assert.equal((await call(env, 'GET', `/api/people/${code}`, { headers: VIEW })).data.entries.find((e) => e.code === plain.data.entry.code).amount, 500);
  const pay = await save(env, 'teacher_payment', { teacher_name: 'Anita Negi', amount: '-500' });
  assert.equal(pay.status, 422);
  assert.equal(pay.data.fields.amount, 'Enter the amount without a minus sign.');
  assert.equal((await save(env, 'fee', fee({ amount: '-0' }))).status, 422);
});

test('students: enquiry, then demo classes, then full admission, on one record', async () => {
  const env = freshEnv();
  const page = async (c) => (await call(env, 'GET', `/api/people/${c}`, { headers: VIEW })).data.person;
  const enq = await save(env, 'enquiry', { date: today, student_name: 'Muskaan Rawat', parent_name: 'Ravi Rawat', phone: '9876500001', class: 'Class 5', school: 'DPS', subjects: 'Maths', source: 'Walk-in' });
  assert.equal(enq.status, 201);
  assert.equal(enq.data.person.added, true);
  const code = enq.data.person.code;
  let p = await page(code);
  assert.equal(p.status, 'Enquiry');
  assert.equal(p.class, 'Class 5');
  assert.equal(p.phone, '9876500001');
  assert.deepEqual(p.details, { parent_name: 'Ravi Rawat', school: 'DPS', subjects: 'Maths' });
  let a = (await call(env, 'GET', '/api/analytics', { headers: VIEW })).data;
  assert.equal(a.students.active, 0, 'an enquiry is not a student yet');
  assert.deepEqual(a.conversion, { enquiries: 1, joined: 0, demo: 0 });
  assert.equal(a.not_paid.length, 0, 'no fee is due from an enquiry');

  // a follow-up enquiry goes onto the same record
  const again = await save(env, 'enquiry', { date: today, student_name: 'muskaan rawat', notes: 'Called back' });
  assert.equal(again.data.person.code, code);

  // Move to demo
  const demo = await save(env, 'demo', { demo_from: today, student_name: 'Muskaan Rawat', subjects: 'Maths, Science', teacher_name: 'Anita Negi' }, { person_code: code });
  assert.equal(demo.status, 201);
  assert.match(demo.data.entry.code, /^DEM-/);
  p = await page(code);
  assert.equal(p.status, 'Demo');
  assert.equal(p.details.demo_from, today);
  assert.equal(p.details.subjects, 'Maths, Science');
  a = (await call(env, 'GET', '/api/analytics', { headers: VIEW })).data;
  assert.equal(a.students.active, 0, 'demo students are not counted yet');
  assert.deepEqual(a.conversion, { enquiries: 1, joined: 0, demo: 1 });

  // Full admission: same record, joined today
  const adm = await save(env, 'admission', { date: today, student_name: 'Muskaan Rawat', class: 'Class 6', fee_amount: '1500', fee_plan: 'Monthly' }, { person_code: code });
  assert.equal(adm.status, 201);
  assert.equal(adm.data.person.code, code);
  p = await page(code);
  assert.equal(p.status, 'Active');
  assert.equal(p.joined_on, today);
  assert.equal(p.class, 'Class 6');
  assert.equal(p.details.parent_name, 'Ravi Rawat', 'what was noted at the enquiry stays');
  a = (await call(env, 'GET', '/api/analytics', { headers: VIEW })).data;
  assert.equal(a.students.active, 1);
  assert.deepEqual(a.conversion, { enquiries: 1, joined: 1, demo: 0 }, 'one enquirer, who joined, however many times they came');
  assert.equal((await call(env, 'GET', '/api/people?kind=student', { headers: VIEW })).data.people.length, 1);

  // one admission is one: a second admission for her is refused, typed or picked
  const twice = await save(env, 'admission', { student_name: 'MUSKAAN RAWAT', class: 'Class 6' });
  assert.equal(twice.status, 422);
  assert.match(twice.data.error, /Muskaan Rawat is already admitted \(STU-0001\)/);
  assert.equal((await save(env, 'admission', { student_name: 'Muskaan Rawat' }, { person_code: code })).status, 422);
  // an enquiry or a demo about someone already studying here changes nothing on their record
  await save(env, 'enquiry', { student_name: 'Muskaan Rawat', school: 'Other School', class: 'Class 9' });
  await save(env, 'demo', { student_name: 'Muskaan Rawat', subjects: 'Physics' });
  p = await page(code);
  assert.equal(p.status, 'Active');
  assert.equal(p.class, 'Class 6');
  assert.equal(p.details.school, 'DPS');
  assert.equal(p.details.subjects, 'Maths, Science');

  // someone who comes straight for a demo class is added in Demo
  const walkIn = await save(env, 'demo', { demo_from: today, student_name: 'Riya Bisht', class: 'Class 4' });
  assert.equal(walkIn.data.person.added, true);
  assert.equal((await page(walkIn.data.person.code)).status, 'Demo');
  // and one who did not join after the demo
  await save(env, 'student_left', { student_name: 'Riya Bisht', reason: 'Did not join' }, { person_code: walkIn.data.person.code });
  assert.equal((await page(walkIn.data.person.code)).status, 'Left');
  a = (await call(env, 'GET', '/api/analytics', { headers: VIEW })).data;
  assert.equal(a.students.active, 1);
  assert.equal(a.students.left, 1);

  // a student first added by a fee can still get their admission form
  const fromFee = await save(env, 'fee', fee({ student_name: 'Dev', class: 'Class 10' }));
  const devAdm = await save(env, 'admission', { student_name: 'Dev', class: 'Class 10', enrollment_no: '031' });
  assert.equal(devAdm.status, 201);
  assert.equal(devAdm.data.person.code, fromFee.data.person.code);
  // after leaving, the admission form is how they rejoin
  await save(env, 'student_left', { student_name: 'Dev' }, { person_code: fromFee.data.person.code });
  assert.equal((await save(env, 'admission', { student_name: 'Dev', class: 'Class 11' }, { person_code: fromFee.data.person.code })).status, 201);

  // Edit details: Enquiry, Demo or Student, and a name that is taken is refused
  for (const [label, status] of [['Demo', 'Demo'], ['Enquiry', 'Enquiry'], ['Student', 'Active']]) {
    const sw = await call(env, 'POST', `/api/people/${code}`, { headers: VIEW, body: { changes: { listed_as: label } } });
    assert.equal(sw.data.person.status, status);
  }
  const taken = await call(env, 'POST', `/api/people/${code}`, { headers: VIEW, body: { changes: { name: 'dev' } } });
  assert.equal(taken.status, 422);
  assert.match(taken.data.error, /already has this full name/);
  const fine = await call(env, 'POST', `/api/people/${code}`, { headers: VIEW, body: { changes: { name: 'Muskaan Rawat', email: 'm@example.com' } } });
  assert.equal(fine.status, 200, 'keeping your own name is fine');
  // teachers cannot be in demo classes
  const t = await save(env, 'teacher', { teacher_name: 'Anita Negi' });
  const tDemo = await call(env, 'POST', `/api/people/${t.data.person.code}`, { headers: VIEW, body: { changes: { listed_as: 'Demo' } } });
  assert.equal(tDemo.status, 422);
});

test('a teacher who joined already is not added a second time', async () => {
  const env = freshEnv();
  const first = await save(env, 'teacher', { teacher_name: 'Anita Negi', subjects: 'Physics' });
  const twice = await save(env, 'teacher', { teacher_name: 'anita negi' });
  assert.equal(twice.status, 422);
  assert.match(twice.data.error, /Anita Negi is already joined as a teacher \(TR-0001\)/);
  // sending the very same entry again (a weak connection) is still answered as saved
  const resend = await call(env, 'POST', '/api/entries', { headers: VIEW, body: { client_id: first.client_id, cancel_token: first.cancel_token, type: 'teacher', data: { teacher_name: 'Anita Negi', subjects: 'Physics' } } });
  assert.equal(resend.status, 200);
  assert.equal(resend.data.duplicate, true);
});

test('migration 0005 allows Demo, gives every full name one record and lists old enquiries', async () => {
  const { execFileSync } = await import('node:child_process');
  const out = execFileSync(process.execPath, [join(ROOT, 'test', 'migration-0005.check.mjs')], { env: { ...process.env, APP_DIR: ROOT }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  assert.match(out, /migration 0005 checks passed/);
});

/* ---------------- Version 3: logins, the teacher and student portals, task fields ---------------- */

const ADMIN_PASSWORD = 'papa-secret-1';
const loginsEnv = () => freshEnv({ ADMIN_PASSWORD });

async function loginAs(env, role, username, password, headers = {}) {
  const res = await worker.fetch(new Request('https://app.test/api/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-successpath': '1', ...headers },
    body: JSON.stringify({ role, username, password }),
  }), env);
  const set = res.headers.get('set-cookie') || '';
  return { status: res.status, data: await res.json(), set, cookie: set.split(';')[0] };
}
const as = (cookie, extra = {}) => ({ 'x-successpath': '1', cookie, ...extra });
const officeCookie = async (env) => (await loginAs(env, 'admin', '', ADMIN_PASSWORD)).cookie;
const saveAs = (env, cookie, type, data, extra = {}) => {
  const id = ids();
  return call(env, 'POST', '/api/entries', { headers: as(cookie), body: { ...id, type, data, ...extra } }).then((r) => ({ ...r, ...id }));
};

test('logins are off until ADMIN_PASSWORD is set: the office stays open, the portals stay closed', async () => {
  const env = freshEnv();
  assert.equal((await call(env, 'GET', '/api/health')).data.logins, false);
  assert.equal((await call(env, 'GET', '/api/people?kind=student', { headers: VIEW })).status, 200);
  const s = await call(env, 'GET', '/api/session?role=admin', { headers: VIEW });
  assert.deepEqual([s.data.logins, s.data.signed_in], [false, true]);
  const t = await loginAs(env, 'teacher', 'anyone2026', '1234');
  assert.equal(t.status, 403);
  assert.match(t.data.error, /not open yet/);
  assert.equal((await call(env, 'GET', '/api/portal/teacher', { headers: VIEW })).status, 403);
  assert.equal((await call(env, 'GET', '/api/portal/student', { headers: VIEW })).status, 403);
});

test('the office logs in with the admin password; nothing is shown without it', async () => {
  const env = loginsEnv();
  assert.equal((await call(env, 'GET', '/api/health')).data.logins, true);
  for (const [method, path] of [['GET', '/api/people?kind=student'], ['GET', '/api/analytics'], ['GET', '/api/calendar'], ['GET', '/api/tasks'], ['GET', '/api/people/STU-0001']]) {
    const r = await call(env, method, path, { headers: VIEW });
    assert.equal(r.status, 401, path);
    assert.equal(r.data.login, 'admin');
  }
  const blocked = await save(env, 'fee', fee());
  assert.equal(blocked.status, 401, 'an entry without the login is kept on the phone and sent after logging in');
  const wrong = await loginAs(env, 'admin', '', 'guess');
  assert.equal(wrong.status, 401);
  assert.equal(wrong.set, '');
  const ok = await loginAs(env, 'admin', '', ADMIN_PASSWORD);
  assert.equal(ok.status, 200);
  assert.match(ok.set, /^sp_admin=[^;]+; Path=\/; Max-Age=31536000; HttpOnly; SameSite=Lax; Secure$/);
  assert.equal((await call(env, 'GET', '/api/people?kind=student', { headers: as(ok.cookie) })).status, 200);
  assert.equal((await saveAs(env, ok.cookie, 'fee', fee())).status, 201);
  assert.equal((await call(env, 'GET', '/api/session?role=admin', { headers: as(ok.cookie) })).data.signed_in, true);
  // a changed cookie, or one from before the password was changed, does not work
  const tampered = ok.cookie.slice(0, -3) + (ok.cookie.endsWith('AAA') ? 'BBB' : 'AAA');
  assert.equal((await call(env, 'GET', '/api/people?kind=student', { headers: as(tampered) })).status, 401);
  const changed = { ...env, ADMIN_PASSWORD: 'a-new-password' };
  assert.equal((await call(changed, 'GET', '/api/people?kind=student', { headers: as(ok.cookie) })).status, 401);
  // logging out
  const out = await call(env, 'POST', '/api/logout', { headers: as(ok.cookie), body: { role: 'admin' } });
  assert.equal(out.status, 200);
  // the Google Sheet keeps working with its own key
  assert.equal((await call(env, 'GET', '/api/sync?after=0', { headers: { authorization: `Bearer ${KEY}` } })).status, 200);
  // too many wrong passwords from one address are stopped for a while
  const ip = { 'cf-connecting-ip': '203.0.113.9' };
  for (let i = 0; i < 10; i++) assert.equal((await loginAs(env, 'admin', '', 'nope', ip)).status, 401);
  const stopped = await loginAs(env, 'admin', '', ADMIN_PASSWORD, ip);
  assert.equal(stopped.status, 429);
  assert.equal((await loginAs(env, 'admin', '', ADMIN_PASSWORD, { 'cf-connecting-ip': '203.0.113.10' })).status, 200);
});

async function portalSchool(env) {
  const office = await officeCookie(env);
  const s = (type, data, extra) => saveAs(env, office, type, data, extra);
  const anita = await s('teacher', { date: '2025-06-01', teacher_name: 'Anita Negi', phone: '9876543210', subjects: 'Physics', classes: 'Class 9, 10', salary: '20000' });
  const vikram = await s('teacher', { date: '2026-04-01', teacher_name: 'Vikram Rawat', classes: '11th, 12th', salary: '25000' });
  await s('teacher_enquiry', { teacher_name: 'Not Hired' });
  const rahul = await s('admission', { date: today, student_name: 'Rahul Sharma', class: 'Class 9', phone: '9811111111', fee_amount: '1500', fee_plan: 'Monthly', school: 'Doon School', subjects: 'Maths, Physics', address: 'Rajpur Road' });
  const priya = await s('admission', { date: today, student_name: 'Priya Negi', class: 'Class 7', phone: '9822222222' });
  await s('fee', fee({ student_name: 'Rahul Sharma', class: 'Class 9', amount: '1500' }), { person_code: rahul.data.person.code });
  await s('marks', { date: today, student_name: 'Rahul Sharma', class: 'Class 9', subject: 'Physics', marks: '42', out_of: '50' }, { person_code: rahul.data.person.code });
  await s('exam', { student_name: 'Rahul Sharma', class: 'Class 9', exam: 'Half-yearly', starts_on: addDays(today, 10) }, { person_code: rahul.data.person.code });
  await s('exam', { class: 'Class 9', school: 'Doon School', exam: 'Unit test', starts_on: addDays(today, 3) });
  await s('enquiry', { date: today, student_name: 'Just Asking', class: 'Class 9' });
  return { office, anita: anita.data.person.code, vikram: vikram.data.person.code, rahul: rahul.data.person.code, priya: priya.data.person.code };
}

function addDays(iso, n) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

test('teachers log in with their name and joining year and see students, never money or phone numbers', async () => {
  const env = loginsEnv();
  const ids2 = await portalSchool(env);
  const page = (await call(env, 'GET', `/api/people/${ids2.anita}`, { headers: as(ids2.office) })).data;
  assert.equal(page.portal.username, 'anitanegi2025');
  assert.equal(page.portal.password, '1234');
  assert.deepEqual(page.portal.classes_taught, ['Class 9', 'Class 10']);
  assert.equal(page.portal.can_log_in, true);

  assert.equal((await loginAs(env, 'teacher', 'anitanegi2025', '0000')).status, 401);
  assert.equal((await loginAs(env, 'teacher', 'notanyone2025', '1234')).status, 401);
  assert.equal((await loginAs(env, 'teacher', `nothired${today.slice(0, 4)}`, '1234')).status, 401, 'an enquiry cannot log in');
  const t = await loginAs(env, 'teacher', ' AnitaNegi 2025 ', '1234');
  assert.equal(t.status, 200);
  assert.equal(t.data.name, 'Anita Negi');
  assert.match(t.set, /^sp_teacher=/);
  const h = as(t.cookie, { 'x-successpath-as': 'teacher' });

  // the office pages stay closed to a teacher
  for (const path of ['/api/people?kind=student', '/api/people?kind=teacher', '/api/analytics', `/api/people/${ids2.rahul}`]) {
    assert.equal((await call(env, 'GET', path, { headers: h })).status, 401, path);
  }
  assert.equal((await call(env, 'POST', '/api/entries', { headers: h, body: { ...ids(), type: 'fee', data: fee() } })).status, 401);
  assert.equal((await call(env, 'GET', '/api/portal/student', { headers: h })).status, 401);

  const home = await call(env, 'GET', '/api/portal/teacher', { headers: h });
  assert.equal(home.status, 200);
  assert.deepEqual(home.data.me, {
    code: ids2.anita, name: 'Anita Negi', username: 'anitanegi2025', subjects: 'Physics', classes: 'Class 9, 10',
    classes_taught: ['Class 9', 'Class 10'], qualification: null, experience: null, joined_on: '2025-06-01',
  });
  assert.doesNotMatch(home.text, /20000|9876543210|salary/i);

  const list = await call(env, 'GET', '/api/portal/teacher/students', { headers: h });
  assert.deepEqual(list.data.people.map((p) => `${p.name}:${p.mine}`), ['Priya Negi:false', 'Rahul Sharma:true']);
  assert.equal(list.data.people.find((p) => p.name === 'Rahul Sharma').last_percent, 84);
  assert.doesNotMatch(list.text, /98111|98222|1500|Rajpur|Just Asking/, 'no phones, fees, addresses or enquiries');

  const one = await call(env, 'GET', `/api/portal/teacher/students/${ids2.rahul}`, { headers: h });
  assert.equal(one.status, 200);
  assert.equal(one.data.student.school, 'Doon School');
  assert.equal(one.data.marks.length, 1);
  assert.equal(one.data.exams.length, 1);
  assert.equal(one.data.class_exams.length, 1, 'the class exam counts for him too');
  assert.doesNotMatch(one.text, /98111|1500|Rajpur/);
  const enquiry = (await call(env, 'GET', '/api/people?kind=student', { headers: as(ids2.office) })).data.people.find((p) => p.name === 'Just Asking');
  assert.equal((await call(env, 'GET', `/api/portal/teacher/students/${enquiry.code}`, { headers: h })).status, 404);

  // the shared Tasks board
  const board = await call(env, 'GET', '/api/tasks', { headers: h });
  assert.equal(board.status, 200);
  assert.deepEqual(board.data.teachers, ['Anita Negi', 'Vikram Rawat']);
});

test('students log in, see their own marks and teachers, and send messages only the chosen teacher sees', async () => {
  const env = loginsEnv();
  const ids2 = await portalSchool(env);
  const year = today.slice(0, 4);
  const st = await loginAs(env, 'student', `rahulsharma${year}`, '1234');
  assert.equal(st.status, 200);
  const h = as(st.cookie);
  assert.equal((await call(env, 'GET', '/api/portal/teacher', { headers: h })).status, 401);
  assert.equal((await call(env, 'GET', '/api/people?kind=student', { headers: h })).status, 401);
  assert.equal((await call(env, 'GET', '/api/tasks', { headers: h })).status, 401, 'tasks are for the office and teachers');

  const home = await call(env, 'GET', '/api/portal/student', { headers: h });
  assert.equal(home.status, 200);
  assert.deepEqual(home.data.me, { code: ids2.rahul, name: 'Rahul Sharma', username: `rahulsharma${year}`, class: 'Class 9', school: 'Doon School', subjects: 'Maths, Physics', enrollment_no: null, joined_on: today });
  assert.equal(home.data.marks.length, 1);
  assert.equal(home.data.exams.length, 1);
  assert.equal(home.data.class_exams.length, 1);
  assert.deepEqual(home.data.teachers.map((t) => `${t.name}:${t.mine}`), ['Anita Negi:true', 'Vikram Rawat:false']);
  assert.doesNotMatch(home.text, /98111|9876543210|1500|20000|25000|Rajpur/);

  // messages
  const send = (body) => call(env, 'POST', '/api/portal/student/messages', { headers: h, body: { client_id: ids().client_id, ...body } });
  assert.equal((await send({ teacher_code: 'TR-0099', about: 'Complaint', message: 'x' })).status, 422);
  assert.equal((await send({ teacher_code: ids2.anita, about: 'Gossip', message: 'x' })).status, 422);
  assert.equal((await send({ teacher_code: ids2.anita, about: 'Complaint', message: '   ' })).status, 422);
  const sent = await send({ teacher_code: ids2.anita, about: 'Help with a topic', message: 'Please explain refraction again.' });
  assert.equal(sent.status, 201);
  assert.match(sent.data.entry.code, /^MSG-/);
  await send({ teacher_code: ids2.vikram, about: 'Special requirement', message: 'I need extra time in tests.' });

  const anita = as((await loginAs(env, 'teacher', 'anitanegi2025', '1234')).cookie);
  const vikram = as((await loginAs(env, 'teacher', 'vikramrawat2026', '1234')).cookie);
  const inbox = (await call(env, 'GET', '/api/portal/teacher/enquiries', { headers: anita })).data;
  assert.deepEqual(inbox.messages.map((m) => `${m.student_name}|${m.about}|${m.message}`), ['Rahul Sharma|Help with a topic|Please explain refraction again.']);
  assert.equal((await call(env, 'GET', '/api/portal/teacher/enquiries', { headers: vikram })).data.messages.length, 1);
  assert.equal((await call(env, 'GET', `/api/portal/teacher/students/${ids2.rahul}`, { headers: anita })).data.messages.length, 1);
  assert.equal((await call(env, 'GET', '/api/portal/student', { headers: h })).data.messages.length, 2);
  // the office sees all of it
  const tPage = (await call(env, 'GET', `/api/people/${ids2.anita}`, { headers: as(ids2.office) })).data;
  assert.equal(tPage.messages_to.length, 1);
  const sPage = (await call(env, 'GET', `/api/people/${ids2.rahul}`, { headers: as(ids2.office) })).data;
  assert.equal(sPage.entries.filter((e) => e.type === 'portal_message').length, 2);

  // an exam date added by the student
  const exam = await call(env, 'POST', '/api/portal/student/exams', { headers: h, body: { client_id: ids().client_id, exam: 'Annual', starts_on: addDays(today, 30), ends_on: addDays(today, 40), subjects: 'All' } });
  assert.equal(exam.status, 201);
  assert.equal((await call(env, 'POST', '/api/portal/student/exams', { headers: h, body: { client_id: ids().client_id, exam: 'Annual' } })).status, 422);
  const exams = (await call(env, 'GET', '/api/portal/teacher/enquiries', { headers: anita })).data.exams;
  const annual = exams.find((x) => x.exam === 'Annual');
  assert.equal(annual.added_by, 'Student portal');
  assert.equal(annual.mine, true);
  assert.equal(annual.student_name, 'Rahul Sharma');
  assert.ok(exams.find((x) => x.exam === 'Unit test' && x.student_name === null), 'whole-class dates are listed too');

  // the Google Sheet gets the messages like any entry
  const feed = (await call(env, 'GET', '/api/sync?after=0&limit=999', { headers: { authorization: `Bearer ${KEY}` } })).data;
  assert.ok(feed.changes.some((c) => c.entry && c.entry.type === 'portal_message' || c.type === 'portal_message'));

  // too many messages in a day are stopped
  let last;
  for (let i = 0; i < 30; i++) last = await send({ teacher_code: ids2.anita, about: 'Other', message: `Note ${i}` });
  assert.equal(last.status, 429);

  // after leaving, the login stops working
  await saveAs(env, ids2.office, 'student_left', { student_name: 'Rahul Sharma' }, { person_code: ids2.rahul });
  assert.equal((await call(env, 'GET', '/api/portal/student', { headers: h })).status, 401);
  assert.equal((await loginAs(env, 'student', `rahulsharma${year}`, '1234')).status, 401);
});

test('usernames: the same letters and year get -2, and a shared password can be changed', async () => {
  const env = { ...loginsEnv(), PORTAL_PASSWORD: 'shared-99' };
  const office = await officeCookie(env);
  const a = await saveAs(env, office, 'admission', { date: today, student_name: 'Rahul Sharma', class: 'Class 9' });
  const b = await saveAs(env, office, 'admission', { date: today, student_name: 'Rahul. Sharma', class: 'Class 6' });
  const year = today.slice(0, 4);
  const pa = (await call(env, 'GET', `/api/people/${a.data.person.code}`, { headers: as(office) })).data.portal;
  const pb = (await call(env, 'GET', `/api/people/${b.data.person.code}`, { headers: as(office) })).data.portal;
  assert.equal(pa.username, `rahulsharma${year}`);
  assert.equal(pb.username, `rahulsharma${year}-2`);
  assert.equal(pa.password, 'shared-99');
  assert.equal((await loginAs(env, 'student', `rahulsharma${year}`, '1234')).status, 401);
  const second = await loginAs(env, 'student', `rahulsharma${year}-2`, 'shared-99');
  assert.equal(second.status, 200);
  assert.equal(second.data.name, 'Rahul. Sharma');
});

test('tasks: start date, end date, budget and owner, and the teachers share the board', async () => {
  const env = loginsEnv();
  const office = await officeCookie(env);
  await saveAs(env, office, 'teacher', { teacher_name: 'Anita Negi', date: '2025-06-01' });
  const add = (body, cookie = office, extra = {}) => call(env, 'POST', '/api/tasks', { headers: as(cookie, extra), body: { client_id: ids().client_id, ...body } });
  const bad = await add({ title: 'Print posters', start_on: '2026-12-10', due_on: '2026-12-01' });
  assert.equal(bad.status, 422);
  assert.equal(bad.data.fields.due_on, 'The end date cannot be before the start date.');
  assert.equal((await add({ title: 'Print posters', budget: 'lots' })).status, 422);
  const made = await add({ title: 'Print posters', start_on: '2026-12-01', due_on: '2026-12-10', budget: '₹5,000', owner: 'Anita Negi' });
  assert.equal(made.status, 201);
  assert.deepEqual([made.data.task.start_on, made.data.task.due_on, made.data.task.budget, made.data.task.owner, made.data.task.changed_by],
    ['2026-12-01', '2026-12-10', 5000, 'Anita Negi', 'Office']);
  const t = as((await loginAs(env, 'teacher', 'anitanegi2025', '1234')).cookie, { 'x-successpath-as': 'teacher' });
  const moved = await call(env, 'POST', `/api/tasks/${made.data.task.code}`, { headers: t, body: { stage: 'Doing', budget: '6000' } });
  assert.equal(moved.status, 200);
  assert.equal(moved.data.task.changed_by, 'Anita Negi');
  assert.equal(moved.data.task.budget, 6000);
  const byTeacher = await add({ title: 'Make Class 9 test paper' }, t.cookie, { 'x-successpath-as': 'teacher' });
  assert.equal(byTeacher.data.task.changed_by, 'Anita Negi');
  const cleared = await call(env, 'POST', `/api/tasks/${made.data.task.code}`, { headers: as(office), body: { budget: '', start_on: null } });
  assert.deepEqual([cleared.data.task.budget, cleared.data.task.start_on, cleared.data.task.changed_by], [null, null, 'Office']);
  const exported = (await call(env, 'GET', '/api/tasks-export?after_id=0', { headers: { authorization: `Bearer ${KEY}` } })).data.tasks;
  assert.deepEqual(Object.keys(exported[0]).filter((k) => ['start_on', 'budget', 'changed_by'].includes(k)), ['start_on', 'budget', 'changed_by']);
  const schema = (await call(env, 'GET', '/api/sync?after=0', { headers: { authorization: `Bearer ${KEY}` } })).data.schema;
  assert.deepEqual(schema.tasks.columns.map((c) => c.label), ['Task ID', 'Task', 'Stage', 'Start date', 'End date', 'Budget (₹)', 'Owner', 'Notes', 'Last changed by', 'Added', 'Done on']);
});

test('classes a teacher teaches are read from what is written on their record', () => {
  const cases = {
    '9th, 10th': ['Class 9', 'Class 10'], 'Class 6-8': ['Class 6', 'Class 7', 'Class 8'], 'IX & X': ['Class 9', 'Class 10'],
    '11-12 PCM': ['Class 11', 'Class 12'], 'JEE batch': ['Competitive exam'], 'Class 10, 4-6 pm': ['Class 10'],
    'Class I-V': ['Class 1', 'Class 2', 'Class 3', 'Class 4', 'Class 5'], '': [], 'B.Sc maths': ['College'],
  };
  for (const [text, want] of Object.entries(cases)) assert.deepEqual(classesFromText(text), want, text);
});

test('leave: a teacher asks in the portal, the office approves or declines, and the calendars show it', async () => {
  const env = loginsEnv();
  const school = await portalSchool(env);
  const t = as((await loginAs(env, 'teacher', 'anitanegi2025', '1234')).cookie);
  const v = as((await loginAs(env, 'teacher', 'vikramrawat2026', '1234')).cookie);
  const office = as(school.office);
  const ask = (h, body) => call(env, 'POST', '/api/portal/teacher/leave-requests', { headers: h, body: { client_id: ids().client_id, ...body } });
  const d1 = addDays(today, 5);
  const d2 = addDays(today, 6);
  const month = d1.slice(0, 7);

  // what is refused
  assert.match((await ask(t, { from: addDays(today, -1) })).data.fields.from, /today or a later day/);
  assert.match((await ask(t, { from: d2, to: d1 })).data.fields.to, /cannot be before/);
  assert.match((await ask(t, { from: d1, to: addDays(today, 80) })).data.fields.to, /2 months/);
  assert.equal((await ask(t, { from: d1, reason: 'Holiday in Goa' })).status, 422);
  assert.equal((await ask(t, {})).status, 422);

  const req = await ask(t, { from: d1, to: d2, reason: 'Family function', notes: "Sister's wedding" });
  assert.equal(req.status, 201);
  assert.deepEqual([req.data.request.code, req.data.request.status, req.data.request.name], ['LRQ-0001', 'Pending', 'Anita Negi']);
  assert.match((await ask(t, { from: d2 })).data.error, /already asked for leave on some of these days \(LRQ-0001\)/);

  // the office sees it waiting, on the list and on the calendar; a teacher cannot approve it
  const waiting = (await call(env, 'GET', '/api/leave-requests', { headers: office })).data.requests;
  assert.deepEqual(waiting.map((r) => `${r.code}:${r.name}:${r.from}:${r.to}:${r.status}`), [`LRQ-0001:Anita Negi:${d1}:${d2}:Pending`]);
  assert.equal((await call(env, 'GET', `/api/calendar?month=${month}`, { headers: office })).data.requests.length, 1);
  assert.equal((await call(env, 'POST', '/api/leave-requests/LRQ-0001', { headers: t, body: { action: 'approve' } })).status, 401);
  assert.equal((await call(env, 'GET', '/api/leave-requests', { headers: t })).status, 401);
  const mineBefore = (await call(env, 'GET', `/api/portal/teacher/calendar?month=${month}`, { headers: t })).data;
  assert.deepEqual(mineBefore.requests.map((r) => `${r.code}:${r.status}`), ['LRQ-0001:Pending']);

  // approved: it becomes ordinary Teacher leave
  const ok = await call(env, 'POST', '/api/leave-requests/LRQ-0001', { headers: office, body: { action: 'approve' } });
  assert.equal(ok.status, 200);
  assert.equal(ok.data.request.status, 'Approved');
  assert.match(ok.data.request.leave_code, /^LVE-/);
  assert.equal((await call(env, 'POST', '/api/leave-requests/LRQ-0001', { headers: office, body: { action: 'approve' } })).data.already, true);
  assert.equal((await call(env, 'POST', '/api/leave-requests/LRQ-0001', { headers: office, body: { action: 'decline' } })).status, 409);
  const cal = (await call(env, 'GET', `/api/calendar?month=${month}`, { headers: office })).data;
  assert.ok(cal.leaves.some((l) => l.person_code === school.anita && l.from === d1 && l.to === d2 && l.reason === 'Family function'));
  assert.equal(cal.requests.length, 0);
  const page = (await call(env, 'GET', `/api/people/${school.anita}`, { headers: office })).data;
  assert.equal(page.leave_requests[0].status, 'Approved');
  assert.ok(page.entries.some((e) => e.type === 'leave' && e.data.request_code === 'LRQ-0001'));
  const feed = (await call(env, 'GET', '/api/sync?after=0&limit=999', { headers: { authorization: `Bearer ${KEY}` } })).data;
  assert.ok(JSON.stringify(feed).includes('LRQ-0001'), 'the Teacher Leave tab gets it like any leave');

  // another teacher sees that Anita is away, not why; Anita sees her own reason
  const vCal = (await call(env, 'GET', `/api/portal/teacher/calendar?month=${month}`, { headers: v })).data;
  const away = vCal.leaves.find((l) => l.person_code === school.anita);
  assert.deepEqual([away.from, away.to, away.reason, away.notes], [d1, d2, null, null]);
  assert.doesNotMatch(JSON.stringify(vCal), /wedding|Family function/);
  assert.deepEqual(vCal.teachers.map((x) => x.name), ['Anita Negi', 'Vikram Rawat']);
  assert.equal((await call(env, 'GET', `/api/portal/teacher/calendar?month=${month}`, { headers: t })).data.leaves.find((l) => l.person_code === school.anita).reason, 'Family function');

  // declined, and withdrawn
  const second = await ask(t, { from: addDays(today, 20), reason: 'Personal work' });
  const declined = await call(env, 'POST', `/api/leave-requests/${second.data.request.code}`, { headers: office, body: { action: 'decline', note: 'Exams that week' } });
  assert.deepEqual([declined.data.request.status, declined.data.request.decision_note], ['Declined', 'Exams that week']);
  const third = await ask(t, { from: addDays(today, 30) });
  assert.equal((await call(env, 'POST', `/api/portal/teacher/leave-requests/${third.data.request.code}/withdraw`, { headers: v })).status, 404, "not Vikram's request");
  assert.equal((await call(env, 'POST', `/api/portal/teacher/leave-requests/${third.data.request.code}/withdraw`, { headers: t })).data.request.status, 'Withdrawn');
  assert.equal((await call(env, 'POST', `/api/portal/teacher/leave-requests/${second.data.request.code}/withdraw`, { headers: t })).status, 409);

  // the teacher's Leave page
  const mine = (await call(env, 'GET', '/api/portal/teacher/leave', { headers: t })).data;
  assert.deepEqual(mine.requests.map((r) => r.status), ['Withdrawn', 'Declined', 'Approved']);
  assert.deepEqual(mine.leave.map((l) => `${l.from}:${l.to}:${l.request_code}`), [`${d1}:${d2}:LRQ-0001`]);
  assert.ok(mine.reasons.includes('Sick'));
  assert.equal((await call(env, 'GET', '/api/leave-requests', { headers: office })).data.requests.length, 0);
  assert.equal((await call(env, 'GET', '/api/leave-requests?status=all', { headers: office })).data.requests.length, 3);
  // a student's login does not open the teacher's leave
  const st = as((await loginAs(env, 'student', `rahulsharma${today.slice(0, 4)}`, '1234')).cookie);
  assert.equal((await ask(st, { from: d1 })).status, 401);
});

test('messages go both ways in conversations, with unread counts, and the bell shows what is new', async () => {
  const env = loginsEnv();
  const school = await portalSchool(env);
  const year = today.slice(0, 4);
  const st = as((await loginAs(env, 'student', `rahulsharma${year}`, '1234')).cookie);
  const t = as((await loginAs(env, 'teacher', 'anitanegi2025', '1234')).cookie);
  const office = as(school.office);
  const fromStudent = (body) => call(env, 'POST', '/api/portal/student/messages', { headers: st, body: { client_id: ids().client_id, ...body } });
  const fromTeacher = (body) => call(env, 'POST', '/api/portal/teacher/messages', { headers: t, body: { client_id: ids().client_id, ...body } });

  assert.equal((await fromStudent({ teacher_code: school.anita, about: 'Complaint', message: 'Less marks, please focus on English.' })).status, 201);
  let convs = (await call(env, 'GET', '/api/portal/teacher/messages', { headers: t })).data;
  assert.equal(convs.unread, 1);
  assert.deepEqual(convs.conversations.map((c) => `${c.name}:${c.class}:${c.unread}:${c.last.about}:${c.last.mine}`), ['Rahul Sharma:Class 9:1:Complaint:false']);
  let bell = (await call(env, 'GET', '/api/portal/teacher/notices', { headers: t })).data;
  assert.equal(bell.unread, 1);
  assert.equal(bell.items[0].text, 'Complaint from Rahul Sharma, Class 9');
  assert.equal(bell.items[0].href, `#/messages/${school.rahul}`);

  // opening the conversation marks it read
  const thread = (await call(env, 'GET', `/api/portal/teacher/messages/${school.rahul}`, { headers: t })).data;
  assert.deepEqual(thread.messages.map((m) => `${m.from}:${m.mine}:${m.about}`), ['Student:false:Complaint']);
  assert.equal((await call(env, 'GET', '/api/portal/teacher/messages', { headers: t })).data.unread, 0);
  assert.equal((await call(env, 'GET', '/api/portal/teacher/notices', { headers: t })).data.unread, 0, 'a message already read is not new in the bell');

  // the teacher replies; the student sees it as new
  assert.equal((await fromTeacher({ student_code: school.rahul, message: 'Yes: extra English practice from Monday.' })).status, 201);
  assert.equal((await fromTeacher({ student_code: 'STU-0099', message: 'Hello' })).status, 422);
  assert.equal((await fromTeacher({ student_code: school.rahul, message: '  ' })).status, 422);
  convs = (await call(env, 'GET', '/api/portal/student/messages', { headers: st })).data;
  assert.deepEqual(convs.conversations.map((c) => `${c.name}:${c.unread}:${c.last.from}`), ['Anita Negi:1:Teacher']);
  bell = (await call(env, 'GET', '/api/portal/student/notices', { headers: st })).data;
  assert.ok(bell.items.find((i) => i.kind === 'message' && i.text === 'Anita Negi wrote to you' && i.new));
  assert.ok(bell.items.find((i) => i.kind === 'marks' && i.sub === 'Physics, 42 out of 50'));
  const sThread = (await call(env, 'GET', `/api/portal/student/messages/${school.anita}`, { headers: st })).data;
  assert.deepEqual(sThread.messages.map((m) => `${m.from}:${m.mine}`), ['Student:true', 'Teacher:false']);
  assert.equal(sThread.with.name, 'Anita Negi');
  // a reply in the conversation needs no "about"
  assert.equal((await fromStudent({ teacher_code: school.anita, message: 'Thank you!' })).status, 201);
  await call(env, 'POST', '/api/portal/student/notices/seen', { headers: st, body: {} });
  assert.equal((await call(env, 'GET', '/api/portal/student/notices', { headers: st })).data.unread, 0);

  // the office bell: messages from students, and leave requests that wait for an answer
  let ob = (await call(env, 'GET', '/api/notices', { headers: office })).data;
  assert.ok(ob.items.find((i) => i.text === 'Complaint from Rahul Sharma to Anita Negi'));
  assert.equal((await call(env, 'GET', '/api/notices', { headers: t })).status, 401);
  await call(env, 'POST', '/api/portal/teacher/leave-requests', { headers: t, body: { client_id: ids().client_id, from: addDays(today, 3), reason: 'Sick' } });
  await call(env, 'POST', '/api/notices/seen', { headers: office, body: {} });
  ob = (await call(env, 'GET', '/api/notices', { headers: office })).data;
  const lr = ob.items.find((i) => i.kind === 'leave_request');
  assert.equal(lr.text, 'Anita Negi asked for leave');
  assert.equal(ob.unread, 1, 'a leave request still counts after the bell was opened');
  await call(env, 'POST', `/api/leave-requests/${lr.code}`, { headers: office, body: { action: 'approve' } });
  assert.equal((await call(env, 'GET', '/api/notices', { headers: office })).data.unread, 0);
  const tb = (await call(env, 'GET', '/api/portal/teacher/notices', { headers: t })).data;
  assert.ok(tb.items.find((i) => i.kind === 'leave' && i.text === 'Your leave was approved' && i.new));
  // a task the office gives a teacher
  await call(env, 'POST', '/api/tasks', { headers: office, body: { client_id: ids().client_id, title: 'Make the Class 9 test paper', owner: 'anita negi' } });
  assert.ok((await call(env, 'GET', '/api/portal/teacher/notices', { headers: t })).data.items.find((i) => i.kind === 'task' && /Class 9 test paper/.test(i.text)));

  // the office sees both directions, and the sheet says who sent each
  const sPage = (await call(env, 'GET', `/api/people/${school.rahul}`, { headers: office })).data;
  assert.deepEqual(sPage.entries.filter((e) => e.type === 'portal_message').map((e) => e.data.from).sort(), ['Student', 'Student', 'Teacher']);
  const schema = (await call(env, 'GET', '/api/sync?after=0', { headers: { authorization: `Bearer ${KEY}` } })).data.schema;
  const tab = schema.tabs.find((f) => f.type === 'portal_message');
  assert.ok(tab.columns.some((c) => c.label === 'Sent by'));
});
