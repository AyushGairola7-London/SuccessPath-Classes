// Puts entries from a Google Drive backup file back into the database.
// It only ADDS entries that are missing. It never changes or removes anything already there,
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

const COLUMNS = ['id', 'type', 'seq', 'code', 'status', 'entry_date', 'name', 'phone', 'amount', 'data',
  'client_id', 'created_at', 'updated_at', 'cancelled_at', 'cancel_reason'];

function sql(value) {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'NULL';
  if (typeof value === 'object') value = JSON.stringify(value);
  return `'${String(value).replace(/'/g, "''")}'`;
}

const lines = backup.entries.map((entry) => {
  const values = COLUMNS.map((c) => sql(c === 'data' ? entry.data || {} : entry[c]));
  return `INSERT OR IGNORE INTO entries (${COLUMNS.join(', ')}) VALUES (${values.join(', ')});`;
});
writeFileSync('restore.sql', `${lines.join('\n')}\n`);
console.log(`Wrote restore.sql with ${lines.length} entries from ${file}.`);

const command = ['wrangler', 'd1', 'execute', 'successpath-db', local ? '--local' : '--remote', '--file', 'restore.sql'];
if (!run) {
  console.log('\nTo put the missing entries back, run:');
  console.log(`  npx ${command.join(' ')}`);
  process.exit(0);
}
const result = spawnSync('npx', command, { stdio: 'inherit', shell: process.platform === 'win32' });
process.exit(result.status || 0);
