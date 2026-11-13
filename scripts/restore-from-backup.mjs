// Puts entries, students, teachers and tasks from a Google Drive backup file back into the database.
// It only ADDS what is missing. It never changes or removes anything already there,
// so it is safe to run more than once.
//
//   npm run restore -- "SuccessPath database 2026-11-13 0200.json"            (makes restore.sql)
//   npm run restore -- "SuccessPath database 2026-11-13 0200.json" --run      (also loads it)
//   add --local to load it into the local test database instead of the live one

import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--'));
const run = args.includes('--run');
const local = args.includes('--local');

if (!file) {
  console.error('Tell me which backup file to use, for example:');
  console.error('  npm run restore -- "SuccessPath database 2026-11-13 0200.json"');
  process.exit(1);
}

let backup;
try {
  backup = JSON.parse(readFileSync(file, 'utf8'));
} catch (err) {
  console.error(`Could not read ${file}: ${err.message}`);
  process.exit(1);
}
if (!backup || !Array.isArray(backup.entries)) {
  console.error('This does not look like a SuccessPath database backup (no "entries" list).');
  process.exit(1);
}

const PEOPLE_COLUMNS = ['id', 'kind', 'seq', 'code', 'name', 'name_key', 'class', 'phone', 'status', 'details',
  'joined_on', 'left_on', 'created_from', 'created_at', 'updated_at'];
const ENTRY_COLUMNS = ['id', 'type', 'seq', 'code', 'status', 'entry_date', 'name', 'phone', 'amount', 'data',
  'client_id', 'person_id', 'created_at', 'updated_at', 'cancelled_at', 'cancel_reason'];
const TASK_COLUMNS = ['id', 'seq', 'code', 'title', 'notes', 'stage', 'due_on', 'owner', 'position', 'client_id',
  'created_at', 'updated_at', 'done_at'];

function sql(value) {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'NULL';
  if (typeof value === 'object') value = JSON.stringify(value);
  return `'${String(value).replace(/'/g, "''")}'`;
}

const people = Array.isArray(backup.people) ? backup.people : [];
const tasks = Array.isArray(backup.tasks) ? backup.tasks : [];
const lines = [
  ...people.map((p) => {
    const row = { ...p, details: p.details || {}, name_key: p.name_key || String(p.name || '').replace(/\s+/g, ' ').trim().toLowerCase() };
    return `INSERT OR IGNORE INTO people (${PEOPLE_COLUMNS.join(', ')}) VALUES (${PEOPLE_COLUMNS.map((c) => sql(row[c])).join(', ')});`;
  }),
  ...backup.entries.map((entry) => {
    const row = { ...entry, data: entry.data || {} };
    return `INSERT OR IGNORE INTO entries (${ENTRY_COLUMNS.join(', ')}) VALUES (${ENTRY_COLUMNS.map((c) => sql(row[c])).join(', ')});`;
  }),
  ...tasks.map((task) => `INSERT OR IGNORE INTO tasks (${TASK_COLUMNS.join(', ')}) VALUES (${TASK_COLUMNS.map((c) => sql(task[c])).join(', ')});`),
];
writeFileSync('restore.sql', `${lines.join('\n')}\n`);
console.log(`Wrote restore.sql with ${people.length} students and teachers, ${backup.entries.length} entries and ${tasks.length} tasks, from ${file}.`);

const command = ['wrangler', 'd1', 'execute', 'successpath-db', local ? '--local' : '--remote', '--file', 'restore.sql'];
if (!run) {
  console.log('\nTo put the missing ones back, run:');
  console.log(`  npx ${command.join(' ')}`);
  process.exit(0);
}
const result = spawnSync('npx', command, { stdio: 'inherit', shell: process.platform === 'win32' });
process.exit(result.status || 0);
