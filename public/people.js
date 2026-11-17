// SuccessPath Classes: the Students and Teachers screens, and the saved lists that let the
// forms suggest names.

import { APP_NAME, PEOPLE, getForm, indiaToday, feeIsDue } from './forms.js';
import {
  app, ui, store, esc, icon, money, shortDate, timeOf, initials, getJson, postJson, newId, topBar, tabBar, displayValue, toast,
  refreshNotices, setTabBadge, whenSaved, openOverlay, closePanel,
} from './lib.js';
import { renderLeaveCalendar } from './calendar.js';
import { requestsHtml, wireRequests } from './leave.js';

const LIST_PREFIX = 'sp.people.v1.';
const PERSON_PREFIX = 'sp.person.v1.';
const FRESH_MS = 5 * 60 * 1000;
const listState = {};

/* ---------------- Saved lists (used by the name suggestions on forms) ---------------- */

export function cachedPeople(kind) {
  return store.get(LIST_PREFIX + kind, null);
}

export async function refreshPeople(kind) {
  const data = await getJson(`/api/people?kind=${encodeURIComponent(kind)}`);
  const value = { at: Date.now(), month: data.month, people: data.people };
  store.set(LIST_PREFIX + kind, value);
  return value;
}

/** Fetches the lists in the background when they are missing or older than 5 minutes. */
export function warmPeople() {
  for (const kind of Object.keys(PEOPLE)) {
    const saved = cachedPeople(kind);
    if (!saved || Date.now() - saved.at > FRESH_MS) refreshPeople(kind).catch(() => { /* offline: keep the saved list */ });
  }
}

export function findPerson(code) {
  for (const kind of Object.keys(PEOPLE)) {
    const saved = cachedPeople(kind);
    const hit = saved && saved.people.find((p) => p.code === code);
    if (hit) return { ...hit, kind };
  }
  return null;
}

/** Takes a deleted person out of the saved list, so the list does not show them while it reloads. */
function forgetPerson(kind, code) {
  const saved = cachedPeople(kind);
  if (saved) store.set(LIST_PREFIX + kind, { ...saved, people: saved.people.filter((p) => p.code !== code) });
}

/** Puts a person into the saved list straight after an entry about them is saved. */
export function rememberPerson(kind, person) {
  if (!PEOPLE[kind] || !person || !person.code) return;
  const saved = cachedPeople(kind) || { at: 0, month: '', people: [] };
  const others = saved.people.filter((p) => p.code !== person.code);
  const old = saved.people.find((p) => p.code === person.code) || { status: 'Active' };
  store.set(LIST_PREFIX + kind, { ...saved, people: [...others, { ...old, ...person }] });
}

/* ---------------- The list screen ---------------- */

export function renderPeopleList(kind) {
  const conf = PEOPLE[kind];
  const tab = kind === 'student' ? 'students' : 'teachers';
  ui.view = tab;
  ui.form = null;
  document.title = `${conf.title} | ${APP_NAME}`;
  const state = listState[kind] || (listState[kind] = { q: '', show: 'Active', cls: '' });
  app.innerHTML = `
    ${topBar(conf.title)}
    <main class="list-page with-tabs">
      ${kind === 'teacher' ? '<section class="block requests-block" data-requests aria-labelledby="req-title" hidden></section>' : ''}
      <div class="list-tools${kind === 'teacher' ? ' list-tools--static' : ''}">
        <div class="list-top">
          <label class="search">
            ${icon('search')}
            <input type="search" placeholder="Search" value="${esc(state.q)}" aria-label="Search ${esc(conf.title.toLowerCase())} by name${kind === 'student' ? ', ID or enrollment number' : ' or ID'}" autocomplete="off">
          </label>
          <a class="btn btn-primary add-person" href="#/new/${kind === 'student' ? 'admission' : 'teacher'}">${icon('plus')}<span>Add ${esc(conf.one)}</span></a>
        </div>
        <div class="filters">
          <div class="segmented" role="group" aria-label="Which ${esc(conf.title.toLowerCase())}">
            ${(kind === 'student' ? ['Active', 'Enquiry', 'Demo', 'Left', 'All'] : ['Active', 'Enquiry', 'Left', 'All'])
              .map((s) => `<button type="button" data-show="${s}" aria-pressed="${state.show === s}">${s === 'Enquiry' && kind === 'teacher' ? 'Enquiries' : s}</button>`).join('')}
          </div>
          ${kind === 'student' ? '<select class="class-filter" aria-label="Class"><option value="">All classes</option></select>' : ''}
        </div>
      </div>
      <p class="list-note" data-note></p>
      <ul class="people" data-list></ul>
      ${kind === 'teacher' ? '<section class="cal" data-calendar aria-labelledby="cal-title"></section>' : ''}
    </main>
    ${tabBar(tab)}`;
  if (kind === 'teacher') {
    renderLeaveCalendar(app.querySelector('[data-calendar]'));
    const host = app.querySelector('[data-requests]');
    waitingRequests(host);
    wireRequests(host, refreshNotices); // the page redraws on 'sp:leave-decided'
  }

  const search = app.querySelector('input[type="search"]');
  search.addEventListener('input', () => { state.q = search.value; draw(); });
  for (const b of app.querySelectorAll('[data-show]')) {
    b.addEventListener('click', () => {
      state.show = b.getAttribute('data-show');
      for (const x of app.querySelectorAll('[data-show]')) x.setAttribute('aria-pressed', String(x === b));
      draw();
    });
  }
  const classFilter = app.querySelector('.class-filter');
  if (classFilter) classFilter.addEventListener('change', () => { state.cls = classFilter.value; draw(); });

  let offlineNote = '';
  let loadError = '';
  const draw = () => {
    const saved = cachedPeople(kind);
    const list = app.querySelector('[data-list]');
    const note = app.querySelector('[data-note]');
    if (!list) return;
    if (!saved) {
      list.innerHTML = '';
      if (loadError) {
        note.innerHTML = `${esc(loadError)} <button type="button" class="linkish" data-retry>Try again</button>`;
        note.querySelector('[data-retry]').addEventListener('click', () => renderPeopleList(kind));
      } else {
        note.textContent = navigator.onLine === false ? 'Connect to the internet to see this list.' : 'Loading…';
      }
      return;
    }
    if (classFilter) {
      const classes = [...new Set(saved.people.map((p) => p.class).filter(Boolean))].sort(classOrder);
      const current = state.cls;
      classFilter.innerHTML = `<option value="">All classes</option>${classes.map((c) => `<option${c === current ? ' selected' : ''}>${esc(c)}</option>`).join('')}`;
    }
    const q = state.q.trim().toLowerCase();
    const rows = saved.people
      .filter((p) => state.show === 'All' || p.status === state.show)
      .filter((p) => !state.cls || p.class === state.cls)
      .filter((p) => !q || p.name.toLowerCase().includes(q) || p.code.toLowerCase().includes(q)
        || (p.enrollment && String(p.enrollment).toLowerCase().includes(q)))
      .sort((a, b) => a.name.localeCompare(b.name));
    const word = rows.length === 1 ? conf.one : conf.title.toLowerCase();
    const which = state.show === 'All' ? '' : `${state.show.toLowerCase()} `;
    let text = `${rows.length} ${which}${word}`;
    if (state.show === 'Enquiry') {
      text = kind === 'student'
        ? `${rows.length} ${rows.length === 1 ? 'enquiry' : 'enquiries'}, not in demo classes or admitted yet`
        : `${rows.length} teacher ${rows.length === 1 ? 'enquiry' : 'enquiries'}, not hired`;
    } else if (state.show === 'Demo') {
      text = `${rows.length} ${rows.length === 1 ? 'student' : 'students'} in demo classes, not admitted yet`;
    }
    note.textContent = text + offlineNote;
    if (!saved.people.length) {
      list.innerHTML = `
        <li class="empty">
          No ${esc(conf.title.toLowerCase())} yet. Tap "Add ${esc(conf.one)}", or they are added by themselves
          when you save ${kind === 'student' ? 'a fee or an admission' : 'a teacher payment or a new teacher'}.
        </li>`;
      return;
    }
    const today = indiaToday();
    list.innerHTML = rows.length
      ? rows.map((p) => personRow(kind, p, saved.month, today)).join('')
      : `<li class="empty">No ${esc(conf.title.toLowerCase())} match this search.</li>`;
  };

  draw();
  refreshPeople(kind)
    .then(() => { offlineNote = ''; if (ui.view === tab) draw(); })
    .catch((err) => {
      const saved = cachedPeople(kind);
      const when = saved ? timeOf(new Date(saved.at)) : '';
      offlineNote = !saved ? '' : navigator.onLine === false
        ? `. Offline: showing the list saved at ${when}.`
        : `. Could not refresh (${err.message}) Showing the list saved at ${when}.`;
      loadError = err.message;
      if (ui.view === tab) draw();
    });
}

function personRow(kind, p, month, today) {
  const mon = esc(month.split(' ')[0]);
  let badge = '';
  if (p.status === 'Left') badge = '<span class="badge badge--muted">Left</span>';
  else if (p.status === 'Enquiry') badge = '<span class="badge badge--info">Enquiry</span>';
  else if (p.status === 'Demo') badge = '<span class="badge badge--demo">Demo</span>';
  else if (kind === 'teacher' && p.on_leave_today) badge = '<span class="badge badge--due">On leave</span>';
  else if (p.paid_this_month) badge = `<span class="badge badge--ok">Paid ${mon}</span>`;
  else if (kind === 'student') {
    // a one-time or yearly fee already paid is not due every month
    badge = feeIsDue(p.plan, p.last_paid_on, today)
      ? `<span class="badge badge--due">Due ${mon}</span>`
      : '<span class="badge badge--ok">Paid</span>';
  }
  const sub = [p.class, p.enrollment ? `Enrollment ${p.enrollment}` : p.code].filter(Boolean).join(', ');
  return `
    <li>
      <a class="person-row" href="#/${kind === 'student' ? 'students' : 'teachers'}/${esc(p.code)}">
        <span class="avatar" aria-hidden="true">${esc(initials(p.name))}</span>
        <span class="person-main">
          <span class="person-name">${esc(p.name)}</span>
          <span class="person-sub">${esc(sub)}</span>
        </span>
        ${badge}
        <span class="row-chevron">${icon('chevron')}</span>
      </a>
    </li>`;
}

function classOrder(a, b) {
  const n = (s) => { const m = /^Class (\d+)$/.exec(s); return m ? Number(m[1]) : 100; };
  return n(a) - n(b) || a.localeCompare(b);
}

/* ---------------- One student or teacher ---------------- */

// Leave requests from the teacher portal that wait for the office, at the top of the Teachers page.
async function waitingRequests(host) {
  let data;
  try {
    data = await getJson('/api/leave-requests');
  } catch (err) {
    return; // offline: the bell shows them once back online
  }
  if (!document.contains(host)) return;
  const list = data.requests || [];
  setTabBadge('teachers', list.length);
  host.hidden = !list.length;
  host.innerHTML = list.length ? `
    <h3 class="block-title" id="req-title">Leave requests waiting (${list.length})</h3>
    <p class="block-sum">Teachers asked for ${list.length === 1 ? 'this' : 'these'} in their portal. Approving puts the leave on the calendar, and the teacher sees your answer.</p>
    ${requestsHtml(list)}` : '';
}

/** Redraws the Teachers page or a teacher's page after a leave request was answered from the bell. */
export function leaveDecided() {
  if (ui.view === 'teachers') renderPeopleList('teacher');
  const m = location.hash.match(/^#\/teachers\/(TR-\d+)$/);
  if (ui.view === 'person' && m) renderPersonDetail('teacher', m[1]);
}

export async function renderPersonDetail(kind, code) {
  const conf = PEOPLE[kind];
  const tab = kind === 'student' ? 'students' : 'teachers';
  ui.view = 'person';
  ui.form = null;
  const back = `#/${tab}`;
  const known = findPerson(code);
  document.title = `${known ? known.name : code} | ${APP_NAME}`;
  app.innerHTML = `${topBar(known ? known.name : code, back)}<main class="person-page with-tabs"><p class="list-note">Loading…</p></main>${tabBar(tab)}`;

  let data;
  let note = '';
  try {
    data = await getJson(`/api/people/${encodeURIComponent(code)}`);
    store.set(PERSON_PREFIX + code, { at: Date.now(), data });
  } catch (err) {
    const saved = store.get(PERSON_PREFIX + code, null);
    if (!saved) {
      if (ui.view !== 'person') return;
      app.querySelector('main').innerHTML = `
        <p class="empty">${esc(err.message)}</p>
        <button class="btn btn-quiet" type="button" data-retry>Try again</button>`;
      app.querySelector('[data-retry]').addEventListener('click', () => renderPersonDetail(kind, code));
      return;
    }
    data = saved.data;
    note = `Offline: showing what was saved at ${timeOf(new Date(saved.at))}.`;
  }
  if (ui.view !== 'person' || !location.hash.endsWith(code)) return;
  const person = data.person;
  document.title = `${person.name} | ${APP_NAME}`;
  app.querySelector('.bar-title').textContent = person.name;
  const main = app.querySelector('main');
  if (data.deleted) {
    // Deleted by the office: what happened, Restore, and their (cancelled) history underneath.
    main.classList.add('is-deleted');
    main.innerHTML = deletedHtml(kind, person, data.deleted)
      + personHtml(kind, conf, person, data.entries, data.month, note, data.class_exams || []);
    wireRestore(main, kind, person);
    return;
  }
  main.classList.remove('is-deleted');
  main.innerHTML = personHtml(kind, conf, person, data.entries, data.month, note, data.class_exams || [])
    + (kind === 'teacher' ? requestsBlock(data.leave_requests || []) : '')
    + portalHtml(kind, person, data.portal, data.entries, data.messages_to || [])
    + deleteBlockHtml(kind, person);
  wirePortal(main, kind, person, data.portal);
  if (kind === 'teacher') wireRequests(main, refreshNotices);
  wireDelete(main, kind, person, data);
}

/* ---------------- Deleting a student or teacher added by mistake ---------------- */

function deleteBlockHtml(kind, person) {
  return `
    <section class="block danger-block" aria-labelledby="del-title">
      <h3 class="block-title" id="del-title">Delete this ${kind}</h3>
      <p class="block-sum">Only for a wrong entry: a test, a typing mistake, or someone added twice.
        ${kind === 'student' ? 'For a student who stopped coming, use Mark as left instead.' : 'For a teacher who stopped teaching here, use Mark as left instead.'}</p>
      <button type="button" class="btn btn-danger-quiet btn-delete" data-delete>${icon('trash')}<span>Delete ${esc(person.name)}</span></button>
    </section>`;
}

// What deleting would also cancel, in words: "2 fees (₹3,000), 1 marks entry".
function countsText(counts) {
  return counts.map((c) => {
    const form = getForm(c.type);
    const title = form ? form.title : c.type;
    return `${c.n} × ${title}${c.amount ? ` (${money(c.amount)})` : ''}`;
  }).join(', ');
}

function wireDelete(main, kind, person, data) {
  const button = main.querySelector('[data-delete]');
  if (!button) return;
  button.addEventListener('click', () => {
    const counts = data.counts || [];
    const total = counts.reduce((n, c) => n + c.n, 0);
    const waiting = (data.leave_requests || []).filter((r) => r.status === 'Pending').length;
    const overlay = openOverlay();
    overlay.innerHTML = `
      <div class="panel" role="dialog" aria-modal="true" aria-labelledby="panel-title">
        <div class="panel-head">
          <h2 class="panel-title" id="panel-title">Delete ${esc(person.name)}?</h2>
          <button class="panel-close" type="button" data-action="close" aria-label="Close">${icon('close')}</button>
        </div>
        <p class="panel-text">${esc(person.name)} disappears from ${kind === 'student' ? 'Students' : 'Teachers'}, the Analytics page and the Google Sheet${person.status === 'Active' ? ', and can no longer log in to the portal' : ''}.</p>
        <p class="panel-text">${total
          ? `Their ${total === 1 ? 'entry is' : `${total} entries are`} cancelled too: ${esc(countsText(counts))}. If any of them was right, enter it again on the right ${kind}.`
          : 'They have no entries.'}${waiting ? ` ${waiting === 1 ? 'Their leave request that is waiting is' : `Their ${waiting} leave requests that are waiting are`} declined.` : ''}</p>
        <p class="panel-text">Nothing leaves the records, and Restore on this page puts it all back.</p>
        <div class="field" data-field="note">
          <label class="label" for="delete-note">What was wrong?</label>
          <textarea id="delete-note" rows="2" maxlength="300" placeholder="For example: test entry, or added twice" aria-describedby="delete-err"></textarea>
          <p class="field-error" id="delete-err" hidden></p>
        </div>
        <div class="panel-actions">
          <button class="btn btn-danger" type="button" data-action="confirm">${icon('trash')}<span>Delete ${esc(person.name)}</span></button>
          <button class="btn btn-quiet" type="button" data-action="close">Keep ${esc(person.name)}</button>
        </div>
      </div>`;
    const noteEl = overlay.querySelector('#delete-note');
    const errorEl = overlay.querySelector('#delete-err');
    const showError = (message) => {
      errorEl.textContent = message;
      errorEl.hidden = false;
      noteEl.setAttribute('aria-invalid', 'true');
      noteEl.focus();
    };
    noteEl.addEventListener('input', () => { errorEl.hidden = true; noteEl.removeAttribute('aria-invalid'); });
    for (const b of overlay.querySelectorAll('[data-action="close"]')) b.addEventListener('click', () => closePanel());
    const clientId = newId();
    overlay.querySelector('[data-action="confirm"]').addEventListener('click', async (e) => {
      const confirm = e.currentTarget;
      const note = noteEl.value.trim();
      if (!note) { showError('Write what was wrong, for example "added twice" or "test entry".'); return; }
      confirm.disabled = true;
      const label = confirm.innerHTML;
      confirm.textContent = 'Deleting…';
      let res;
      try {
        res = await postJson(`/api/people/${encodeURIComponent(person.code)}/delete`, { client_id: clientId, note });
      } catch (err) {
        res = { status: 0, data: { error: 'No internet connection. Nothing was deleted. Try again when you are online.' } };
      }
      confirm.disabled = false;
      confirm.innerHTML = label;
      if (res.status === 200 && res.data && res.data.ok) {
        closePanel(false);
        forgetPerson(kind, person.code);
        refreshPeople(kind).catch(() => { /* offline: the list catches up later */ });
        location.hash = `#/${kind === 'student' ? 'students' : 'teachers'}`;
        toast(`${person.name} deleted.`, { label: 'Undo', run: () => restore(kind, person, true) });
        return;
      }
      if (res.status === 401) { closePanel(false); return; }
      showError((res.data && ((res.data.fields && res.data.fields.note) || res.data.error)) || 'That did not work. Please try again.');
    });
    noteEl.focus();
  });
}

function deletedHtml(kind, person, deleted) {
  return `
    <section class="deleted-banner" aria-labelledby="deleted-title">
      <h2 class="deleted-title" id="deleted-title">${icon('trash')}<span>Deleted ${esc(whenSaved(deleted.at))}</span></h2>
      <p>${esc(deleted.note ? `Note: ${deleted.note}` : '')}</p>
      <p>${deleted.entries ? `${deleted.entries} ${deleted.entries === 1 ? 'entry was' : 'entries were'} cancelled with ${kind === 'student' ? 'this student' : 'this teacher'}` : 'There were no entries to cancel'}${deleted.requests ? `, and ${deleted.requests === 1 ? 'a leave request' : `${deleted.requests} leave requests`} declined` : ''}.
        Restore brings ${esc(person.name)} back, with ${deleted.entries === 1 ? 'that entry' : 'those entries'}.</p>
      <button type="button" class="btn btn-primary" data-restore>${icon('restore')}<span>Restore ${esc(person.name)}</span></button>
    </section>`;
}

function wireRestore(main, kind, person) {
  const button = main.querySelector('[data-restore]');
  button.addEventListener('click', async () => {
    button.disabled = true;
    await restore(kind, person, false);
    button.disabled = false;
  });
}

async function restore(kind, person, fromUndo) {
  let res;
  try {
    res = await postJson(`/api/people/${encodeURIComponent(person.code)}/restore`, { client_id: newId() });
  } catch (err) {
    toast('No internet connection. Nothing was changed. Try again when you are online.');
    return;
  }
  if (res.status === 200 && res.data && res.data.ok) {
    await refreshPeople(kind).catch(() => { /* offline: the list catches up later */ });
    toast(`${person.name} is back${res.data.entries ? `, with ${res.data.entries} ${res.data.entries === 1 ? 'entry' : 'entries'}` : ''}.`);
    const page = `#/${kind === 'student' ? 'students' : 'teachers'}/${person.code}`;
    if (location.hash === page) renderPersonDetail(kind, person.code);
    else if (!fromUndo) location.hash = page;
    else if (ui.view === (kind === 'student' ? 'students' : 'teachers')) renderPeopleList(kind);
    return;
  }
  if (res.status !== 401) toast((res.data && res.data.error) || 'That did not work. Please try again.');
}

// A teacher's leave requests from the portal: the waiting ones first, with Approve and Decline.
function requestsBlock(requests) {
  if (!requests.length) return '';
  const waiting = requests.filter((r) => r.status === 'Pending');
  const answered = requests.filter((r) => r.status !== 'Pending').slice(0, 10);
  return `
    <section class="block" aria-labelledby="lrq-title">
      <h3 class="block-title" id="lrq-title">Leave requests from the portal</h3>
      <p class="block-sum">${waiting.length ? `${waiting.length} waiting for your answer.` : 'Nothing waiting.'}</p>
      ${requestsHtml([...waiting, ...answered], { names: false })}
    </section>`;
}

/* ---------------- The person's portal: how they log in, and their messages ---------------- */

function portalLink(kind) {
  return `${location.origin}/${kind === 'teacher' ? 'teacher' : 'student'}`;
}

function loginText(kind, person, portal) {
  return [
    `SuccessPath Classes ${kind === 'teacher' ? 'teacher' : 'student'} portal`,
    portalLink(kind),
    `Username: ${portal.username}`,
    `Password: ${portal.password}`,
  ].join('\n');
}

function portalHtml(kind, person, portal, entries, messagesTo) {
  if (!portal) return '';
  const active = person.status === 'Active';
  const word = kind === 'teacher' ? 'Teacher' : 'Student';
  let state = '';
  if (!portal.open) state = 'The portals open once the office password is set on the server (see the README).';
  else if (!portal.can_log_in) state = `Only current ${kind === 'teacher' ? 'teachers' : 'students'} can log in.`;
  const taught = kind === 'teacher'
    ? (portal.classes_taught && portal.classes_taught.length
      ? portal.classes_taught.join(', ')
      : 'None found in "Classes or batches", so every student shows under All.')
    : '';
  const sent = kind === 'student' ? entries.filter((e) => e.type === 'portal_message' && e.status === 'Active') : [];
  const messages = kind === 'teacher' ? messagesTo : sent.map((e) => ({
    code: e.code, entry_date: e.entry_date, created_at: e.created_at, about: e.data.about, message: e.data.message,
    teacher_name: e.data.teacher_name, from: e.data.from || 'Student', student_name: person.name,
  }));
  // Only current students and teachers can log in; enquiries, demo students and people who left cannot.
  if (!active && !messages.length) return '';
  return `${active ? `
    <section class="block portal-block" aria-labelledby="portal-title">
      <h3 class="block-title" id="portal-title">${word} portal</h3>
      ${state ? `<p class="block-sum">${esc(state)}</p>` : ''}
      <dl class="portal-facts">
        <div><dt>Link</dt><dd>${esc(portalLink(kind).replace(/^https?:\/\//, ''))}</dd></div>
        <div><dt>Username</dt><dd><code>${esc(portal.username || '')}</code></dd></div>
        <div><dt>Password</dt><dd><code>${esc(portal.password)}</code></dd></div>
        ${kind === 'teacher' ? `<div><dt>Their students</dt><dd>${esc(taught)}</dd></div>` : ''}
      </dl>
      ${portal.can_log_in && portal.username ? `
      <div class="portal-actions">
        <button class="btn btn-quiet" type="button" data-share-login>${icon('share')}<span>Send login details</span></button>
        ${person.phone ? `<a class="btn btn-quiet" data-whatsapp target="_blank" rel="noopener" href="https://wa.me/91${esc(person.phone)}?text=${encodeURIComponent(loginText(kind, person, portal))}">${icon('message')}<span>WhatsApp</span></a>` : ''}
      </div>` : ''}
    </section>` : ''}

    <section class="block" aria-labelledby="messages-title">
      <h3 class="block-title" id="messages-title">Portal messages</h3>
      ${messages.length ? `<ul class="history">${messages.map((m) => {
        const byStudent = m.from !== 'Teacher';
        const student = esc(m.student_name || 'A student');
        const teacher = esc(m.teacher_name || 'a teacher');
        return `
        <li class="h-row">
          <span class="h-date">${esc(m.created_at ? whenSaved(m.created_at) : shortDate(m.entry_date))}</span>
          <span class="h-main">${byStudent ? `<strong>${student}</strong> to ${teacher}` : `<strong>${teacher}</strong> to ${student}`}${m.class && kind === 'teacher' ? `, ${esc(m.class)}` : ''}
            ${m.about ? `<span class="badge badge--about">${esc(m.about)}</span>` : ''}</span>
          <span class="h-sub h-note">${esc(m.message || '')}</span>
          <span class="h-sub">${esc(m.code)}</span>
        </li>`;
      }).join('')}</ul>` : `<p class="block-sum">${kind === 'teacher' ? 'No messages with students yet.' : 'No messages with teachers yet.'}</p>`}
    </section>`;
}

function wirePortal(main, kind, person, portal) {
  const share = main.querySelector('[data-share-login]');
  if (!share || !portal) return;
  share.addEventListener('click', async () => {
    const text = loginText(kind, person, portal);
    if (navigator.share) {
      try { await navigator.share({ title: 'SuccessPath portal', text }); return; } catch (err) { if (err && err.name === 'AbortError') return; }
    }
    try {
      await navigator.clipboard.writeText(text);
      toast('Login details copied. Paste them into WhatsApp or a message.');
    } catch (err) {
      toast(text.replace(/\n/g, ', '));
    }
  });
}

function personHtml(kind, conf, person, entries, month, note, classExams) {
  const d = person.details || {};
  const active = entries.filter((e) => e.status === 'Active');
  const payments = active.filter((e) => e.type === conf.paymentType);
  const returned = active.filter((e) => e.type === 'refund').reduce((s, e) => s + (e.amount || 0), 0);
  const totalPaid = payments.reduce((s, e) => s + (e.amount || 0), 0);
  const lastPaidOn = payments.map((e) => e.entry_date).filter(Boolean).sort().pop() || null;
  const today = indiaToday();
  const paidThisMonth = payments.some((e) => {
    const months = e.data[conf.monthsField];
    return months ? String(months).includes(month) : String(e.entry_date || '').slice(0, 7) === isoMonth(month);
  });
  const facts = kind === 'student'
    ? [['Enrollment number', d.enrollment_no], ['Father or guardian', d.parent_name], ['Second phone', d.phone_2], ['Email', d.email], ['School', d.school], ['Subjects or batch', d.subjects],
      ['Demo classes from', ['Enquiry', 'Demo'].includes(person.status) ? shortDate(d.demo_from) : ''],
      ['Fee agreed', d.fee_amount ? money(d.fee_amount) : ''], ['Fee plan', d.fee_plan], ['Admission date', shortDate(person.joined_on)],
      ['Left on', shortDate(person.left_on)], ['Added by entry', person.created_from]]
    : [['Subjects', d.subjects], ['Classes or batches', d.classes], ['Salary per month', d.salary ? money(d.salary) : ''],
      ['Qualification', d.qualification], ['Experience', d.experience], ['Salary asked for', d.salary_asked ? money(d.salary_asked) : ''],
      ['Joining date', shortDate(person.joined_on)], ['Left on', shortDate(person.left_on)],
      ['Added by entry', person.created_from]];
  const statusBadge = person.status === 'Cancelled' ? '<span class="badge badge--deleted">Deleted</span>'
    : person.status === 'Left' ? '<span class="badge badge--muted">Left</span>'
    : person.status === 'Enquiry' ? `<span class="badge badge--info">${kind === 'student' ? 'Enquiry' : 'Enquiry, not hired'}</span>`
      : person.status === 'Demo' ? '<span class="badge badge--demo">Demo classes</span>'
      : '<span class="badge badge--ok">Active</span>';
  const go = (type) => `#/new/${type}?person=${encodeURIComponent(person.code)}`;
  const left = person.status === 'Left';
  let actions;
  if (kind === 'student' && person.status === 'Enquiry') {
    actions = `<a class="btn btn-primary btn-demo" href="${go('demo')}">Move to demo</a>
       <a class="btn btn-quiet btn-admit" href="${go('admission')}">Full admission</a>
       <a class="btn btn-quiet" href="${go('enquiry')}">Follow-up</a>
       <a class="btn btn-quiet" href="${go('note')}">Add note</a>
       <a class="btn btn-quiet btn-not-joined" href="${go('student_left')}">Did not join</a>`;
  } else if (kind === 'student' && person.status === 'Demo') {
    actions = `<a class="btn btn-primary btn-admit" href="${go('admission')}">Full admission</a>
       <a class="btn btn-quiet" href="${go('note')}">Add note</a>
       <a class="btn btn-quiet btn-not-joined" href="${go('student_left')}">Did not join</a>`;
  } else if (kind === 'student') {
    actions = left
      ? `<a class="btn btn-primary" href="${go('fee')}">Fee received</a>
         <a class="btn btn-quiet btn-refund" href="${go('refund')}">Money returned</a>
         <a class="btn btn-quiet" href="${go('admission')}">Rejoined</a>
         <a class="btn btn-quiet" href="${go('note')}">Add note</a>`
      : `<a class="btn btn-primary" href="${go('fee')}">Fee received</a>
         <a class="btn btn-quiet" href="${go('marks')}">Add marks</a>
         <a class="btn btn-quiet" href="${go('exam')}">Exam dates</a>
         <a class="btn btn-quiet" href="${go('note')}">Add note</a>
         <a class="btn btn-quiet btn-refund" href="${go('refund')}">Money returned</a>
         <a class="btn btn-quiet btn-mark-left" href="${go('student_left')}">Mark as left</a>`;
  } else if (person.status === 'Enquiry') {
    actions = `<a class="btn btn-primary btn-hire" href="${go('teacher')}">Hire</a>
       <a class="btn btn-quiet" href="${go('note')}">Add note</a>`;
  } else {
    actions = left
      ? `<a class="btn btn-primary" href="${go('teacher_payment')}">Teacher payment</a>
         <a class="btn btn-quiet" href="${go('teacher')}">Rejoined</a>
         <a class="btn btn-quiet" href="${go('note')}">Add note</a>`
      : `<a class="btn btn-primary" href="${go('teacher_payment')}">Teacher payment</a>
         <a class="btn btn-quiet" href="${go('leave')}">Book leave</a>
         <a class="btn btn-quiet" href="${go('note')}">Add note</a>
         <a class="btn btn-quiet btn-mark-left" href="${go('teacher_left')}">Mark as left</a>`;
  }

  const marks = entries.filter((e) => e.type === 'marks');
  const notes = entries.filter((e) => e.type === 'note');
  const exams = examOrder([...entries.filter((e) => e.type === 'exam'), ...classExams.map((e) => ({ ...e, forClass: true }))]);
  const leaves = comingFirst(entries.filter((e) => e.type === 'leave'), (e) => e.data.to || e.entry_date || '');
  const others = entries.filter((e) => ![conf.paymentType, 'refund', 'marks', 'note', 'exam', 'leave', 'portal_message'].includes(e.type));
  const paymentWord = kind === 'student' ? 'Fees' : 'Payments';
  const lastMark = marks.find((e) => e.status === 'Active' && percent(e) !== null);
  const nextExam = exams.find((e) => e.status === 'Active' && examEnd(e) >= indiaToday());

  return `
    ${note ? `<p class="notice">${esc(note)}</p>` : ''}
    <section class="profile">
      <div class="profile-top">
        <span class="avatar avatar--big" aria-hidden="true">${esc(initials(person.name))}</span>
        <div class="profile-who">
          <h2 class="profile-name">${esc(person.name)}</h2>
          <p class="profile-sub">${esc([person.code, person.class].filter(Boolean).join(', '))} ${statusBadge}</p>
        </div>
      </div>
      ${person.phone ? `<a class="call" href="tel:+91${esc(person.phone)}">${icon('phone')}<span>Call ${esc(person.phone.replace(/(\d{5})(\d{5})/, '$1 $2'))}</span></a>` : ''}
      <dl class="facts">${facts.filter(([, v]) => v).map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>
      <a class="btn btn-quiet btn-edit" href="#/${kind === 'student' ? 'students' : 'teachers'}/${esc(person.code)}/edit">${icon('edit')}<span>Edit details</span></a>
    </section>
    <div class="quick-actions">${actions}</div>

    <section class="block" aria-labelledby="pay-title">
      <h3 class="block-title" id="pay-title">${paymentWord}</h3>
      <p class="block-sum">
        ${payments.length ? `${money(totalPaid)} paid in ${payments.length} ${payments.length === 1 ? 'payment' : 'payments'}.` : 'Nothing paid yet.'}
        ${returned ? `${money(returned)} returned.` : ''}
        ${person.status !== 'Active' ? '' : paidThisMonth ? `${esc(month)} is paid.`
          : kind === 'student' && !feeIsDue(d.fee_plan, lastPaidOn, today) ? `Nothing due for ${esc(month)} (${esc(d.fee_plan)} fee).`
          : `${esc(month)} is not paid yet.`}
      </p>
      ${historyList(entries.filter((e) => e.type === conf.paymentType || e.type === 'refund'), (e) => paymentRow(e, conf))}
    </section>

    ${kind === 'student' ? `
    <section class="block" aria-labelledby="marks-title">
      <h3 class="block-title" id="marks-title">Marks</h3>
      <p class="block-sum">${lastMark ? `Last test: ${percent(lastMark)}% in ${esc(testName(lastMark))}.` : marks.length ? 'No marks with a score yet.' : 'No marks yet.'}</p>
      ${historyList(marks, marksRow)}
    </section>

    <section class="block" aria-labelledby="exams-title">
      <h3 class="block-title" id="exams-title">Exam dates</h3>
      <p class="block-sum">${nextExam ? `Next: ${esc(nextExam.data.exam || 'exam')}${nextExam.entry_date ? `, ${esc(nextExam.entry_date <= indiaToday() ? 'on now' : `from ${shortDate(nextExam.entry_date)}`)}` : ''}.` : exams.length ? 'No exams coming up.' : 'No exam dates yet. Dates saved for the whole class show here too.'}</p>
      ${historyList(exams, examRow)}
    </section>` : ''}

    ${kind === 'teacher' && (person.status !== 'Enquiry' || leaves.length) ? `
    <section class="block" aria-labelledby="leave-title">
      <h3 class="block-title" id="leave-title">Leave</h3>
      <p class="block-sum">${leaveSummary(leaves, today)}</p>
      ${historyList(leaves, leaveRow)}
    </section>` : ''}

    <section class="block" aria-labelledby="notes-title">
      <h3 class="block-title" id="notes-title">Notes</h3>
      ${notes.length ? historyList(notes, noteRow) : '<p class="block-sum">No notes yet.</p>'}
    </section>

    ${others.length ? `
    <section class="block" aria-labelledby="other-title">
      <h3 class="block-title" id="other-title">Other records</h3>
      ${historyList(others, otherRow)}
    </section>` : ''}`;
}

function isoMonth(label) {
  const [mon, year] = String(label).split(' ');
  const i = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'].indexOf(mon);
  return `${year}-${String(i + 1).padStart(2, '0')}`;
}

export function historyList(entries, row) {
  if (!entries.length) return '';
  return `<ul class="history">${entries.map((e) => `
    <li class="h-row${e.status === 'Cancelled' ? ' is-cancelled' : ''}">
      <span class="h-date">${esc(e.entry_date ? shortDate(e.entry_date) : ['exam', 'leave'].includes(e.type) ? 'No date' : shortDate(String(e.created_at).slice(0, 10)))}</span>
      ${row(e)}
      ${e.status === 'Cancelled' ? `<span class="h-cancel">Cancelled${e.cancel_reason ? `: ${esc(e.cancel_reason)}` : ''}</span>` : ''}
    </li>`).join('')}</ul>`;
}

function paymentRow(e, conf) {
  if (e.type === 'refund') {
    const why = [e.data.reason, e.code].filter(Boolean).join('. ');
    return `
    <span class="h-main"><strong class="minus">${esc(e.amount ? `−${money(e.amount)}` : 'Amount not written')}</strong> returned${e.data.mode ? ` by ${esc(e.data.mode)}` : ''}</span>
    <span class="h-sub">${esc(why)}</span>`;
  }
  const months = e.data[conf.monthsField];
  const extra = [e.data.payment_for, months ? `For ${months}` : '', e.code].filter(Boolean).join('. ');
  const amount = e.amount === null || e.amount === undefined ? 'Amount not written' : money(e.amount);
  return `
    <span class="h-main"><strong>${esc(amount)}</strong>${e.data.mode ? ` by ${esc(e.data.mode)}` : ''}</span>
    <span class="h-sub">${esc(extra)}</span>`;
}

/** The score as a whole percent, or null when the marks or the total were not written. */
export function percent(e) {
  if (e.data.marks === undefined || e.data.marks === null || !Number(e.data.out_of)) return null;
  const pct = (100 * Number(e.data.marks)) / Number(e.data.out_of);
  return Number.isFinite(pct) ? Math.round(pct) : null;
}

export function testName(e) {
  return [e.data.exam, e.data.test, e.data.subject].filter(Boolean).join(', ') || 'a test';
}

export function marksRow(e) {
  const pct = percent(e);
  const title = [e.data.exam, e.data.test].filter(Boolean).join(', ') || 'Test';
  let score = '';
  if (pct !== null) score = `${e.data.marks} out of ${e.data.out_of} (${pct}%)`;
  else if (e.data.marks !== undefined) score = `${e.data.marks} marks`;
  const sub = [score, e.data.remarks].filter(Boolean).join('. ');
  return `
    <span class="h-main"><strong>${esc(title)}</strong>${e.data.subject ? `, ${esc(e.data.subject)}` : ''}</span>
    ${sub ? `<span class="h-sub">${esc(sub)}</span>` : ''}
    ${pct !== null ? `<span class="meter" role="img" aria-label="${pct} percent"><span class="meter-fill${pct < 40 ? ' meter-fill--low' : ''}" style="width:${Math.min(100, Math.max(0, pct))}%"></span></span>` : ''}`;
}

export function examEnd(e) {
  return e.data.ends_on || e.entry_date || '';
}

// Exams not over yet come first, soonest at the top; then past exams, latest first.
export function examOrder(list) {
  const now = indiaToday();
  const start = (e) => e.entry_date || e.data.ends_on || '';
  const coming = list.filter((e) => examEnd(e) >= now).sort((a, b) => start(a).localeCompare(start(b)));
  const past = list.filter((e) => !(examEnd(e) >= now)).sort((a, b) => start(b).localeCompare(start(a)));
  return [...coming, ...past];
}

export function examRow(e) {
  const ends = e.data.ends_on && e.data.ends_on !== e.entry_date ? `Until ${shortDate(e.data.ends_on)}` : '';
  const forWhom = e.forClass ? `For all of ${e.data.class}${e.data.school ? ` at ${e.data.school}` : ''}` : e.data.school || '';
  const sub = [ends, forWhom, e.code].filter(Boolean).join('. ');
  return `
    <span class="h-main"><strong>${esc(e.data.exam || 'Exam')}</strong></span>
    ${sub ? `<span class="h-sub">${esc(sub)}</span>` : ''}
    ${e.data.subjects ? `<span class="h-sub h-note">${esc(e.data.subjects)}</span>` : ''}
    ${e.data.notes ? `<span class="h-sub h-note">${esc(e.data.notes)}</span>` : ''}
    ${e.data.added_by ? `<span class="h-sub">Added by the student in the portal</span>` : ''}`;
}

// Not over yet first (soonest at the top), then the past ones (latest first).
function comingFirst(list, endOf) {
  const now = indiaToday();
  const start = (e) => e.entry_date || endOf(e);
  const coming = list.filter((e) => endOf(e) >= now).sort((a, b) => start(a).localeCompare(start(b)));
  const past = list.filter((e) => !(endOf(e) >= now)).sort((a, b) => start(b).localeCompare(start(a)));
  return [...coming, ...past];
}

function leaveSummary(leaves, today) {
  const active = leaves.filter((e) => e.status === 'Active' && (e.entry_date || e.data.to));
  if (!active.length) return 'No leave booked.';
  const endOf = (e) => e.data.to || e.entry_date;
  const startOf = (e) => e.entry_date || e.data.to;
  const now = active.find((e) => startOf(e) <= today && endOf(e) >= today);
  const next = active.filter((e) => startOf(e) > today).sort((a, b) => startOf(a).localeCompare(startOf(b)))[0];
  // days of leave in this session, which runs from 1 April
  const year = Number(today.slice(0, 4)) - (Number(today.slice(5, 7)) < 4 ? 1 : 0);
  const from = `${year}-04-01`;
  const to = `${year + 1}-03-31`;
  let days = 0;
  for (const e of active) {
    const a = startOf(e) > from ? startOf(e) : from;
    const b = endOf(e) < to ? endOf(e) : to;
    if (a <= b) days += Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000) + 1;
  }
  const parts = [];
  if (now) parts.push(endOf(now) === today ? 'On leave today.' : `On leave now, back after ${shortDate(endOf(now))}.`);
  if (next) parts.push(`Next leave: ${shortDate(startOf(next))}${next.data.reason ? ` (${next.data.reason})` : ''}.`);
  parts.push(`${days} ${days === 1 ? 'day' : 'days'} of leave since 1 April ${year}.`);
  return esc(parts.join(' '));
}

export function leaveRow(e) {
  const span = e.data.to && e.data.to !== e.entry_date ? `Until ${shortDate(e.data.to)}` : 'One day';
  const sub = [span, e.data.notes, e.code].filter(Boolean).join('. ');
  return `
    <span class="h-main"><strong>${esc(e.data.reason || 'Leave')}</strong></span>
    <span class="h-sub">${esc(sub)}</span>`;
}

function noteRow(e) {
  return `<span class="h-main h-note">${esc(e.data.note)}</span>`;
}

function otherRow(e) {
  const form = getForm(e.type);
  const title = form ? form.title : e.type;
  const keyFields = form ? form.fields.filter((f) => ['reason', 'about', 'details', 'class', 'subjects'].includes(f.key)) : [];
  const sub = keyFields.map((f) => displayValue(f, e.data[f.key])).filter(Boolean).join('. ');
  return `
    <span class="h-main"><strong>${esc(title)}</strong></span>
    <span class="h-sub">${esc([sub, e.code].filter(Boolean).join('. '))}</span>`;
}

// Used by the analytics page and others that link to a person.
export function personHref(code) {
  return code.startsWith('TR-') ? `#/teachers/${code}` : `#/students/${code}`;
}

