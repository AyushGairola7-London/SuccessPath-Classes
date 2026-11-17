// SuccessPath Classes: the Activity log (office only).
//
// What changed in the last 30 days and who made it, when that is known, newest first: entries saved
// and cancelled, details changed, students and teachers deleted or restored, tasks, leave requests
// and portal messages. Older changes drop off by themselves. The server reads it from the database's
// own history, so nothing here can be changed or deleted, and the records themselves stay.

import { getForm } from './forms.js';
import { app, ui, esc, icon, getJson, topBar, tabBar, shortDate, money, summaryText } from './lib.js';

const WHO = [['all', 'All'], ['office', 'Office'], ['teacher', 'Teachers'], ['student', 'Students']];
const WHAT = [['all', 'All changes'], ['entries', 'Entries saved'], ['messages', 'Portal messages'], ['cancelled', 'Cancelled entries'],
  ['details', 'Details changed'], ['deleted', 'Deleted and restored'], ['tasks', 'Tasks'], ['leave', 'Leave requests']];
const WHEN = [['month', 'Last 30 days'], ['week', 'Last 7 days'], ['today', 'Today']];
const WHEN_WORDS = { month: 'in the last 30 days', week: 'in the last 7 days', today: 'today' };
const STAGE_WORDS = { 'To do': 'Task moved back to To do', Doing: 'Task moved to Doing', Done: 'Task done', Removed: 'Task removed from the board' };
const TASK_LABELS = { title: 'Title', notes: 'Notes', start_on: 'Start date', due_on: 'End date', budget: 'Budget', owner: 'Owner' };
const state = { who: 'all', what: 'all', when: 'month', q: '' };
let current = 0; // the latest load; older answers are ignored
let lastDay = '';
let next = null;

export function renderLog() {
  ui.view = 'log';
  ui.form = null;
  document.title = 'Activity log | SuccessPath Classes';
  app.innerHTML = `
    ${topBar('Activity log', '#/')}
    <main class="list-page log-page with-tabs">
      <p class="log-intro">What changed in the last 30 days and who made it, newest first. Older changes drop off the log by themselves.</p>
      <div class="list-tools list-tools--static">
        <label class="search">
          ${icon('search')}
          <input type="search" placeholder="Search" value="${esc(state.q)}" aria-label="Search the log by name, ID or words" autocomplete="off">
        </label>
        <div class="filters">
          <div class="segmented" role="group" aria-label="Who made the change">
            ${WHO.map(([key, label]) => `<button type="button" data-who="${key}" aria-pressed="${state.who === key}">${label}</button>`).join('')}
          </div>
        </div>
        <div class="log-selects">
          <select class="class-filter" data-what aria-label="What changed">
            ${WHAT.map(([key, label]) => `<option value="${key}"${state.what === key ? ' selected' : ''}>${label}</option>`).join('')}
          </select>
          <select class="class-filter" data-when aria-label="When">
            ${WHEN.map(([key, label]) => `<option value="${key}"${state.when === key ? ' selected' : ''}>${label}</option>`).join('')}
          </select>
        </div>
      </div>
      <div data-log><p class="list-note">Loading…</p></div>
      <div class="log-more"><button type="button" class="btn btn-quiet" data-more hidden>Show older</button></div>
    </main>
    ${tabBar('home')}`;
  const main = app.querySelector('main');
  let typing = null;
  main.querySelector('input[type="search"]').addEventListener('input', (e) => {
    clearTimeout(typing);
    typing = setTimeout(() => { state.q = e.target.value.trim(); load(true); }, 350);
  });
  main.addEventListener('change', (e) => {
    if (e.target.matches('[data-what]')) state.what = e.target.value;
    else if (e.target.matches('[data-when]')) state.when = e.target.value;
    else return;
    load(true);
  });
  main.addEventListener('click', (e) => {
    const b = e.target.closest('[data-who]');
    if (b) {
      state.who = b.getAttribute('data-who');
      for (const x of main.querySelectorAll('[data-who]')) x.setAttribute('aria-pressed', String(x === b));
      load(true);
      return;
    }
    if (e.target.closest('[data-more]')) load(false);
  });
  load(true);
}

async function load(fresh, tries = 0) {
  const ticket = ++current;
  const host = app.querySelector('[data-log]');
  const more = app.querySelector('[data-more]');
  if (!host) return;
  if (fresh) { next = null; lastDay = ''; }
  more.disabled = true;
  more.textContent = 'Loading…';
  const qs = new URLSearchParams();
  if (state.who !== 'all') qs.set('who', state.who);
  if (state.what !== 'all') qs.set('what', state.what);
  if (state.when !== 'month') qs.set('when', state.when);
  if (state.q) qs.set('q', state.q);
  if (!fresh && next) { qs.set('before', next.before); if (next.skip.length) qs.set('skip', next.skip.join(',')); }
  let data;
  try {
    data = await getJson(`/api/log${qs.toString() ? `?${qs}` : ''}`);
  } catch (err) {
    if (ticket !== current || ui.view !== 'log') return;
    if (fresh) host.innerHTML = `<p class="empty">${esc(err.message)}</p>`;
    more.hidden = false;
    more.disabled = false;
    more.textContent = fresh ? 'Try again' : 'Show older';
    if (fresh) more.onclick = () => { more.onclick = null; load(true); };
    return;
  }
  if (ticket !== current || ui.view !== 'log') return;
  next = data.next;
  const rows = data.items.map(rowHtml).join('');
  if (fresh) {
    host.innerHTML = rows ? `<ol class="log-list">${rows}</ol>` : `<p class="empty">${state.q
      ? `Nothing ${WHEN_WORDS[state.when]} matches “${esc(state.q)}”.`
      : `Nothing changed ${WHEN_WORDS[state.when]}${state.who !== 'all' || state.what !== 'all' ? ' that fits these filters' : ''}.`}</p>`;
  } else if (rows) {
    let list = host.querySelector('.log-list');
    if (!list) { host.innerHTML = '<ol class="log-list"></ol>'; list = host.querySelector('.log-list'); }
    list.insertAdjacentHTML('beforeend', rows);
  }
  more.hidden = !next;
  more.disabled = false;
  more.textContent = 'Show older';
  // A page with nothing to show (only hidden changes) goes straight on to the next one.
  if (!data.items.length && next && tries < 5) load(false, tries + 1);
}

/* ---------------- One line of the log ---------------- */

function rowHtml(item) {
  const at = new Date(item.at);
  const day = at.toDateString();
  let head = '';
  if (day !== lastDay) {
    lastDay = day;
    head = `<li class="log-day"><h2>${esc(dayTitle(at))}</h2></li>`;
  }
  const { what, lines = [] } = describe(item);
  return `${head}
    <li class="log-row">
      <span class="log-time">${esc(at.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' }))}</span>
      <div class="log-main">
        <p class="log-what">${what}</p>
        ${lines.filter(Boolean).map((l) => `<p class="log-sub">${l}</p>`).join('')}
        ${item.who ? `<p class="log-who"><span class="who-dot who-dot--${esc(item.who.role)}" aria-hidden="true"></span><span>${byText(item.who)}</span></p>` : ''}
      </div>
    </li>`;
}

function dayTitle(d) {
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return 'Today';
  const y = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return 'Yesterday';
  return d.toLocaleDateString('en-IN', {
    weekday: 'long', day: 'numeric', month: 'long', ...(d.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}),
  });
}

function byText(who) {
  if (who.role === 'office') return 'By the office';
  const name = who.code ? `<a href="${personLink(who.code)}">${esc(who.name)}</a>` : esc(who.name);
  return `By ${name}, ${who.role}`;
}

function personLink(code) {
  return `#/${String(code).startsWith('TR-') ? 'teachers' : 'students'}/${encodeURIComponent(code)}`;
}

function personHtml(person, fallback = '') {
  if (!person || !person.code) return esc(fallback);
  return `<a href="${personLink(person.code)}">${esc(person.name || fallback)}</a>`;
}

function datesText(from, to) {
  return to && to !== from ? `${shortDate(from)} to ${shortDate(to)}` : shortDate(from);
}

function plural(n, one, many) {
  return `${n} ${n === 1 ? one : many}`;
}

/** What changed (the bold line) and, where it matters, the change itself on the lines under it. */
function describe(item) {
  if (item.source === 'entry' || item.source === 'cancel') return describeEntry(item);
  if (item.source === 'audit') return describeAudit(item);
  if (item.source === 'task') return describeTask(item);
  return describeLeave(item);
}

function teacherLink(d) {
  const name = esc(d.teacher_name || 'a teacher');
  return d.teacher_code ? `<a href="${personLink(d.teacher_code)}">${name}</a>` : name;
}

function describeEntry(item) {
  const e = item.entry;
  const d = e.data || {};
  const form = getForm(e.type);
  const title = esc(form ? form.title : e.type);
  if (e.type === 'portal_message' && item.source === 'entry') {
    const to = d.from === 'Teacher' ? personHtml(item.person, d.student_name || 'a student') : teacherLink(d);
    return { what: `Message to ${to}${d.about ? `: ${esc(d.about)}` : ''}` };
  }
  if (e.type === 'exam' && d.added_by && item.source === 'entry') {
    return { what: `Exam date added: ${esc([d.exam || 'Exam', shortDate(d.starts_on)].filter(Boolean).join(', '))}` };
  }
  const parts = form ? summaryText(form, d) : [];
  const subject = item.person ? personHtml(item.person, parts[0]) : esc(parts[0] || '');
  const rest = parts.slice(1).map(esc).join(', ');
  const body = [subject, rest].filter(Boolean).join(', ');
  if (item.source === 'cancel') {
    return { what: `Cancelled ${title}${body ? `: ${body}` : ''}`, lines: [e.cancel_reason ? `Why: ${esc(e.cancel_reason)}` : ''] };
  }
  return { what: `${title}${body ? `: ${body}` : ''}` };
}

function changeLine(label, from, to) {
  return `${esc(label)}: ${esc(from)} <span aria-hidden="true">→</span><span class="visually-hidden">changed to</span> ${esc(to)}`;
}

function describeAudit(item) {
  const p = item.person || {};
  const word = p.kind === 'teacher' ? 'teacher' : 'student';
  const who = personHtml(p, p.name);
  const d = item.details || {};
  const n = Array.isArray(d.entries) ? d.entries.length : 0;
  if (item.action === 'edit') {
    return { what: `Changed the details of ${who}`, lines: (d.changes || []).map((c) => changeLine(c.label, c.from, c.to)) };
  }
  if (item.action === 'delete') {
    const r = Array.isArray(d.requests) ? d.requests.length : 0;
    return {
      what: `Deleted ${word} ${who}`,
      lines: [
        `Note: ${esc(item.note || '')}`,
        n ? `${plural(n, 'entry', 'entries')} cancelled with it${r ? `, ${plural(r, 'leave request', 'leave requests')} declined` : ''}.` : '',
        p.status === 'Cancelled' ? 'Open their page to restore them.' : '',
      ],
    };
  }
  return { what: `Restored ${word} ${who}`, lines: [n ? `${plural(n, 'entry is', 'entries are')} active again.` : ''] };
}

function taskValue(key, value) {
  if (value === null || value === undefined || value === '') return 'empty';
  if (key === 'start_on' || key === 'due_on') return shortDate(value);
  if (key === 'budget') return money(value);
  return String(value).length > 80 ? `${String(value).slice(0, 79)}…` : String(value);
}

function describeTask(item) {
  const t = item.task;
  const title = esc(t.title || '');
  if (item.action === 'created') return { what: `Task added: ${title}` };
  const b = item.before || {};
  const changed = Object.keys(TASK_LABELS).filter((k) => String(t[k] ?? '') !== String(b[k] ?? ''));
  return {
    what: `${b.stage !== t.stage ? STAGE_WORDS[t.stage] || 'Task moved' : 'Task changed'}: ${title}`,
    lines: changed.map((k) => changeLine(TASK_LABELS[k], taskValue(k, b[k]), taskValue(k, t[k]))),
  };
}

function describeLeave(item) {
  const r = item.request;
  const dates = esc(datesText(r.from, r.to));
  const teacher = personHtml(item.person, item.person && item.person.name);
  if (item.action === 'asked') return { what: `Asked for leave: ${dates}${r.reason ? ` (${esc(r.reason)})` : ''}` };
  if (item.action === 'withdrawn') return { what: `Withdrew a leave request: ${dates}` };
  if (item.action === 'approved') return { what: `Approved leave for ${teacher}: ${dates}` };
  return { what: `Declined leave for ${teacher}: ${dates}`, lines: [r.decision_note ? `Note: ${esc(r.decision_note)}` : ''] };
}
