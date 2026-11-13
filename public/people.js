// SuccessPath Classes: the Students and Teachers screens, and the saved lists that let the
// forms suggest names.

import { APP_NAME, PEOPLE, getForm, indiaToday } from './forms.js';
import {
  app, ui, store, esc, icon, money, shortDate, timeOf, initials, getJson, topBar, tabBar, displayValue,
} from './lib.js';

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
      <div class="list-tools">
        <label class="search">
          ${icon('search')}
          <input type="search" placeholder="Search by name or ID" value="${esc(state.q)}" aria-label="Search ${esc(conf.title.toLowerCase())}" autocomplete="off">
        </label>
        <div class="filters">
          <div class="segmented" role="group" aria-label="Which ${esc(conf.title.toLowerCase())}">
            ${['Active', 'Left', 'All'].map((s) => `<button type="button" data-show="${s}" aria-pressed="${state.show === s}">${s}</button>`).join('')}
          </div>
          ${kind === 'student' ? '<select class="class-filter" aria-label="Class"><option value="">All classes</option></select>' : ''}
        </div>
      </div>
      <p class="list-note" data-note></p>
      <ul class="people" data-list></ul>
    </main>
    ${tabBar(tab)}`;

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
      .filter((p) => !q || p.name.toLowerCase().includes(q) || p.code.toLowerCase().includes(q))
      .sort((a, b) => a.name.localeCompare(b.name));
    const word = rows.length === 1 ? conf.one : conf.title.toLowerCase();
    const which = state.show === 'All' ? '' : `${state.show.toLowerCase()} `;
    note.textContent = `${rows.length} ${which}${word}${offlineNote}`;
    if (!saved.people.length) {
      list.innerHTML = `
        <li class="empty">
          No ${esc(conf.title.toLowerCase())} yet. They are added by themselves when you save
          ${kind === 'student' ? 'a fee or an admission' : 'a teacher payment or a new teacher'}.
        </li>`;
      return;
    }
    list.innerHTML = rows.length
      ? rows.map((p) => personRow(kind, p, saved.month)).join('')
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

function personRow(kind, p, month) {
  let badge = '';
  if (p.status === 'Left') badge = '<span class="badge badge--muted">Left</span>';
  else if (p.paid_this_month) badge = `<span class="badge badge--ok">Paid ${esc(month.split(' ')[0])}</span>`;
  else if (kind === 'student') badge = `<span class="badge badge--due">Due ${esc(month.split(' ')[0])}</span>`;
  const sub = [p.class, p.code].filter(Boolean).join(', ');
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
  app.querySelector('main').innerHTML = personHtml(kind, conf, person, data.entries, data.month, note, data.class_exams || []);
}

function personHtml(kind, conf, person, entries, month, note, classExams) {
  const d = person.details || {};
  const active = entries.filter((e) => e.status === 'Active');
  const payments = active.filter((e) => e.type === conf.paymentType);
  const totalPaid = payments.reduce((s, e) => s + (e.amount || 0), 0);
  const paidThisMonth = payments.some((e) => {
    const months = e.data[conf.monthsField];
    return months ? String(months).includes(month) : String(e.entry_date || '').slice(0, 7) === isoMonth(month);
  });
  const facts = kind === 'student'
    ? [['Father or guardian', d.parent_name], ['Second phone', d.phone_2], ['School', d.school], ['Subjects or batch', d.subjects],
      ['Fee agreed', d.fee_amount ? money(d.fee_amount) : ''], ['Fee plan', d.fee_plan], ['Admission date', shortDate(person.joined_on)],
      ['Left on', shortDate(person.left_on)], ['Added by entry', person.created_from]]
    : [['Subjects', d.subjects], ['Classes or batches', d.classes], ['Salary per month', d.salary ? money(d.salary) : ''],
      ['Qualification', d.qualification], ['Joining date', shortDate(person.joined_on)], ['Left on', shortDate(person.left_on)],
      ['Added by entry', person.created_from]];
  const statusBadge = person.status === 'Left' ? '<span class="badge badge--muted">Left</span>' : '<span class="badge badge--ok">Active</span>';
  const go = (type) => `#/new/${type}?person=${encodeURIComponent(person.code)}`;
  const actions = kind === 'student'
    ? `<a class="btn btn-primary" href="${go('fee')}">Fee received</a>
       <a class="btn btn-quiet" href="${go('marks')}">Add marks</a>
       <a class="btn btn-quiet" href="${go('exam')}">Exam dates</a>
       <a class="btn btn-quiet" href="${go('note')}">Add note</a>`
    : `<a class="btn btn-primary" href="${go('teacher_payment')}">Teacher payment</a>
       <a class="btn btn-quiet" href="${go('note')}">Add note</a>`;

  const marks = entries.filter((e) => e.type === 'marks');
  const notes = entries.filter((e) => e.type === 'note');
  const exams = examOrder([...entries.filter((e) => e.type === 'exam'), ...classExams.map((e) => ({ ...e, forClass: true }))]);
  const others = entries.filter((e) => ![conf.paymentType, 'marks', 'note', 'exam'].includes(e.type));
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
    </section>
    <div class="quick-actions">${actions}</div>

    <section class="block" aria-labelledby="pay-title">
      <h3 class="block-title" id="pay-title">${paymentWord}</h3>
      <p class="block-sum">
        ${payments.length ? `${money(totalPaid)} paid in ${payments.length} ${payments.length === 1 ? 'payment' : 'payments'}.` : 'Nothing paid yet.'}
        ${person.status === 'Active' ? (paidThisMonth ? `${esc(month)} is paid.` : `${esc(month)} is not paid yet.`) : ''}
      </p>
      ${historyList(entries.filter((e) => e.type === conf.paymentType), (e) => paymentRow(e, conf))}
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

function historyList(entries, row) {
  if (!entries.length) return '';
  return `<ul class="history">${entries.map((e) => `
    <li class="h-row${e.status === 'Cancelled' ? ' is-cancelled' : ''}">
      <span class="h-date">${esc(e.entry_date ? shortDate(e.entry_date) : e.type === 'exam' ? 'No date' : shortDate(String(e.created_at).slice(0, 10)))}</span>
      ${row(e)}
      ${e.status === 'Cancelled' ? `<span class="h-cancel">Cancelled${e.cancel_reason ? `: ${esc(e.cancel_reason)}` : ''}</span>` : ''}
    </li>`).join('')}</ul>`;
}

function paymentRow(e, conf) {
  const months = e.data[conf.monthsField];
  const extra = [e.data.payment_for, months ? `For ${months}` : '', e.code].filter(Boolean).join('. ');
  const amount = e.amount === null || e.amount === undefined ? 'Amount not written' : money(e.amount);
  return `
    <span class="h-main"><strong>${esc(amount)}</strong>${e.data.mode ? ` by ${esc(e.data.mode)}` : ''}</span>
    <span class="h-sub">${esc(extra)}</span>`;
}

/** The score as a whole percent, or null when the marks or the total were not written. */
function percent(e) {
  if (e.data.marks === undefined || e.data.marks === null || !Number(e.data.out_of)) return null;
  const pct = (100 * Number(e.data.marks)) / Number(e.data.out_of);
  return Number.isFinite(pct) ? Math.round(pct) : null;
}

function testName(e) {
  return [e.data.exam, e.data.test, e.data.subject].filter(Boolean).join(', ') || 'a test';
}

function marksRow(e) {
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

function examEnd(e) {
  return e.data.ends_on || e.entry_date || '';
}

// Exams not over yet come first, soonest at the top; then past exams, latest first.
function examOrder(list) {
  const now = indiaToday();
  const start = (e) => e.entry_date || e.data.ends_on || '';
  const coming = list.filter((e) => examEnd(e) >= now).sort((a, b) => start(a).localeCompare(start(b)));
  const past = list.filter((e) => !(examEnd(e) >= now)).sort((a, b) => start(b).localeCompare(start(a)));
  return [...coming, ...past];
}

function examRow(e) {
  const ends = e.data.ends_on && e.data.ends_on !== e.entry_date ? `Until ${shortDate(e.data.ends_on)}` : '';
  const forWhom = e.forClass ? `For all of ${e.data.class}${e.data.school ? ` at ${e.data.school}` : ''}` : e.data.school || '';
  const sub = [ends, forWhom, e.code].filter(Boolean).join('. ');
  return `
    <span class="h-main"><strong>${esc(e.data.exam || 'Exam')}</strong></span>
    ${sub ? `<span class="h-sub">${esc(sub)}</span>` : ''}
    ${e.data.subjects ? `<span class="h-sub h-note">${esc(e.data.subjects)}</span>` : ''}
    ${e.data.notes ? `<span class="h-sub h-note">${esc(e.data.notes)}</span>` : ''}`;
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

