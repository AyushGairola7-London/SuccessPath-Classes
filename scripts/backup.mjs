// Downloads a complete copy of the live database (all tables, including the history)
// into the backups/ folder as an .sql file.
//
//   npm run backup

import { mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
const file = `backups/successpath-db-${stamp}.sql`;
mkdirSync('backups', { recursive: true });

console.log(`Downloading the database to ${file} ...`);
const result = spawnSync('npx', ['wrangler', 'd1', 'export', 'successpath-db', '--remote', '--output', file], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
});
if (result.status !== 0) {
  console.error('\nThe download did not finish. Check that you are logged in (npx wrangler login).');
  process.exit(result.status || 1);
}
console.log(`\nDone. Keep ${file} somewhere safe (it contains everyone's details).`);
