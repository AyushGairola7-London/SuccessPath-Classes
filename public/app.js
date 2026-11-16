// SuccessPath Classes: starts the page and decides which screen to show.
//
//   #/                     home: the entry buttons and what this device saved
//   #/new/fee              a form (add ?person=STU-0001 to fill it in for someone)
//   #/saved/<id>           the stamp after saving
//   #/students             the student list        #/students/STU-0001   one student
//   #/teachers             the teacher list        #/teachers/TR-0001    one teacher
//   #/students/STU-0001/edit   change a student's details (the same for teachers)
//   #/tasks                the Tasks board and the exams coming up
//   #/analytics            numbers and charts
//
// The screens live in entry.js, people.js, tasks.js and analytics.js; the forms are described in forms.js.
// Once an office password is set on the server, this app asks for it (login.js); the teacher and
// student portals are separate pages (/teacher and /student, portal.js).

import { getForm, PEOPLE } from './forms.js';
import { ui, updateStatus, outbox, closePanel } from './lib.js';
import { renderHome, renderForm, renderSaved, flushOutbox, saveDraftNow } from './entry.js';
import { renderPeopleList, renderPersonDetail, warmPeople, leaveDecided } from './people.js';
import { renderTasks } from './tasks.js';
import { renderPersonEdit } from './edit.js';
import { renderAnalytics } from './analytics.js';
import { renderLogin, checkSession } from './login.js';
import { setNotices, resetNotices, setTabBadge, getJson, postJson } from './lib.js';
import { decideLeave } from './leave.js';

const RETRY_EVERY_MS = 20000;
const auth = { needed: false };

// The server asked for the office login (a new phone, or the password was changed).
function showLogin(message) {
  auth.needed = true;
  if (ui.view === 'login') return;
  closePanel(false);
  renderLogin('admin', () => {
    auth.needed = false;
    ui.logins = true;
    startBell();
    route();
    flushOutbox(refresh);
    warmPeople();
  }, message);
}

window.addEventListener('sp:login', (e) => {
  if (e.detail === 'admin') showLogin('Please log in to keep going. Anything saved on this phone is kept and sent after you log in.');
});

function route() {
  if (auth.needed) return showLogin();
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
    if (parts[1] && parts[2] === 'edit') return renderPersonEdit(kind, parts[1]);
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
window.addEventListener('online', () => { updateStatus(); if (!auth.needed) { flushOutbox(refresh); warmPeople(); } });
window.addEventListener('offline', updateStatus);
window.addEventListener('pagehide', saveDraftNow);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) saveDraftNow();
  else if (!auth.needed) { flushOutbox(refresh); warmPeople(); }
});
setInterval(() => { if (outbox.all().length && !auth.needed) flushOutbox(refresh); }, RETRY_EVERY_MS);
window.addEventListener('sp:logout', () => { resetNotices(); showLogin(); });
window.addEventListener('sp:leave-decided', leaveDecided);

// The bell: leave requests from teachers (approve or decline them there), messages from students,
// exam dates added by students. The Teachers tab shows how many leave requests wait.
function startBell() {
  setNotices({
    load: async () => {
      const data = await getJson('/api/notices');
      setTabBadge('teachers', data.items.filter((it) => it.kind === 'leave_request').length);
      return data;
    },
    seen: () => postJson('/api/notices/seen', {}),
    act: (item, action) => decideLeave(item.code, action, item.text.replace(' asked for leave', '')),
  });
}

route();
checkSession('admin').then((s) => {
  ui.logins = Boolean(s && s.logins);
  if (s && s.logins && !s.signed_in) { showLogin(); return; }
  startBell();
  if (ui.view === 'home') renderHome(true);
  flushOutbox(refresh);
  warmPeople();
});

if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => { /* the page works without it */ });
  });
}
