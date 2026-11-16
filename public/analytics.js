// SuccessPath Classes: the Analytics screen.
// Every number comes from /api/analytics, worked out by the database. Charts are plain HTML:
// each bar shows its value when tapped or focused, and every chart has a "Show as table" view.

import { APP_NAME } from './forms.js';
import { app, ui, store, esc, icon, money, compactMoney, shortDate, timeOf, getJson, topBar, tabBar } from './lib.js';
import { personHref } from './people.js';

const CACHE_KEY = 'sp.analytics.v1';
const SHOW_DUE = 30;

export async function renderAnalytics() {
  ui.view = 'analytics';
  ui.form = null;
  document.title = `Analytics | ${APP_NAME}`;
  app.innerHTML = `
    ${topBar('Analytics')}
    <main class="analytics with-tabs"><p class="list-note">Loading…</p></main>
    ${tabBar('analytics')}`;
  const saved = store.get(CACHE_KEY, null);
  if (saved) draw(saved.data, 'Updating…');
  try {
    const data = await getJson('/api/analytics');
    store.set(CACHE_KEY, { at: Date.now(), data });
    if (ui.view === 'analytics') draw(data, `Updated at ${timeOf(new Date())}.`);
  } catch (err) {
    if (ui.view !== 'analytics') return;
    if (saved) {
      draw(saved.data, `Offline: these numbers are from ${timeOf(new Date(saved.at))}.`);
    } else {
      app.querySelector('main').innerHTML = `
        <p class="empty">${esc(err.message)}</p>
        <button class="btn btn-quiet" type="button" data-retry>Try again</button>`;
      app.querySelector('[data-retry]').addEventListener('click', renderAnalytics);
    }
  }
}

function draw(a, note) {
  const main = app.querySelector('main');
  if (!main) return;
  const now = a.fees[a.fees.length - 1];
  const before = a.fees[a.fees.length - 2];
  const last = a.fees.length - 1;
  const other = a.other_payments || a.fees.map(() => ({ amount: 0 }));
  // Money returned to students who left is money paid out, like teachers' pay.
  const returned = a.refunds || a.fees.map(() => ({ amount: 0 }));
  const anyReturned = returned.some((r) => r.amount > 0);
  const paidOut = (i) => a.teacher_payments[i].amount + other[i].amount + returned[i].amount;
  const mon = a.month_label.split(' ')[0];
  const refundNow = returned[last].amount;
  const names = ['Fees collected', 'Paid to teachers', 'Other payments', ...(anyReturned ? ['Money returned'] : [])];
  const valuesAt = (i) => [a.fees[i].amount, a.teacher_payments[i].amount, other[i].amount, ...(anyReturned ? [returned[i].amount] : [])];
  const prev = a.prev_month_label.split(' ')[0];
  const convPct = a.conversion.enquiries ? Math.round((100 * a.conversion.joined) / a.conversion.enquiries) : 0;

  main.innerHTML = `
    <p class="an-note">${esc(a.month_label)} so far. ${esc(note)}</p>

    <section class="kpis" aria-label="This month">
      ${statTile(`Fees collected in ${mon}`, money(now.amount), `${prev}: ${money(before.amount)}`)}
      ${statTile(`Paid out in ${mon}`, money(paidOut(last)), `Teachers ${money(a.teacher_payments[last].amount)}, other ${money(other[last].amount)}${refundNow ? `, returned ${money(refundNow)}` : ''}`)}
      ${statTile('Active students', String(a.students.active), `${a.this_month.admissions} joined, ${a.this_month.left} left in ${mon}`)}
      ${statTile(`Enquiries in ${mon}`, String(a.this_month.enquiries), `${prev}: ${a.last_month.enquiries}`)}
    </section>

    <section class="card" aria-labelledby="c-money">
      <h2 class="card-title" id="c-money">Money in and out</h2>
      <p class="card-sub">Fees collected, and money paid out to teachers, for other payments${anyReturned ? ' and returned to students' : ''}, ${esc(a.fees[0].label)} to ${esc(a.fees[last].label)}</p>
      <div class="legend">
        ${names.map((n, k) => `<span class="legend-item"><span class="key key--${k + 1}"></span>${esc(n)}</span>`).join('')}
      </div>
      ${columns(a.fees.map((m, i) => ({ label: m.label, short: m.label.split(' ')[0], values: valuesAt(i) })), names)}
      ${table(['Month', ...names, 'Left over'],
        a.fees.map((m, i) => [m.label, ...valuesAt(i).map(money), money(m.amount - paidOut(i))]))}
    </section>

    <section class="card" aria-labelledby="c-other">
      <h2 class="card-title" id="c-other">Other payments in ${esc(mon)}</h2>
      ${bars(a.other_types || [], (r) => r.amount, money, 'payments')}
    </section>

    <section class="card" aria-labelledby="c-due">
      <h2 class="card-title" id="c-due">Fees not paid for ${esc(a.month_label)}</h2>
      <p class="card-sub">Active students who have not paid yet, going by their fee plan</p>
      ${dueList(a.not_paid, a.month_label)}
    </section>

    <section class="card" aria-labelledby="c-class">
      <h2 class="card-title" id="c-class">Active students by class</h2>
      ${bars(a.by_class, (r) => r.n, (n) => String(n), 'students')}
    </section>

    <section class="card" aria-labelledby="c-enq">
      <h2 class="card-title" id="c-enq">Enquiries, last 6 months</h2>
      ${a.conversion.enquiries ? `
        <div class="meter-row">
          <p class="meter-text"><strong>${a.conversion.joined} of ${a.conversion.enquiries}</strong> enquiries joined (${convPct}%)${a.conversion.demo ? `. ${a.conversion.demo} in demo classes now` : ''}</p>
          <span class="meter meter--big" role="img" aria-label="${convPct} percent joined"><span class="meter-fill" style="width:${convPct}%"></span></span>
        </div>
        <h3 class="card-subtitle">Where they heard about us</h3>
        ${bars(a.enquiry_sources, (r) => r.n, (n) => String(n), 'enquiries')}` : '<p class="card-empty">No enquiries in the last 6 months.</p>'}
    </section>

    <section class="card" aria-labelledby="c-marks">
      <h2 class="card-title" id="c-marks">Marks to watch</h2>
      <p class="card-sub">Latest test below 40%, or 10 points or more below the test before</p>
      ${marksList(a.marks_attention)}
    </section>

    <section class="card" aria-labelledby="c-left">
      <h2 class="card-title" id="c-left">Why students left, last 12 months</h2>
      ${bars(a.left_reasons, (r) => r.n, (n) => String(n), 'students')}
    </section>

    <section class="card" aria-labelledby="c-mode">
      <h2 class="card-title" id="c-mode">How fees were paid in ${esc(mon)}</h2>
      ${bars(a.fee_modes, (r) => r.amount, money, 'payments')}
    </section>

    <section class="card" aria-labelledby="c-comp">
      <h2 class="card-title" id="c-comp">Complaints, last 3 months</h2>
      ${bars(a.complaints, (r) => r.n, (n) => String(n), 'complaints')}
    </section>`;
  wireTips(main);
}

function statTile(label, value, context) {
  return `
    <div class="stat">
      <p class="stat-label">${esc(label)}</p>
      <p class="stat-value">${esc(value)}</p>
      <p class="stat-context">${esc(context)}</p>
    </div>`;
}

/* ---------------- Charts ---------------- */

function niceStep(raw) {
  const p = 10 ** Math.floor(Math.log10(raw));
  const f = raw / p;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p;
}

/** Grouped columns on one money axis. groups: [{ label, short, values: [a, b] }] */
function columns(groups, names) {
  const max = Math.max(0, ...groups.flatMap((g) => g.values));
  if (max === 0) return '<p class="card-empty">Nothing recorded in these months yet.</p>';
  const step = niceStep(max / 3);
  const top = Math.ceil(max / step) * step;
  const ticks = [];
  for (let t = 0; t <= top + step / 2; t += step) ticks.push(t);
  return `
    <div class="cols${groups.length > 8 ? ' cols--many' : ''}" role="img" aria-label="Column chart. The table below has the same numbers.">
      <div class="cols-grid" aria-hidden="true">
        ${ticks.map((t) => `<div class="grid-line" style="bottom:${(100 * t) / top}%"><span>${esc(compactMoney(t))}</span></div>`).join('')}
      </div>
      <div class="cols-plot" style="grid-template-columns:repeat(${groups.length},minmax(0,1fr))">
        ${groups.map((g, i) => `
          <div class="col-group${i === groups.length - 1 ? ' is-now' : ''}" tabindex="0"
               data-tip="${esc(`${g.label}: ${names.map((n, k) => `${n} ${money(g.values[k])}`).join(', ')}`)}">
            <div class="col-bars">
              ${g.values.map((v, k) => `<span class="col col--${k + 1}" style="height:${(100 * Math.max(0, v)) / top}%"></span>`).join('')}
            </div>
            <span class="col-x">${esc(g.short)}</span>
          </div>`).join('')}
      </div>
    </div>`;
}

/** Ranked horizontal bars, one colour, value at the end of each bar. */
function bars(rows, value, format, noun) {
  if (!rows || !rows.length) return '<p class="card-empty">Nothing recorded yet.</p>';
  const max = Math.max(...rows.map(value)) || 1;
  return `
    <ul class="hbars">
      ${rows.map((r) => `
        <li class="hbar" tabindex="0" data-tip="${esc(`${r.label}: ${format(value(r))}${r.n && noun === 'payments' ? ` in ${r.n} payments` : ''}`)}">
          <span class="hbar-label">${esc(r.label)}</span>
          <span class="hbar-track">
            <span class="hbar-fill" style="width:calc((100% - 4.5rem) * ${value(r) / max})"></span>
            <span class="hbar-value">${esc(format(value(r)))}</span>
          </span>
        </li>`).join('')}
    </ul>
    ${table(['', noun.charAt(0).toUpperCase() + noun.slice(1)], rows.map((r) => [r.label, format(value(r))]))}`;
}

function table(head, rows) {
  return `
    <details class="as-table">
      <summary>Show as table</summary>
      <div class="table-wrap">
        <table>
          <thead><tr>${head.map((h) => `<th scope="col">${esc(h)}</th>`).join('')}</tr></thead>
          <tbody>${rows.map((r) => `<tr>${r.map((c, i) => (i === 0 ? `<th scope="row">${esc(c)}</th>` : `<td>${esc(c)}</td>`)).join('')}</tr>`).join('')}</tbody>
        </table>
      </div>
    </details>`;
}

/* ---------------- Lists ---------------- */

function dueList(rows, month) {
  if (!rows.length) return `<p class="card-empty">Every active student has paid for ${esc(month)}.</p>`;
  const shown = rows.slice(0, SHOW_DUE);
  return `
    <p class="due-count"><strong>${rows.length}</strong> ${rows.length === 1 ? 'student' : 'students'}</p>
    <ul class="due-list">
      ${shown.map((s) => `
        <li class="due-row">
          <a class="due-main" href="${esc(personHref(s.code))}">
            <strong>${esc(s.name)}</strong>
            <span>${esc([s.class, s.last_paid_on ? `last paid ${shortDate(s.last_paid_on)}` : 'no fee recorded yet', s.plan && s.plan !== 'Monthly' ? s.plan.toLowerCase() : ''].filter(Boolean).join(', '))}</span>
          </a>
          ${s.phone ? `<a class="due-call" href="tel:+91${esc(s.phone)}" aria-label="Call about ${esc(s.name)}">${icon('phone')}</a>` : ''}
        </li>`).join('')}
    </ul>
    ${rows.length > SHOW_DUE ? `<p class="card-sub">And ${rows.length - SHOW_DUE} more. The Students page shows everyone.</p>` : ''}`;
}

function marksList(rows) {
  if (!rows.length) return '<p class="card-empty">No marks need attention right now.</p>';
  return `
    <ul class="due-list">
      ${rows.map((m) => `
        <li class="due-row">
          <a class="due-main" href="${esc(personHref(m.code))}">
            <strong>${esc(m.name)}</strong>
            <span>${esc([m.test, m.subject].filter(Boolean).join(', ') || 'Last test')}: ${esc(m.pct)}%${m.prev_pct !== null && m.prev_pct !== undefined ? `, was ${esc(m.prev_pct)}%` : ''}</span>
          </a>
          <span class="meter" role="img" aria-label="${esc(m.pct)} percent"><span class="meter-fill meter-fill--low" style="width:${Math.max(0, Math.min(100, m.pct))}%"></span></span>
        </li>`).join('')}
    </ul>`;
}

/* ---------------- Values on tap or focus ---------------- */

function wireTips(root) {
  let tip = document.querySelector('.tip');
  if (!tip) {
    tip = document.createElement('div');
    tip.className = 'tip';
    tip.setAttribute('role', 'tooltip');
    tip.hidden = true;
    document.body.appendChild(tip);
  }
  let timer = null;
  const show = (el) => {
    clearTimeout(timer);
    tip.textContent = el.getAttribute('data-tip');
    tip.hidden = false;
    const r = el.getBoundingClientRect();
    const w = tip.offsetWidth;
    const left = Math.min(window.innerWidth - w - 8, Math.max(8, r.left + r.width / 2 - w / 2));
    tip.style.left = `${left}px`;
    tip.style.top = `${Math.max(8, r.top + window.scrollY - tip.offsetHeight - 8)}px`;
    timer = setTimeout(() => { tip.hidden = true; }, 4000);
  };
  const hide = () => { tip.hidden = true; };
  for (const el of root.querySelectorAll('[data-tip]')) {
    el.addEventListener('pointerenter', () => show(el));
    el.addEventListener('pointerleave', hide);
    el.addEventListener('focus', () => show(el));
    el.addEventListener('blur', hide);
    el.addEventListener('click', () => show(el));
  }
}
