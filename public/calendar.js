// SuccessPath Classes: the leave calendar, at the bottom of the Teachers page and in the teacher portal.
//
// For each day of a month it shows how many teachers are free when someone is on leave, and the
// institute's holidays. Tapping a day lists who is on leave and who is free. The office also sees
// leave requests waiting for an answer; a teacher sees their own leave and requests, and only the
// names (not the reasons) of the others.

import { MONTHS, indiaToday } from './forms.js';
import { store, esc, icon, getJson, timeOf, dateFromIso } from './lib.js';

const SAVED_PREFIX = 'sp.calendar.v1.';
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September',
  'October', 'November', 'December'];

// Kept while the app is open, so going to a teacher and back shows the same month and day.
const cal = { month: null, day: null, data: {}, note: {}, failed: {} };
// 'office' (the Teachers page) or 'teacher' (the teacher portal).
let mode = 'office';

export function renderLeaveCalendar(host, options = {}) {
  if (!host) return;
  mode = options.mode === 'teacher' ? 'teacher' : 'office';
  if (!cal.month) cal.month = indiaToday().slice(0, 7);
  host.addEventListener('click', (e) => onClick(e, host));
  draw(host);
  load(host, cal.month);
}

async function load(host, month) {
  try {
    const data = await getJson(mode === 'teacher' ? `/api/portal/teacher/calendar?month=${month}` : `/api/calendar?month=${month}`);
    cal.data[month] = data;
    cal.note[month] = '';
    cal.failed[month] = '';
    store.set(savedKey(month), { at: Date.now(), data });
  } catch (err) {
    const saved = store.get(savedKey(month), null);
    if (saved && saved.data) {
      cal.data[month] = saved.data;
      const when = timeOf(new Date(saved.at));
      cal.note[month] = navigator.onLine === false
        ? `Offline: showing the calendar saved at ${when}.`
        : `Could not refresh (${err.message}) Showing the calendar saved at ${when}.`;
    } else {
      cal.failed[month] = err.message;
    }
  }
  if (document.contains(host) && cal.month === month) draw(host);
}

function savedKey(month) {
  return `${SAVED_PREFIX}${mode === 'teacher' ? 't.' : ''}${month}`;
}

function onClick(e, host) {
  const target = e.target.closest('button');
  if (!target || !host.contains(target)) return;
  if (target.hasAttribute('data-step')) {
    cal.month = shiftMonth(cal.month, Number(target.getAttribute('data-step')));
    cal.day = null;
  } else if (target.hasAttribute('data-this-month')) {
    cal.month = indiaToday().slice(0, 7);
    cal.day = null;
  } else if (target.hasAttribute('data-day')) {
    cal.day = target.getAttribute('data-day');
    draw(host);
    const detail = host.querySelector('[data-detail]');
    if (detail && detail.getBoundingClientRect().top > window.innerHeight - 120) detail.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    return;
  } else if (target.hasAttribute('data-retry')) {
    cal.failed[cal.month] = '';
  } else {
    return;
  }
  draw(host);
  load(host, cal.month);
}

/* ---------------- Drawing ---------------- */

function draw(host) {
  const month = cal.month;
  const [y, m] = month.split('-').map(Number);
  const data = cal.data[month];
  const today = (data && data.today) || indiaToday();
  const thisMonth = today.slice(0, 7);
  const head = `
    <div class="cal-head">
      <h2 class="cal-title" id="cal-title">Leave and holidays</h2>
      <div class="cal-nav">
        <button type="button" class="cal-step" data-step="-1" aria-label="Previous month">${icon('back')}</button>
        <span class="cal-month">${esc(MONTH_NAMES[m - 1])} ${y}</span>
        <button type="button" class="cal-step" data-step="1" aria-label="Next month">${icon('chevron')}</button>
      </div>
    </div>
    ${month !== thisMonth ? '<button type="button" class="linkish cal-back" data-this-month>Back to this month</button>' : ''}`;
  const askFrom = cal.day && cal.day >= today ? `?from=${cal.day}` : '';
  const actions = mode === 'teacher'
    ? `
    <div class="cal-actions cal-actions--one">
      <a class="btn btn-primary" href="#/leave/new${askFrom}">${icon('leave')}<span>Request leave${askFrom ? ` from ${esc(dayMonth(cal.day))}` : ''}</span></a>
    </div>`
    : `
    <div class="cal-actions">
      <a class="btn btn-quiet" href="#/new/leave">${icon('leave')}<span>Book leave</span></a>
      <a class="btn btn-quiet" href="#/new/holiday">${icon('holiday')}<span>Add holiday</span></a>
    </div>`;

  if (!data) {
    const failed = cal.failed[month];
    host.innerHTML = `${head}
      <p class="cal-note">${failed
        ? `${esc(failed)} <button type="button" class="linkish" data-retry>Try again</button>`
        : navigator.onLine === false ? 'Connect to the internet to see the calendar.' : 'Loading…'}</p>
      ${actions}`;
    return;
  }

  const days = new Date(y, m, 0).getDate();
  const offset = (new Date(y, m - 1, 1).getDay() + 6) % 7;
  const isoOf = (d) => `${month}-${String(d).padStart(2, '0')}`;
  if (!cal.day || cal.day.slice(0, 7) !== month) cal.day = defaultDay(data, month, today, days, isoOf);

  const cells = [];
  for (let i = 0; i < offset; i += 1) cells.push('<span class="cal-blank" aria-hidden="true"></span>');
  for (let d = 1; d <= days; d += 1) {
    const iso = isoOf(d);
    const info = dayInfo(data, iso);
    const classes = ['cal-day'];
    if (iso === today) classes.push('is-today');
    if (iso < today) classes.push('is-past');
    if (info.holiday) classes.push('is-holiday');
    else if (info.away.length) classes.push('has-leave');
    if (info.mine) classes.push('is-mine');
    else if (info.asked.length) classes.push('is-asked');
    let mark = '';
    let said = info.staff.length ? `all ${info.staff.length} teachers free` : '';
    if (info.holiday) {
      mark = '<span class="cal-mark">Closed</span>';
      said = `holiday, ${info.holiday.name || 'closed'}`;
    } else if (info.mine && mode === 'teacher') {
      mark = '<span class="cal-mark">You</span>';
      said = `${info.free.length} of ${info.staff.length} teachers free`;
    } else if (info.away.length) {
      mark = `<span class="cal-mark">${info.free.length}/${info.staff.length}</span>`;
      said = `${info.away.length} on leave, ${info.free.length} of ${info.staff.length} teachers free`;
    }
    if (info.mine) said += ', you are on leave';
    else if (info.asked.length) said += mode === 'teacher' ? ', you asked for leave' : `, ${info.asked.length} asked for leave`;
    const label = [longDay(iso), said].filter(Boolean).join(', ');
    cells.push(`
      <button type="button" class="${classes.join(' ')}" data-day="${iso}" aria-pressed="${iso === cal.day}" aria-label="${esc(label)}">
        <span class="cal-num">${d}</span>${mark}
      </button>`);
  }

  host.innerHTML = `${head}
    ${cal.note[month] ? `<p class="cal-note">${esc(cal.note[month])}</p>` : ''}
    <div class="cal-grid">
      ${WEEKDAYS.map((w) => `<span class="cal-weekday" aria-hidden="true">${w}</span>`).join('')}
      ${cells.join('')}
    </div>
    <p class="cal-legend">
      <span class="cal-legend-item"><span class="cal-key cal-key--leave">3/4</span> teachers free on a day with leave</span>
      <span class="cal-legend-item"><span class="cal-key cal-key--holiday">Closed</span> holiday</span>
      ${mode === 'teacher'
        ? `<span class="cal-legend-item"><span class="cal-key cal-key--mine">You</span> your leave</span>
      <span class="cal-legend-item"><span class="cal-key cal-key--asked">5</span> you asked, waiting</span>`
        : '<span class="cal-legend-item"><span class="cal-key cal-key--asked">5</span> leave asked for, waiting</span>'}
    </p>
    <div class="cal-detail" data-detail aria-live="polite">${detailHtml(data, cal.day)}</div>
    ${actions}`;
}

function defaultDay(data, month, today, days, isoOf) {
  if (today.slice(0, 7) === month) return today;
  for (let d = 1; d <= days; d += 1) {
    const info = dayInfo(data, isoOf(d));
    if (info.holiday || info.away.length) return isoOf(d);
  }
  return isoOf(1);
}

function detailHtml(data, iso) {
  const info = dayInfo(data, iso);
  let html = `<h3 class="cal-detail-title">${esc(longDay(iso))}</h3>`;
  if (info.holiday) {
    const h = info.holiday;
    const span = h.from === h.to ? '' : `, ${dayMonth(h.from)} to ${dayMonth(h.to)}`;
    html += `<p class="cal-closed">${icon('holiday')}<span><strong>${esc(h.name || 'Holiday')}</strong>${esc(span)}. The institute is closed.${h.notes ? ` ${esc(h.notes)}` : ''}</span></p>`;
  }
  if (!info.holiday) {
    if (!info.staff.length && !info.away.length) {
      html += '<p class="cal-count">No teachers in the register yet.</p>';
    } else if (!info.away.length) {
      html += `<p class="cal-count">Nobody is on leave. <strong>All ${info.staff.length}</strong> ${info.staff.length === 1 ? 'teacher is' : 'teachers are'} free.</p>`;
    } else {
      html += `<p class="cal-count"><strong>${info.free.length} of ${info.staff.length}</strong> ${info.staff.length === 1 ? 'teacher' : 'teachers'} free.</p>`;
    }
  }
  if (info.mine) html += '<p class="cal-you">You are on leave this day.</p>';
  if (info.asked.length) {
    html += mode === 'teacher'
      ? `<p class="cal-you cal-you--asked">You asked for leave this day. Waiting for the office.</p>`
      : `<h4 class="cal-sub">Asked for leave, waiting for you</h4><ul class="cal-away">${info.asked.map(awayRow).join('')}</ul>`;
  }
  if (info.declined.length && mode === 'teacher') {
    html += `<p class="cal-you cal-you--no">Your request for this day was declined.</p>`;
  }
  if (info.away.length) {
    html += `<h4 class="cal-sub">On leave</h4><ul class="cal-away">${info.away.map(awayRow).join('')}</ul>`;
  }
  if (!info.holiday && info.away.length && info.free.length) {
    html += `<h4 class="cal-sub">Free</h4><p class="cal-free">${info.free.map(teacherLink).join(', ')}</p>`;
  }
  return html;
}

function awayRow(l) {
  const span = l.from === l.to ? 'One day' : `${dayMonth(l.from)} to ${dayMonth(l.to)}`;
  const why = [l.reason, span, l.notes].filter(Boolean).join('. ');
  return `<li><span class="cal-away-name">${l.person_code ? teacherLink({ code: l.person_code, name: l.name }) : esc(l.name || 'Teacher')}</span>
    <span class="cal-away-why">${esc(why)}</span></li>`;
}

function teacherLink(t) {
  if (mode === 'teacher') return esc(t.name || t.code);
  return `<a href="#/teachers/${esc(t.code)}">${esc(t.name || t.code)}</a>`;
}

/** Holiday, who is on leave, who is on the staff that day, and who of them is free. */
function dayInfo(data, iso) {
  const holiday = (data.holidays || []).find((h) => h.from <= iso && iso <= h.to) || null;
  const seen = new Set();
  const away = (data.leaves || [])
    .filter((l) => l.from && l.to && l.from <= iso && iso <= l.to)
    .filter((l) => {
      const key = l.person_code || (l.name || '').toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  const awayCodes = new Set(away.map((l) => l.person_code).filter(Boolean));
  const staff = (data.teachers || []).filter((t) => onStaff(t, iso));
  const free = staff.filter((t) => !awayCodes.has(t.code));
  const covering = (r) => r.from && r.to && r.from <= iso && iso <= r.to;
  const asked = (data.requests || []).filter((r) => r.status === 'Pending' && covering(r));
  const declined = (data.requests || []).filter((r) => r.status === 'Declined' && covering(r));
  const mine = Boolean(data.me && awayCodes.has(data.me));
  return { holiday, away, staff, free, asked, declined, mine };
}

// A teacher counts from their joining date (if known) until their last working day.
function onStaff(t, iso) {
  if (t.joined_on && t.joined_on > iso) return false;
  if (t.status === 'Left') return Boolean(t.left_on) && t.left_on >= iso;
  return true;
}

/* ---------------- Dates ---------------- */

function shiftMonth(yyyymm, by) {
  const [y, m] = yyyymm.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + by, 1));
  return d.toISOString().slice(0, 7);
}

function longDay(iso) {
  const d = dateFromIso(iso);
  return d.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' });
}

function dayMonth(iso) {
  const d = dateFromIso(iso);
  return Number.isNaN(d.getTime()) ? '' : `${d.getDate()} ${MONTHS[d.getMonth()]}`;
}
