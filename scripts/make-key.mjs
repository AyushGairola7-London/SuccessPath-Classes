// Prints a new random sync key. The same key goes into Cloudflare and into the Google Sheet.
import { randomBytes } from 'node:crypto';

const key = randomBytes(24).toString('base64url');
console.log('\nYour new sync key (keep it private):\n');
console.log(`  ${key}\n`);
console.log('Next: run  npx wrangler secret put SYNC_KEY  and paste this key when asked.');
console.log('You will paste the same key into the Google Sheet later.\n');
