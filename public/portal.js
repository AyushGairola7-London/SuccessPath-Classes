// SuccessPath Classes: the teacher portal (/teacher) and the student portal (/student).
//
// Teacher portal                          Student portal
//   #/             their students, exams     #/              their details, marks, exam dates, teachers
//   #/students/STU-0001  one student         #/messages      conversations with teachers
//   #/messages     conversations             #/messages/TR-0001  one conversation
//   #/messages/STU-0001  one conversation    #/messages/new  write to a teacher
//   #/messages/new write to a student        #/exam          add an exam date
//   #/leave        leave, requests, calendar
//   #/leave/new    ask for leave
//   #/tasks        the shared Tasks board
//   #/me           their details
//
// The server decides what each login may see; these pages only show it. No phone numbers,
// addresses, fees or salaries are sent to the portals.

import { APP_NAME, MESSAGE_KINDS } from './forms.js';
import {
  app, ui, esc, icon, getJson, postJson, newId, topBar, tabBar, setTabs, setApiRole, toast, shortDate, initials,
  setNotices, refreshNotices, resetNotices, setTabBadge, whenSaved,
} from './lib.js';
import { renderLogin, checkSession, logOut } from './login.js';
import { renderTasks } from './tasks.js';
import { renderLeaveCalendar } from './calendar.js';
import { historyList, marksRow, examRow, examOrder, examEnd, percent, testName } from './people.js';
import { fieldHtml, collectValues, showErrors, clearFieldError } from './entry.js';

const ROLE = document.body.dataset.role === 'student' ? 'student' : 'teacher';
const NAME = ROLE === 'teacher' ? 'Teacher portal' : 'Student portal';
setApiRole(ROLE);
setTabs(ROLE === 'teacher'
  ? [['students', '#/', 'Students', 'students'], ['messages', '#/messages', 'Messages', 'message'],
    ['leave', '#/leave', 'Leave', 'leave'], ['tasks', '#/tasks', 'Tasks', 'tasks'], ['me', '#/me', 'Me', 'me']]
  : [['home', '#/', 'My page', 'me'], ['messages', '#/messages', 'Messages', 'message']]);

const auth = { needed: false, closed: false };
const view = { show: 'mine', q: '', examShow: 'mine' };
let home = null; // the student portal's page, kept for the forms

/* ---------------- Logging in ---------------- */

function showLogin(message) {
  auth.needed = true;
  if (ui.view === 'login') return;
  renderLogin(ROLE, () => {
    auth.needed = false;
    home = null;
    startBell();
    route();
  }, message);
}

// The bell at the top, and the number of unread messages on the Messages tab.
let bellOn = false;
function startBell() {
  if (bellOn) { refreshNotices(); return; }
  bellOn = true;
  setNotices({
    load: async () => {
      const [n, m] = await Promise.all([getJson(`/api/portal/${ROLE}/notices`), getJson(`/api/portal/${ROLE}/messages`)]);
      setTabBadge('messages', m.unread);
      return n;
    },
    seen: () => postJson(`/api/portal/${ROLE}/notices/seen`, {}),
  });
}

window.addEventListener('sp:login', (e) => {
  if (e.detail === ROLE) showLogin('Please log in again.');
});

function renderClosed() {
  ui.view = 'closed';
  document.title = `${NAME} | ${APP_NAME}`;
  app.innerHTML = `
    <main class="login">
      <div class="login-card">
        <p class="login-org">${esc(APP_NAME)}</p>
        <h1 class="login-title">${esc(NAME)}</h1>
        <p class="login-lead">The ${ROLE === 'teacher' ? 'teacher' : 'student'} portal is not open yet. Please ask the office.</p>
      </div>
    </main>`;
}

/* ---------------- Screens ---------------- */

function route() {
  if (auth.closed) return renderClosed();
  if (auth.needed) return showLogin();
  const [path, query] = location.hash.replace(/^#\/?/, '').split('?');
  const parts = path.split('/').map((p) => decodeURIComponent(p));
  const params = new URLSearchParams(query || '');
  if (parts[0] === 'messages' && parts[1] === 'new') return newMessagePage(params.get(ROLE === 'teacher' ? 'student' : 'teacher'));
  if (parts[0] === 'messages' && parts[1]) return threadPage(parts[1]);
  if (parts[0] === 'messages') return messagesPage();
  if (ROLE === 'teacher') {
    if (parts[0] === 'students' && parts[1]) return studentPage(parts[1]);
    if (parts[0] === 'enquiries') { location.replace('#/messages'); return undefined; }
    if (parts[0] === 'leave' && parts[1] === 'new') return leaveRequestPage(params.get('from'));
    if (parts[0] === 'leave') return leavePage();
    if (parts[0] === 'tasks') return renderTasks();
    if (parts[0] === 'me') return teacherMe();
    return studentsPage();
  }
  if (parts[0] === 'send') { location.replace(`#/messages/new${params.get('teacher') ? `?teacher=${encodeURIComponent(params.get('teacher'))}` : ''}`); return undefined; }
  if (parts[0] === 'sent') { location.replace('#/messages'); return undefined; }
  if (parts[0] === 'exam') return examPage();
  return studentHome();
}

/** Draws a screen with a loading line, then fills it from the server. */
async function screen(key, title, tab, url, draw, back) {
  ui.view = key;
  ui.form = null;
  document.title = `${title} | ${NAME}`;
  app.innerHTML = `${topBar(title, back)}<main class="portal-page with-tabs"><p class="list-note">Loading…</p></main>${tabBar(tab)}`;
  let data;
  try {
    data = await getJson(url);
  } catch (err) {
    if (ui.view !== key || auth.needed) return;
    app.querySelector('main').innerHTML = `
      <p class="empty">${esc(err.message)}</p>
      <button class="btn btn-quiet" type="button" data-retry>Try again</button>`;
    app.querySelector('[data-retry]').addEventListener('click', route);
    return;
  }
  if (ui.view !== key) return;
  const main = app.querySelector('main');
  main.innerHTML = draw(data);
  return { main, data };
}

function filterButtons(name, current, labels) {
  return `
    <div class="segmented" role="group" aria-label="${esc(name)}">
      ${Object.entries(labels).map(([value, label]) => `<button type="button" data-show="${value}" aria-pressed="${current === value}">${esc(label)}</button>`).join('')}
    </div>`;
}

function examDates(x) {
  const start = x.starts_on || x.entry_date;
  const end = x.ends_on || (x.data && x.data.ends_on);
  if (!start) return 'No date';
  return end && end !== start ? `${shortDate(start)} to ${shortDate(end)}` : shortDate(start);
}

/* ---------------- Teacher: students ---------------- */

async function studentsPage() {
  const shown = await screen('students', 'Students', 'students', '/api/portal/teacher/students', (data) => `
    <div class="list-tools">
      <label class="search">${icon('search')}<input type="search" placeholder="Search" aria-label="Search students" value="${esc(view.q)}" data-q></label>
      <div class="filters">${filterButtons('Which students', view.show, { mine: 'My students', all: 'All' })}</div>
    </div>
    <details class="exam-box" data-exams hidden><summary></summary><div data-exam-list></div></details>
    <p class="list-note" data-note></p>
    <ul class="people" data-list></ul>
    ${data.classes_taught.length ? '' : '<p class="list-note">The office has not written your classes on your record yet, so every student is under All.</p>'}`);
  if (!shown) return;
  const { main, data } = shown;
  let exams = null;
  getJson('/api/portal/teacher/enquiries').then((d) => { exams = d.exams; if (ui.view === 'students') draw(); }).catch(() => {});
  if (!data.classes_taught.length && view.show === 'mine' && !view.touched) view.show = 'all';
  const draw = () => {
    for (const b of main.querySelectorAll('[data-show]')) b.setAttribute('aria-pressed', String(b.getAttribute('data-show') === view.show));
    const q = view.q.trim().toLowerCase();
    const rows = data.people
      .filter((p) => view.show === 'all' || p.mine)
      .filter((p) => !q || p.name.toLowerCase().includes(q) || String(p.class || '').toLowerCase().includes(q));
    main.querySelector('[data-note]').textContent = view.show === 'mine'
      ? `${rows.length} of your students${data.classes_taught.length ? ` (${data.classes_taught.join(', ')})` : ''}`
      : `${rows.length} ${rows.length === 1 ? 'student' : 'students'}`;
    const box = main.querySelector('[data-exams]');
    const coming = (exams || []).filter((x) => (view.show === 'all' || x.mine) && (x.ends_on || x.starts_on) >= data.today);
    box.hidden = !coming.length;
    if (coming.length) {
      box.querySelector('summary').textContent = `Exam dates coming up (${coming.length})`;
      box.querySelector('[data-exam-list]').innerHTML = `<ul class="history">${coming.slice(0, 30).map(examLine).join('')}</ul>`;
    }
    main.querySelector('[data-list]').innerHTML = rows.length ? rows.map((p) => `
      <li>
        <a class="person-row" href="#/students/${esc(p.code)}">
          <span class="avatar" aria-hidden="true">${esc(initials(p.name))}</span>
          <span class="person-main">
            <span class="person-name">${esc(p.name)}</span>
            <span class="person-sub">${esc([p.class, p.school].filter(Boolean).join(', ') || p.code)}</span>
          </span>
          ${p.last_percent !== null && p.last_percent !== undefined ? `<span class="badge badge--info">Last test ${esc(p.last_percent)}%</span>` : ''}
          <span class="row-chevron">${icon('chevron')}</span>
        </a>
      </li>`).join('') : '<li class="empty">No students here.</li>';
  };
  main.addEventListener('click', (e) => {
    const b = e.target.closest('[data-show]');
    if (!b) return;
    view.show = b.getAttribute('data-show');
    view.touched = true;
    draw();
  });
  main.querySelector('[data-q]').addEventListener('input', (e) => { view.q = e.target.value; draw(); });
  draw();
}

async function studentPage(code) {
  await screen('student', 'Student', 'students', `/api/portal/teacher/students/${encodeURIComponent(code)}`, (data) => {
    const s = data.student;
    document.title = `${s.name} | ${NAME}`;
    app.querySelector('.bar-title').textContent = s.name;
    const marks = data.marks;
    const exams = examOrder([...data.exams, ...data.class_exams.map((e) => ({ ...e, forClass: true }))]);
    const lastMark = marks.find((e) => percent(e) !== null);
    const nextExam = exams.find((e) => examEnd(e) >= data.today);
    return `
      <section class="profile">
        <div class="profile-top">
          <span class="avatar avatar--big" aria-hidden="true">${esc(initials(s.name))}</span>
          <div class="profile-who">
            <h2 class="profile-name">${esc(s.name)}</h2>
            <p class="profile-sub">${esc([s.code, s.class].filter(Boolean).join(', '))} ${s.mine ? '<span class="badge badge--ok">Your student</span>' : ''}</p>
          </div>
        </div>
        <dl class="facts">${[['School', s.school], ['Subjects or batch', s.subjects], ['Enrollment number', s.enrollment_no], ['Joined', shortDate(s.joined_on)]]
          .filter(([, v]) => v).map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>
      </section>
      <section class="block" aria-labelledby="marks-title">
        <h3 class="block-title" id="marks-title">Marks</h3>
        <p class="block-sum">${lastMark ? `Last test: ${percent(lastMark)}% in ${esc(testName(lastMark))}.` : 'No marks yet.'}</p>
        ${historyList(marks, marksRow)}
      </section>
      <section class="block" aria-labelledby="exams-title">
        <h3 class="block-title" id="exams-title">Exam dates</h3>
        <p class="block-sum">${nextExam ? `Next: ${esc(nextExam.data.exam || 'exam')}, ${esc(examDates(nextExam))}.` : exams.length ? 'No exams coming up.' : 'No exam dates yet.'}</p>
        ${historyList(exams, examRow)}
      </section>
      <section class="block" aria-labelledby="msg-title">
        <h3 class="block-title" id="msg-title">Messages</h3>
        ${data.messages.length ? messageList(data.messages.slice(0, 3), 'teacher') : '<p class="block-sum">No messages with this student yet.</p>'}
        <a class="btn btn-quiet block-btn" href="#/messages/${esc(s.code)}">${icon('message')}<span>${data.messages.length ? `All messages with ${esc(s.name.split(' ')[0])}` : `Write to ${esc(s.name.split(' ')[0])}`}</span></a>
      </section>`;
  }, '#/');
}

function messageList(messages, side) {
  const sorted = [...messages].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  return `<ul class="history messages">${sorted.map((m) => `
    <li class="h-row">
      <span class="h-date">${esc(shortDate(m.entry_date || String(m.created_at).slice(0, 10)))}</span>
      <span class="h-main">${m.from === 'Teacher'
          ? '<strong>You wrote</strong>'
          : `<span class="badge badge--about">${esc(m.about || 'Message')}</span> from ${esc(m.student_name || 'the student')}`}</span>
      <span class="h-sub h-note">${esc(m.message || '')}</span>
    </li>`).join('')}</ul>`;
}

function examLine(x) {
  return `
    <li class="h-row">
      <span class="h-date">${esc(examDates(x))}</span>
      <span class="h-main"><strong>${esc(x.exam || 'Exam')}</strong>, ${x.student_name
        ? (x.person_code ? `<a href="#/students/${esc(x.person_code)}">${esc(x.student_name)}</a>` : esc(x.student_name))
        : `all of ${esc(x.class || 'the class')}`}${x.class && x.student_name ? `, ${esc(x.class)}` : ''}${x.school ? ` (${esc(x.school)})` : ''}</span>
      ${x.subjects ? `<span class="h-sub h-note">${esc(x.subjects)}</span>` : ''}
      ${x.added_by ? '<span class="h-sub">Added by the student</span>' : ''}
    </li>`;
}

/* ---------------- Messages: conversations between a teacher and a student ---------------- */

function messageTime(m) {
  return whenSaved(m.at);
}

// For the list of conversations: the time if it was today, else "Yesterday" or the day.
function convoWhen(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
  if (d.toDateString() === new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1).toDateString()) return 'Yesterday';
  return whenSaved(iso).replace(/, .*$/, '');
}

async function messagesPage() {
  const shown = await screen('messages', 'Messages', 'messages', `/api/portal/${ROLE}/messages`, (data) => {
    setTabBadge('messages', data.unread);
    const list = data.conversations;
    return `
      <div class="quick-actions"><a class="btn btn-primary" href="#/messages/new">${icon('send')}<span>New message</span></a></div>
      <p class="list-note">${list.length
        ? `${data.unread ? `${data.unread} new. ` : ''}Tap a name to read everything sent and received.`
        : ROLE === 'teacher' ? 'No messages yet. Students can write to you from their portal, and you can write to them.'
          : 'No messages yet. Write to a teacher about a topic, a complaint, notes or anything you need.'}</p>
      <ul class="people convos">${list.map((c) => `
        <li>
          <a class="person-row convo${c.unread ? ' is-unread' : ''}" href="#/messages/${esc(c.code)}">
            <span class="avatar" aria-hidden="true">${esc(initials(c.name))}</span>
            <span class="person-main">
              <span class="person-name">${esc(c.name)}${c.class ? `<span class="convo-class">, ${esc(c.class)}</span>` : ''}</span>
              <span class="person-sub convo-last">${c.last.mine ? 'You: ' : ''}${c.last.about && !c.last.mine ? `${esc(c.last.about)}: ` : ''}${esc(c.last.message || '')}</span>
            </span>
            <span class="convo-side">
              <span class="convo-when">${esc(convoWhen(c.last.at))}</span>
              ${c.unread ? `<span class="convo-unread" aria-label="${c.unread} new">${c.unread}</span>` : ''}
            </span>
          </a>
        </li>`).join('')}</ul>`;
  });
  return shown;
}

async function threadPage(code) {
  const shown = await screen('thread', 'Messages', 'messages', `/api/portal/${ROLE}/messages/${encodeURIComponent(code)}`, (data) => {
    const w = data.with;
    app.querySelector('.bar-title').textContent = w.name;
    document.title = `${w.name} | ${NAME}`;
    const sub = ROLE === 'teacher'
      ? `${[w.class, w.code].filter(Boolean).join(', ')}${w.active ? ` · <a href="#/students/${esc(w.code)}">Marks and exam dates</a>` : ' · has left'}`
      : esc(w.subjects || 'Teacher');
    return `
      <p class="chat-with">${sub}</p>
      ${data.messages.length ? '' : `<p class="list-note">No messages yet. Write the first one below.</p>`}
      <ol class="chat">${data.messages.map((m) => `
        <li class="msg ${m.mine ? 'msg--out' : 'msg--in'}">
          ${m.about ? `<span class="msg-about">${esc(m.about)}</span>` : ''}
          <p class="msg-text">${esc(m.message || '')}</p>
          <span class="msg-meta">${m.mine ? 'You' : esc(ROLE === 'teacher' ? m.student_name : m.teacher_name)}, ${esc(messageTime(m))}</span>
        </li>`).join('')}</ol>
      ${w.active ? `
      <form class="chat-reply" novalidate autocomplete="off">
        ${ROLE === 'student' ? `
        <details class="chat-about">
          <summary>Say what it is about (optional)</summary>
          ${fieldHtml({ key: 'about', label: 'About', kind: 'choice', options: data.kinds || MESSAGE_KINDS }, '')}
        </details>` : ''}
        <div class="field" data-field="message">
          <label class="label" for="f-message">Write a reply</label>
          <textarea id="f-message" name="message" rows="3" maxlength="1000" aria-describedby="f-message-err"></textarea>
          <p class="field-error" id="f-message-err" hidden></p>
        </div>
        <p class="form-error" role="alert" hidden></p>
        <button class="btn btn-primary" type="submit">${icon('send')}<span>Send</span></button>
      </form>` : `<p class="list-note">${ROLE === 'teacher' ? 'This student has left, so new messages cannot be sent.' : 'This teacher no longer teaches here.'}</p>`}`;
  }, '#/messages');
  if (!shown) return;
  setTimeout(refreshNotices, 300); // the conversation is read now: the bell and the tab badge catch up
  const { main } = shown;
  if (main.querySelectorAll('.chat .msg').length > 2) window.scrollTo(0, document.documentElement.scrollHeight);
  const formEl = main.querySelector('.chat-reply');
  if (!formEl) return;
  wireEdits(formEl);
  let clientId = newId();
  formEl.addEventListener('submit', async (e) => {
    e.preventDefault();
    const message = formEl.elements.namedItem('message').value;
    const aboutEl = formEl.querySelector('input[name="about"]:checked');
    const body = ROLE === 'teacher'
      ? { client_id: clientId, student_code: code, message }
      : { client_id: clientId, teacher_code: code, about: aboutEl ? aboutEl.value : undefined, message };
    await submitPortal(formEl, `/api/portal/${ROLE}/messages`, body, () => {
      clientId = newId();
      threadPage(code);
    });
  });
}

async function newMessagePage(preset) {
  ui.view = 'new-message';
  ui.form = null;
  document.title = `New message | ${NAME}`;
  app.innerHTML = `${topBar('New message', '#/messages')}<main class="paper with-tabs"><p class="list-note">Loading…</p></main>${tabBar('messages')}`;
  let people;
  try {
    if (ROLE === 'teacher') people = (await getJson('/api/portal/teacher/students')).people;
    else people = (home || await loadHome()).teachers;
  } catch (err) {
    if (ui.view !== 'new-message' || auth.needed) return;
    app.querySelector('main').innerHTML = `<p class="empty">${esc(err.message)}</p>`;
    return;
  }
  if (ui.view !== 'new-message') return;
  const mine = people.filter((p) => p.mine);
  const others = people.filter((p) => !p.mine);
  const option = (p) => `<option value="${esc(p.code)}"${p.code === preset ? ' selected' : ''}>${esc(p.name)}${ROLE === 'teacher' ? (p.class ? `, ${esc(p.class)}` : '') : (p.subjects ? `, ${esc(p.subjects)}` : '')}</option>`;
  const key = ROLE === 'teacher' ? 'student_code' : 'teacher_code';
  const groups = ROLE === 'teacher'
    ? [['Your students', mine], [mine.length ? 'Other students' : 'Students', others]]
    : [['Teachers of your class', mine], [mine.length ? 'Other teachers' : 'Teachers', others]];
  app.querySelector('main').innerHTML = `
    <form class="entry" novalidate autocomplete="off">
      <div class="entry-lines" style="--tile:#0E7490">
        <p class="hint">${ROLE === 'teacher' ? 'Only this student sees your message. The office can see it too.' : 'Only the teacher you choose sees your message. The office can see it too.'}</p>
        <div class="field" data-field="${key}">
          <label class="label" for="f-${key}">${ROLE === 'teacher' ? 'To student' : 'To teacher'}</label>
          <select id="f-${key}" name="${key}" aria-describedby="f-${key}-err">
            <option value="">Choose</option>
            ${groups.filter(([, list]) => list.length).map(([label, list]) => `<optgroup label="${esc(label)}">${list.map(option).join('')}</optgroup>`).join('')}
          </select>
          <p class="field-error" id="f-${key}-err" hidden></p>
        </div>
        ${ROLE === 'student' ? fieldHtml({ key: 'about', label: 'What is it about?', kind: 'choice', options: MESSAGE_KINDS }, '') : ''}
        ${fieldHtml({ key: 'message', label: 'Your message', kind: 'textarea', placeholder: ROLE === 'teacher' ? 'For example: please bring your notebook on Monday.' : 'For example: please explain refraction again before the test.' }, '')}
      </div>
      <div class="actions">
        <p class="form-error" role="alert" hidden></p>
        <button class="btn btn-primary" type="submit">Send message</button>
      </div>
    </form>`;
  const formEl = app.querySelector('form');
  wireEdits(formEl);
  const clientId = newId();
  formEl.addEventListener('submit', async (e) => {
    e.preventDefault();
    const to = formEl.elements.namedItem(key).value;
    const aboutEl = formEl.querySelector('input[name="about"]:checked');
    const body = { client_id: clientId, [key]: to, message: formEl.elements.namedItem('message').value };
    if (ROLE === 'student' && aboutEl) body.about = aboutEl.value;
    await submitPortal(formEl, `/api/portal/${ROLE}/messages`, body, () => {
      const p = people.find((x) => x.code === to);
      toast(`Sent to ${p ? p.name : 'them'}.`);
      location.hash = `#/messages/${to}`;
    });
  });
}

/** Clears a field's error as it is changed, and the message above the button once none are left. */
function wireEdits(formEl) {
  const edited = (e) => {
    clearFieldError(e.target);
    const box = formEl.querySelector('.form-error');
    if (box && !formEl.querySelector('.has-error')) box.hidden = true;
  };
  formEl.addEventListener('input', edited);
  formEl.addEventListener('change', edited);
}

/** Sends a portal form; shows the server's field errors, or runs `done` after saving. */
async function submitPortal(formEl, url, body, done) {
  const box = formEl.querySelector('.form-error');
  box.hidden = true;
  const button = formEl.querySelector('button[type="submit"]');
  button.disabled = true;
  const label = button.innerHTML;
  button.textContent = 'Sending…';
  let res;
  try {
    res = await postJson(url, body);
  } catch (err) {
    res = { status: 0, data: { error: 'No internet connection. Nothing was sent. Try again when you are online.' } };
  }
  button.disabled = false;
  button.innerHTML = label;
  if ((res.status === 200 || res.status === 201) && res.data && res.data.ok) {
    done(res);
    return;
  }
  if (res.status === 401) return; // the login screen takes over
  box.textContent = (res.data && res.data.error) || 'That did not work. Please try again.';
  box.hidden = false;
  showErrors(formEl, (res.data && res.data.fields) || {});
}

/* ---------------- Teacher: leave ---------------- */

const STATUS_TEXT = { Pending: 'Waiting for the office', Approved: 'Approved', Declined: 'Declined', Withdrawn: 'Withdrawn' };
const STATUS_BADGE = { Pending: 'badge--due', Approved: 'badge--ok', Declined: 'badge--muted', Withdrawn: 'badge--muted' };

function spanText(from, to) {
  return to && to !== from ? `${shortDate(from)} to ${shortDate(to)}` : shortDate(from);
}

async function leavePage() {
  const shown = await screen('leave', 'Leave', 'leave', '/api/portal/teacher/leave', (data) => {
    const open = data.requests.filter((r) => r.status === 'Pending');
    const past = data.requests.filter((r) => r.status !== 'Pending').slice(0, 10);
    const requestRow = (r) => `
      <li class="h-row">
        <span class="h-date">${esc(spanText(r.from, r.to))}</span>
        <span class="h-main"><strong>${esc(r.reason || 'Leave')}</strong> <span class="badge ${STATUS_BADGE[r.status]}">${esc(STATUS_TEXT[r.status])}</span></span>
        ${r.notes ? `<span class="h-sub h-note">${esc(r.notes)}</span>` : ''}
        ${r.decision_note ? `<span class="h-sub">The office: ${esc(r.decision_note)}</span>` : ''}
        <span class="h-sub">${esc(r.code)}, asked ${esc(whenSaved(r.created_at))}</span>
        ${r.status === 'Pending' ? `<button type="button" class="linkish withdraw" data-withdraw="${esc(r.code)}">Withdraw this request</button>` : ''}
      </li>`;
    return `
      <div class="quick-actions"><a class="btn btn-primary" href="#/leave/new">${icon('leave')}<span>Request leave</span></a></div>
      <section class="block" aria-labelledby="mine-title">
        <h3 class="block-title" id="mine-title">My leave</h3>
        ${data.leave.length ? `<ul class="history">${data.leave.map((l) => `
          <li class="h-row"><span class="h-date">${esc(spanText(l.from, l.to))}</span>
            <span class="h-main"><strong>${esc(l.reason || 'Leave')}</strong> <span class="badge badge--ok">${l.request_code ? 'Approved' : 'Booked by the office'}</span></span></li>`).join('')}</ul>`
          : '<p class="block-sum">No leave coming up.</p>'}
      </section>
      ${open.length ? `
      <section class="block" aria-labelledby="open-title">
        <h3 class="block-title" id="open-title">Waiting for the office</h3>
        <ul class="history">${open.map(requestRow).join('')}</ul>
      </section>` : ''}
      <section class="cal" data-calendar aria-labelledby="cal-title"></section>
      ${past.length ? `
      <section class="block" aria-labelledby="past-title">
        <h3 class="block-title" id="past-title">Earlier requests</h3>
        <ul class="history">${past.map(requestRow).join('')}</ul>
      </section>` : ''}
      <section class="block" aria-labelledby="hol-title">
        <h3 class="block-title" id="hol-title">Holidays</h3>
        ${data.holidays.length ? `<ul class="history">${data.holidays.map((h) => `
          <li class="h-row"><span class="h-date">${esc(spanText(h.from, h.to))}</span>
            <span class="h-main"><strong>${esc(h.name || 'Holiday')}</strong></span></li>`).join('')}</ul>`
          : '<p class="block-sum">No holidays coming up.</p>'}
      </section>`;
  });
  if (!shown) return;
  const { main } = shown;
  renderLeaveCalendar(main.querySelector('[data-calendar]'), { mode: 'teacher' });
  main.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-withdraw]');
    if (!b) return;
    if (b.dataset.armed !== '1') {
      b.dataset.armed = '1';
      b.textContent = 'Tap again to withdraw';
      setTimeout(() => { if (document.contains(b)) { b.dataset.armed = ''; b.textContent = 'Withdraw this request'; } }, 4000);
      return;
    }
    b.disabled = true;
    const res = await postJson(`/api/portal/teacher/leave-requests/${b.getAttribute('data-withdraw')}/withdraw`, {}).catch(() => null);
    if (res && res.status === 200) toast('Request withdrawn.');
    else toast((res && res.data && res.data.error) || 'That did not work. Please try again.');
    leavePage();
  });
}

async function leaveRequestPage(from) {
  ui.view = 'leave-new';
  ui.form = null;
  document.title = `Request leave | ${NAME}`;
  app.innerHTML = `${topBar('Request leave', '#/leave')}<main class="paper with-tabs"><p class="list-note">Loading…</p></main>${tabBar('leave')}`;
  let data;
  try {
    data = await getJson('/api/portal/teacher/leave');
  } catch (err) {
    if (ui.view !== 'leave-new' || auth.needed) return;
    app.querySelector('main').innerHTML = `<p class="empty">${esc(err.message)}</p>`;
    return;
  }
  if (ui.view !== 'leave-new') return;
  const start = from && from >= data.today ? from : data.today;
  const form = {
    fields: [
      { key: 'from', label: 'First day of leave', kind: 'date' },
      { key: 'to', label: 'Last day of leave', kind: 'date', hint: 'Leave empty if it is one day.' },
      { key: 'reason', label: 'Reason', kind: 'choice', options: data.reasons },
      { key: 'notes', label: 'Anything the office should know', kind: 'textarea', placeholder: 'For example: I will set work for my classes.' },
    ],
  };
  app.querySelector('main').innerHTML = `
    <form class="entry" novalidate autocomplete="off">
      <div class="entry-lines" style="--tile:#9A3F7A">
        <p class="hint">The office sees your request straight away and approves or declines it. You can follow it under Leave.</p>
        ${form.fields.map((f) => fieldHtml(f, f.key === 'from' ? start : '')).join('')}
      </div>
      <div class="actions">
        <p class="form-error" role="alert" hidden></p>
        <button class="btn btn-primary" type="submit">Send request</button>
      </div>
    </form>`;
  const formEl = app.querySelector('form');
  formEl.querySelector('#f-from').min = data.today;
  formEl.querySelector('#f-to').min = data.today;
  wireEdits(formEl);
  const clientId = newId();
  formEl.addEventListener('submit', async (e) => {
    e.preventDefault();
    const values = collectValues(form, formEl);
    await submitPortal(formEl, '/api/portal/teacher/leave-requests', { client_id: clientId, ...values }, () => {
      toast('Leave requested. The office has been told.');
      location.hash = '#/leave';
    });
  });
}

/* ---------------- Teacher: their own details ---------------- */

async function teacherMe() {
  const shown = await screen('me', 'Me', 'me', '/api/portal/teacher', (data) => {
    const m = data.me;
    return `
      <section class="profile">
        <div class="profile-top">
          <span class="avatar avatar--big" aria-hidden="true">${esc(initials(m.name))}</span>
          <div class="profile-who">
            <h2 class="profile-name">${esc(m.name)}</h2>
            <p class="profile-sub">${esc(m.code)}</p>
          </div>
        </div>
        <dl class="facts">${[['Username', m.username], ['Subjects', m.subjects], ['Classes', m.classes],
          ['My students', m.classes_taught.join(', ')], ['Qualification', m.qualification], ['Experience', m.experience],
          ['Joined', shortDate(m.joined_on)]]
          .filter(([, v]) => v).map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>
        <p class="block-sum">To change these details, please tell the office.</p>
      </section>
      <p class="list-note">Your leave, leave requests and the holidays are under Leave.</p>
      <button class="btn btn-quiet logout" type="button" data-logout>Log out of this phone</button>`;
  });
  if (shown) wireLogout(shown.main);
}

function wireLogout(main) {
  const b = main.querySelector('[data-logout]');
  if (!b) return;
  b.addEventListener('click', async () => {
    b.disabled = true;
    await logOut(ROLE);
    resetNotices();
    showLogin();
  });
}

/* ---------------- Student: their page ---------------- */

async function loadHome() {
  home = await getJson('/api/portal/student');
  return home;
}

async function studentHome() {
  const shown = await screen('home', 'My page', 'home', '/api/portal/student', (data) => {
    home = data;
    const m = data.me;
    const exams = examOrder([...data.exams, ...data.class_exams.map((e) => ({ ...e, forClass: true }))]);
    const nextExam = exams.find((e) => examEnd(e) >= data.today);
    const lastMark = data.marks.find((e) => percent(e) !== null);
    const teachers = [...data.teachers].sort((a, b) => Number(b.mine) - Number(a.mine) || a.name.localeCompare(b.name));
    return `
      <section class="profile">
        <div class="profile-top">
          <span class="avatar avatar--big" aria-hidden="true">${esc(initials(m.name))}</span>
          <div class="profile-who">
            <h2 class="profile-name">${esc(m.name)}</h2>
            <p class="profile-sub">${esc([m.code, m.class].filter(Boolean).join(', '))}</p>
          </div>
        </div>
        <dl class="facts">${[['Username', m.username], ['School', m.school], ['Subjects or batch', m.subjects],
          ['Enrollment number', m.enrollment_no], ['Joined', shortDate(m.joined_on)]]
          .filter(([, v]) => v).map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>
      </section>
      <div class="quick-actions">
        <a class="btn btn-primary" href="#/messages/new">Message a teacher</a>
        <a class="btn btn-quiet" href="#/exam">Add exam date</a>
      </div>
      <section class="block" aria-labelledby="marks-title">
        <h3 class="block-title" id="marks-title">My marks</h3>
        <p class="block-sum">${lastMark ? `Last test: ${percent(lastMark)}% in ${esc(testName(lastMark))}.` : 'No marks yet.'}</p>
        ${historyList(data.marks, marksRow)}
      </section>
      <section class="block" aria-labelledby="exams-title">
        <h3 class="block-title" id="exams-title">My exam dates</h3>
        <p class="block-sum">${nextExam ? `Next: ${esc(nextExam.data.exam || 'exam')}, ${esc(examDates(nextExam))}.` : exams.length ? 'No exams coming up.' : 'No exam dates yet. Add yours so your teachers know.'}</p>
        ${historyList(exams, examRow)}
      </section>
      <section class="block" aria-labelledby="teachers-title">
        <h3 class="block-title" id="teachers-title">Teachers</h3>
        ${teachers.length ? `<ul class="teacher-list">${teachers.map((t) => `
          <li class="teacher-row">
            <span><strong>${esc(t.name)}</strong>${t.mine ? ' <span class="badge badge--ok">Your class</span>' : ''}</span>
            ${t.subjects ? `<span class="h-sub">${esc(t.subjects)}</span>` : ''}
            <a class="linkish" href="#/messages/${esc(t.code)}">Messages with ${esc(t.name.split(' ')[0])}</a>
          </li>`).join('')}</ul>` : '<p class="block-sum">No teachers listed yet.</p>'}
      </section>
      <button class="btn btn-quiet logout" type="button" data-logout>Log out of this phone</button>`;
  });
  if (shown) wireLogout(shown.main);
}

/* ---------------- Student: add an exam date ---------------- */

async function examPage() {
  ui.view = 'exam';
  ui.form = null;
  document.title = `Add an exam date | ${NAME}`;
  app.innerHTML = `${topBar('Add an exam date', '#/')}<main class="paper with-tabs"><p class="list-note">Loading…</p></main>${tabBar('home')}`;
  try {
    if (!home) await loadHome();
  } catch (err) {
    if (ui.view !== 'exam' || auth.needed) return;
    app.querySelector('main').innerHTML = `<p class="empty">${esc(err.message)}</p>`;
    return;
  }
  if (ui.view !== 'exam') return;
  const form = {
    fields: [
      { key: 'exam', label: 'Exam', kind: 'choice', options: home.exam_kinds },
      { key: 'starts_on', label: 'Starts on', kind: 'date' },
      { key: 'ends_on', label: 'Ends on', kind: 'date', hint: 'Leave empty for a one-day exam.' },
      { key: 'subjects', label: 'Subjects or timetable', kind: 'textarea' },
      { key: 'notes', label: 'Anything else your teachers should know', kind: 'textarea' },
    ],
  };
  app.querySelector('main').innerHTML = `
    <form class="entry" novalidate autocomplete="off">
      <div class="entry-lines" style="--tile:#2E6F95">
        <p class="hint">Your teachers and the office see the dates, so they can plan revision.</p>
        ${form.fields.map((f) => fieldHtml(f, '')).join('')}
      </div>
      <div class="actions">
        <p class="form-error" role="alert" hidden></p>
        <button class="btn btn-primary" type="submit">Save exam date</button>
      </div>
    </form>`;
  const formEl = app.querySelector('form');
  wireEdits(formEl);
  let clientId = newId();
  formEl.addEventListener('submit', async (e) => {
    e.preventDefault();
    const values = collectValues(form, formEl);
    await submitPortal(formEl, '/api/portal/student/exams', { client_id: clientId, ...values }, () => {
      clientId = newId();
      home = null;
      toast('Exam date saved.');
      location.hash = '#/';
    });
  });
}

/* ---------------- Start ---------------- */

window.addEventListener('hashchange', route);

ui.view = 'starting';
app.innerHTML = `<main class="login"><p class="list-note">Loading…</p></main>`;
checkSession(ROLE).then((s) => {
  if (s && !s.logins) {
    auth.closed = true;
    renderClosed();
    return;
  }
  if (s && !s.signed_in) { showLogin(); return; }
  startBell(); // offline (no answer): the bell fills in once back online
  route();
});

if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => { /* the page works without it */ });
  });
}
