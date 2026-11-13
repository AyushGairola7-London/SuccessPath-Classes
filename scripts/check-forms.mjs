// Checks public/forms.js for mistakes. Runs by itself before every `npm run deploy`.
import { checkForms, FORMS } from '../public/forms.js';

const problems = checkForms();
if (problems.length) {
  console.error('\nThe forms file (public/forms.js) has mistakes, so nothing was deployed:\n');
  for (const p of problems) console.error(`  - ${p}`);
  console.error('');
  process.exit(1);
}
console.log(`Forms look good (${FORMS.length} forms).`);
