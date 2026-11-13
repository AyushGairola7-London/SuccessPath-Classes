// SuccessPath Classes: starts the page and decides which screen to show.
//
//   #/                     home: the entry buttons and what this device saved
//   #/new/fee              a form (add ?person=STU-0001 to fill it in for someone)
//   #/saved/<id>           the stamp after saving
//   #/students             the student list        #/students/STU-0001   one student
//   #/teachers             the teacher list        #/teachers/TR-0001    one teacher
//   #/tasks                the Tasks board and the exams coming up
//   #/analytics            numbers and charts
//
// The screens live in entry.js, people.js, tasks.js and analytics.js; the forms are described in forms.js.

import { getForm, PEOPLE } from './forms.js';
import { ui, updateStatus, outbox, closePanel } from './lib.js';
import { renderHome, renderForm, renderSaved, flushOutbox, saveDraftNow } from './entry.js';
import { renderPeopleList, renderPersonDetail, warmPeople } from './people.js';
import { renderTasks } from './tasks.js';
import { renderAnalytics } from './analytics.js';

const RETRY_EVERY_MS = 20000;

function route() {
  closePanel(false);
  const tip = document.querySelector('.tip');
  if (tip) tip.hidden = true;
  const [path, query] = location.hash.replace(/^#\/?/, '').split('?');
  const parts = path.split('/').map((p) => decodeURIComponent(p));
  const params = new URLSearchParams(query || '');

  if (parts[0] === 'new' && getForm(parts[1])) return renderForm(getForm(parts[1]), params.get('person'));
  if (parts[0] === 'saved' && parts[1]) return renderSaved(parts[1]);
  if (parts[0] === 'students' || parts[0] === 'teachers') {
    const kind = parts[0] === 'students' ? 'student' : 'teacher';
    if (parts[1] && PEOPLE[kind]) return renderPersonDetail(kind, parts[1]);
    return renderPeopleList(kind);
  }
  if (parts[0] === 'tasks') return renderTasks();
  if (parts[0] === 'analytics') return renderAnalytics();
  return renderHome();
}

// Redraws the screen after entries were sent in the background, without disturbing a form being typed.
function refresh() {
  updateStatus();
  if (ui.view === 'home') renderHome(true);
  if (ui.view === 'saved') route();
}

document.addEventListener('click', (e) => {
  const link = e.target.closest ? e.target.closest('a[data-replace]') : null;
  if (!link) return;
  e.preventDefault();
  location.replace(link.getAttribute('href'));
});

window.addEventListener('hashchange', route);
window.addEventListener('online', () => { updateStatus(); flushOutbox(refresh); warmPeople(); });
window.addEventListener('offline', updateStatus);
window.addEventListener('pagehide', saveDraftNow);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) saveDraftNow();
  else { flushOutbox(refresh); warmPeople(); }
});
setInterval(() => { if (outbox.all().length) flushOutbox(refresh); }, RETRY_EVERY_MS);

route();
flushOutbox(refresh);
warmPeople();

if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => { /* the page works without it */ });
  });
}
