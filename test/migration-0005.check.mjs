// Applies 0001-0004 to a copy shaped like the live data, then 0005, and checks the result.
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
const dir = fileURLToPath(new URL('../migrations/', import.meta.url)); // works with spaces in the folder name
const db = new DatabaseSync(':memory:');
for (const f of ['0001_init.sql', '0002_people.sql', '0003_tasks.sql', '0004_teacher_enquiries.sql']) db.exec(readFileSync(dir + f, 'utf8'));
const person = db.prepare("INSERT INTO people (kind, seq, code, name, name_key, class, status) VALUES (?,?,?,?,?,?,?)");
person.run('student', 1, 'STU-0001', 'Kavya Negi', 'kavya negi', 'Class 7', 'Active');
person.run('student', 2, 'STU-0002', 'Rahul Sharma', 'rahul sharma', 'Class 9', 'Active');
person.run('student', 3, 'STU-0003', 'Rahul Sharma', 'rahul sharma', 'Class 6', 'Left');   // an old double
person.run('student', 4, 'STU-0004', 'Old Typo', 'old typo', null, 'Cancelled');
person.run('student', 5, 'STU-0005', 'Old Typo', 'old typo', null, 'Active');            // cancelled double is fine
person.run('teacher', 1, 'TR-0001', 'Anita Negi', 'anita negi', null, 'Active');
let n = 0;
const entry = (type, name, data, status = 'Active', phone = null) => {
  n += 1;
  db.prepare("INSERT INTO entries (type, seq, code, status, name, phone, data, client_id, entry_date) VALUES (?,?,?,?,?,?,?,?,?)")
    .run(type, n, `ENQ-${String(n).padStart(4, '0')}`, status, name, phone, JSON.stringify(data), `client-enq-${n}-aaaa`, '2026-11-10');
};
entry('enquiry', 'Kavya Negi', { class: 'Class 7' });                          // already a student: linked
entry('enquiry', 'Muskaan Rawat', { class: 'Class 5', parent_name: 'R. Rawat', school: 'DPS' }, 'Active', '9876500001');
entry('enquiry', 'muskaan rawat', { class: 'Class 5' });                       // same person again (names are saved with single spaces)
entry('enquiry', 'Dev', { class: 'Class 10', subjects: 'Maths' });
entry('enquiry', 'Cancelled One', { class: 'Class 3' }, 'Cancelled');           // cancelled: ignored
entry('enquiry', null, { class: 'Class 3' });                                  // no name: ignored
const before = db.prepare('SELECT COUNT(*) AS n FROM people_history').get().n;

db.exec(readFileSync(dir + '0005_demo_and_one_name.sql', 'utf8'));

const people = db.prepare('SELECT code, name, name_key, class, phone, status, details, created_from FROM people ORDER BY kind, seq').all();
const by = Object.fromEntries(people.map((p) => [p.code, p]));
assert.equal(by['STU-0002'].name, 'Rahul Sharma');
assert.equal(by['STU-0003'].name, 'Rahul Sharma (STU-0003)', 'the later double gets its ID in its name');
assert.equal(by['STU-0005'].name, 'Old Typo', 'a cancelled record does not count as a double');
assert.equal(by['STU-0006'].name, 'Muskaan Rawat');
assert.equal(by['STU-0006'].status, 'Enquiry');
assert.equal(by['STU-0006'].phone, '9876500001');
assert.deepEqual(JSON.parse(by['STU-0006'].details), { parent_name: 'R. Rawat', school: 'DPS' });
assert.equal(by['STU-0006'].created_from, 'ENQ-0002');
assert.equal(by['STU-0007'].name, 'Dev');
assert.deepEqual(JSON.parse(by['STU-0007'].details), { subjects: 'Maths' });
assert.equal(people.filter((p) => p.code.startsWith('STU')).length, 7, 'no record for the cancelled or nameless enquiry');
const links = db.prepare("SELECT e.code, p.code AS person FROM entries e LEFT JOIN people p ON p.id = e.person_id WHERE e.type = 'enquiry' ORDER BY e.id").all();
assert.deepEqual(links.map((l) => `${l.code}:${l.person}`), ['ENQ-0001:STU-0001', 'ENQ-0002:STU-0006', 'ENQ-0003:STU-0006', 'ENQ-0004:STU-0007', 'ENQ-0005:null', 'ENQ-0006:null']);
assert.ok(db.prepare('SELECT COUNT(*) AS n FROM people_history').get().n > before, 'the changes are in the history');
// the table was rebuilt: same ids, history kept, and Demo is allowed for students only
const ids = db.prepare("SELECT id, code FROM people WHERE code IN ('STU-0001', 'TR-0001') ORDER BY id").all();
assert.deepEqual(ids.map((r) => r.code), ['STU-0001', 'TR-0001']);
assert.equal(ids[0].id, 1);
db.prepare("UPDATE people SET status = 'Demo' WHERE code = 'STU-0007'").run();
assert.throws(() => db.prepare("UPDATE people SET status = 'Demo' WHERE code = 'TR-0001'").run(), /CHECK/);
assert.throws(() => db.prepare("UPDATE people SET status = 'Maybe' WHERE code = 'STU-0007'").run(), /CHECK/);
assert.throws(() => db.prepare("DELETE FROM people WHERE code = 'STU-0007'").run(), /cannot be deleted/);
assert.equal(db.prepare("SELECT COUNT(*) AS n FROM students").get().n, 7);
// the database refuses a second record with the same name, but a cancelled one may share it
assert.throws(() => person.run('student', 8, 'STU-0008', 'Dev', 'dev', null, 'Active'), /UNIQUE/);
person.run('student', 9, 'STU-0009', 'Dev', 'dev', null, 'Cancelled');
person.run('teacher', 2, 'TR-0002', 'Dev', 'dev', null, 'Active');
assert.throws(() => db.prepare("UPDATE people SET status = 'Active' WHERE code = 'STU-0009'").run(), /UNIQUE/);
// running it a second time changes nothing
const snapshot = JSON.stringify(db.prepare('SELECT * FROM people ORDER BY id').all());
db.exec(readFileSync(dir + '0005_demo_and_one_name.sql', 'utf8'));
assert.equal(JSON.stringify(db.prepare('SELECT * FROM people ORDER BY id').all()), snapshot);
console.log('migration 0005 checks passed');
