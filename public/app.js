// SuccessPath Classes: the data entry page.
// The forms themselves are described in forms.js; this file draws them and sends entries.
//
// How an entry travels:
//   1. It is checked on the device, then kept in the device's outbox (so nothing is lost).
//   2. It is sent to the server. If the internet is down, it waits and is sent automatically later.
//   3. The server checks it again, saves it and returns its entry number, for example FEE-0012.

import { APP_NAME, APP_VERSION, FORMS, GROUPS, getForm, validateEntry, localToday } from './forms.js';

const OUTBOX_KEY = 'sp.outbox.v1';
const RECENT_KEY = 'sp.recent.v1';
const DRAFT_PREFIX = 'sp.draft.v1.';
const RECENT_LIMIT = 25;
const SEND_TIMEOUT_MS = 20000;
const RETRY_EVERY_MS = 20000;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const app = document.getElementById('app');
const live = document.getElementById('live');
let currentView = '';
let currentForm = null;
let draftTimer = null;
let flushing = false;

/* ------------------------------------------------------------------ */
/* Storage on this device. Never throws; falls back to memory.         */
/* ------------------------------------------------------------------ */

const memory = new Map();
const store = {
  get(key, fallback) {
    if (memory.has(key)) return memory.get(key);
    try {
      const raw = localStorage.getItem(key);
      if (raw !== null) return JSON.parse(raw);
    } catch (e) { /* storage blocked: use the fallback */ }
    return fallback;
  },
  set(key, value) {
    memory.set(key, value);
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* the memory copy still works */ }
  },
  remove(key) {
    memory.delete(key);
    try { localStorage.removeItem(key); } catch (e) { /* nothing to do */ }
  },
};

const outbox = {
  all() { return store.get(OUTBOX_KEY, []); },
  add(entry) {
    const list = this.all().filter((e) => e.client_id !== entry.client_id);
    list.push(entry);
    store.set(OUTBOX_KEY, list);
  },
  remove(id) { store.set(OUTBOX_KEY, this.all().filter((e) => e.client_id !== id)); },
};

const recent = {
  all() { return store.get(RECENT_KEY, []); },
  get(id) { return this.all().find((r) => r.id === id) || null; },
  put(item) {
    const list = [item, ...this.all().filter((r) => r.id !== item.id)];
    let kept = 0;
    // Keep the newest entries, and always keep ones that still need attention.
    store.set(RECENT_KEY, list.filter((r) => {
      const keep = r.state === 'pending' || r.state === 'failed' || kept < RECENT_LIMIT;
      if (keep) kept += 1;
      return keep;
    }));
  },
  update(id, patch) {
    const list = this.all();
    const i = list.findIndex((r) => r.id === id);
    if (i < 0) return null;
    list[i] = { ...list[i], ...patch };
    store.set(RECENT_KEY, list);
    return list[i];
  },
  remove(id) { store.set(RECENT_KEY, this.all().filter((r) => r.id !== id)); },
};

/* ------------------------------------------------------------------ */
/* Small helpers                                                        */
/* ------------------------------------------------------------------ */

function esc(value) {
  return String(value === undefined || value === null ? '' : value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function randomHex(bytes) {
  const a = new Uint8Array(bytes);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('');
}

function newId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const h = randomHex(16);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

function money(n) {
  return `₹${Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
}

function dateFromIso(iso) {
  const [y, m, d] = String(iso).split('-').map(Number);
  return new Date(y, m - 1, d);
}

function shortDate(iso) {
  const d = dateFromIso(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

function timeOf(date) {
  return date.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
}

function whenSaved(isoTime) {
  const d = new Date(isoTime);
  if (Number.isNaN(d.getTime())) return '';
  const today = new Date();
  const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return `Today, ${timeOf(d)}`;
  if (d.toDateString() === yesterday.toDateString()) return `Yesterday, ${timeOf(d)}`;
  return `${d.getDate()} ${MONTHS[d.getMonth()]}, ${timeOf(d)}`;
}

function longDate(d) {
  return d.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

function displayValue(field, value) {
  if (value === undefined || value === null || value === '') return '';
  if (field.kind === 'money') return money(value);
  if (field.kind === 'date') return shortDate(value);
  if (Array.isArray(value)) return value.join(', ');
  return String(value);
}

function announce(message) {
  live.textContent = '';
  setTimeout(() => { live.textContent = message; }, 50);
}

function toast(message) {
  announce(message);
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = message;
  document.body.appendChild(el);
  setTimeout(() => el.classList.add('toast--out'), 2800);
  setTimeout(() => el.remove(), 3300);
}

/* ------------------------------------------------------------------ */
/* Icons (drawn for this app)                                          */
/* ------------------------------------------------------------------ */

const ICONS = {
  fee: '<path d="M7 4.5h10M7 9h10M9.2 4.5c3.4 0 5.1 1.7 5.1 4.5s-1.7 4.6-5.1 4.6H7l7.6 6.9"/>',
  enquiry: '<path d="M4.5 5.5h15v10.5H10l-5.5 4v-4z"/><path d="M10.2 9.2a1.9 1.9 0 1 1 2.6 1.8c-.6.3-.9.7-.9 1.3"/><path d="M11.9 14.3h.01"/>',
  admission: '<circle cx="9.5" cy="8" r="3.3"/><path d="M3.5 19.5c.7-3.4 3.1-5.4 6-5.4s5.3 2 6 5.4"/><path d="M18.5 7.5v6M15.5 10.5h6"/>',
  student_left: '<circle cx="9.5" cy="8" r="3.3"/><path d="M3.5 19.5c.7-3.4 3.1-5.4 6-5.4s5.3 2 6 5.4"/><path d="M15.5 10.5h6M19 8l2.5 2.5L19 13"/>',
  teacher: '<rect x="9.5" y="4" width="11" height="8" rx="1"/><circle cx="6" cy="10" r="2.4"/><path d="M2.5 20c.4-3.1 1.8-5 3.5-5s3.1 1.9 3.5 5"/><path d="M8 14l4.5-3"/>',
  teacher_left: '<path d="M13.5 4.5h-7v15h7"/><path d="M10.5 12h10M17.5 9l3 3-3 3"/>',
  complaint: '<path d="M12 4.2l8.6 15.3H3.4z"/><path d="M12 10v4.2M12 17.1h.01"/>',
  entry: '<rect x="5" y="3.5" width="14" height="17" rx="2"/><path d="M8.5 8h7M8.5 12h7M8.5 16h4"/>',
  back: '<path d="M15 5l-7 7 7 7"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
};

function icon(name) {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${ICONS[name] || ICONS.entry}</svg>`;
}

/* ------------------------------------------------------------------ */
/* Online status                                                        */
/* ------------------------------------------------------------------ */

function statusInner() {
  const waiting = outbox.all().length;
  const online = navigator.onLine !== false;
  if (waiting > 0) {
    const what = `${waiting} waiting`;
    return `<span class="dot dot--warn"></span>${online ? what : `Offline, ${what}`}`;
  }
  return online ? '<span class="dot dot--ok"></span>Online' : '<span class="dot dot--off"></span>Offline';
}

function updateStatus() {
  for (const el of document.querySelectorAll('[data-status]')) el.innerHTML = statusInner();
}

/* ------------------------------------------------------------------ */
/* Screens                                                              */
/* ------------------------------------------------------------------ */

function route() {
  closePanel(false);
  const parts = location.hash.replace(/^#\/?/, '').split('/');
  const form = parts[0] === 'new' ? getForm(parts[1]) : null;
  if (form) renderForm(form);
  else if (parts[0] === 'saved' && parts[1]) renderSaved(decodeURIComponent(parts[1]));
  else renderHome();
}

// Re-draws the screen after background changes, without disturbing a form being typed.
function refresh() {
  updateStatus();
  if (currentView === 'home') renderHome(true);
  if (currentView === 'saved') route();
}

function renderHome(keepScroll) {
  currentView = 'home';
  currentForm = null;
  document.title = APP_NAME;
  const scroll = window.scrollY;
  const items = recent.all();
  app.innerHTML = `
    <header class="masthead">
      <div class="masthead-row">
        <h1 class="brand">${esc(APP_NAME)}</h1>
        <span class="status" data-status>${statusInner()}</span>
      </div>
      <p class="masthead-date">${esc(longDate(new Date()))}</p>
    </header>
    <main class="home">
      ${GROUPS.map((group) => {
        const forms = FORMS.filter((f) => f.group === group);
        if (!forms.length) return '';
        return `
        <section class="group" aria-labelledby="group-${esc(group)}">
          <h2 class="section-title" id="group-${esc(group)}">${esc(group)}</h2>
          <div class="tiles">${forms.map(tileHtml).join('')}</div>
        </section>`;
      }).join('')}
      <section class="recent" aria-labelledby="recent-title">
        <h2 class="section-title" id="recent-title">Saved on this device</h2>
        ${items.length
          ? `<ul class="recent-list">${items.map(recentItemHtml).join('')}</ul>`
          : '<p class="empty">Nothing saved from this device yet. Entries you save will be listed here so you can check them.</p>'}
      </section>
    </main>
    <footer class="foot">Version ${esc(APP_VERSION)}</footer>`;
  for (const button of app.querySelectorAll('[data-open]')) {
    button.addEventListener('click', () => openPanel(button.getAttribute('data-open')));
  }
  if (keepScroll) window.scrollTo(0, scroll);
}

function tileHtml(form) {
  return `
    <a class="tile" href="#/new/${esc(form.type)}" style="--tile:${esc(form.color)}">
      <span class="tile-icon">${icon(form.type)}</span>
      <span class="tile-label">${esc(form.title)}</span>
    </a>`;
}

function summaryText(form, data) {
  return (form.summary || [])
    .map((key) => {
      const field = form.fields.find((f) => f.key === key);
      return field ? displayValue(field, data[key]) : '';
    })
    .filter(Boolean);
}

function stateLabel(item) {
  if (item.state === 'saved') return esc(item.code);
  if (item.state === 'pending') return 'Waiting';
  if (item.state === 'failed') return 'Not saved';
  if (item.state === 'cancelled') return `<s>${esc(item.code)}</s>`;
  return '';
}

function recentItemHtml(item) {
  const form = getForm(item.type);
  if (!form) return '';
  const parts = summaryText(form, item.data || {});
  const title = parts.shift() || form.title;
  const sub = [form.title, ...parts.slice(0, 1)].join(', ');
  return `
    <li>
      <button class="recent-item" type="button" data-open="${esc(item.id)}">
        <span class="recent-icon" style="--tile:${esc(form.color)}">${icon(form.type)}</span>
        <span class="recent-text">
          <span class="recent-title">${esc(title)}</span>
          <span class="recent-sub">${esc(sub)}</span>
          <span class="recent-time">${esc(whenSaved(item.at))}</span>
        </span>
        <span class="recent-state recent-state--${esc(item.state)}">${stateLabel(item)}</span>
      </button>
    </li>`;
}

/* ---------------- The form screen ---------------- */

function defaultValues(form) {
  const values = {};
  for (const field of form.fields) {
    if (field.default === 'today') values[field.key] = localToday();
    else if (field.default !== undefined) values[field.key] = field.default;
    else values[field.key] = field.kind === 'months' ? [] : '';
  }
  return values;
}

// Turns saved data back into what the form inputs expect.
function toFormValues(form, data) {
  const values = defaultValues(form);
  for (const field of form.fields) {
    const v = data[field.key];
    if (v === undefined || v === null) continue;
    if (field.kind === 'months') values[field.key] = Array.isArray(v) ? v : String(v).split(',').map((x) => x.trim()).filter(Boolean);
    else values[field.key] = String(v);
  }
  return values;
}

function monthChoices(selected) {
  const now = new Date();
  const list = ['Admission fee'];
  for (let k = -1; k <= 2; k += 1) {
    const d = new Date(now.getFullYear(), now.getMonth() + k, 1);
    list.push(`${MONTHS[d.getMonth()]} ${d.getFullYear()}`);
  }
  for (const s of selected) if (!list.includes(s)) list.push(s);
  return list;
}

function fieldHtml(field, value) {
  const id = `f-${field.key}`;
  const star = field.required ? '<span class="req" aria-hidden="true">*</span>' : '';
  const hintId = field.hint ? `${id}-hint` : '';
  const errId = `${id}-err`;
  const describedBy = [hintId, errId].filter(Boolean).join(' ');
  const hint = field.hint ? `<p class="hint" id="${hintId}">${esc(field.hint)}</p>` : '';
  const error = `<p class="field-error" id="${errId}" hidden></p>`;
  const required = field.required ? ' aria-required="true"' : '';
  const common = `id="${id}" name="${esc(field.key)}" aria-describedby="${describedBy}"${required}`;
  const placeholder = field.placeholder ? ` placeholder="${esc(field.placeholder)}"` : '';
  const label = `<label class="label" for="${id}">${esc(field.label)}${star}</label>`;
  const wrap = (inner) => `<div class="field" data-field="${esc(field.key)}">${inner}${hint}${error}</div>`;
  const v = value === undefined || value === null ? '' : value;

  switch (field.kind) {
    case 'name':
      return wrap(`${label}<input ${common} type="text" autocapitalize="words" autocomplete="off" spellcheck="false" maxlength="80"${placeholder} value="${esc(v)}">`);
    case 'text':
      return wrap(`${label}<input ${common} type="text" autocomplete="off" maxlength="120"${placeholder} value="${esc(v)}">`);
    case 'phone':
      return wrap(`${label}<input ${common} type="tel" inputmode="tel" autocomplete="off" maxlength="16" placeholder="10-digit number" value="${esc(v)}">`);
    case 'date':
      return wrap(`${label}<input ${common} type="date" min="2000-01-01" max="2099-12-31" value="${esc(v)}">`);
    case 'money':
      return wrap(`${label}<div class="money"><span class="money-sign" aria-hidden="true">₹</span><input ${common} type="text" inputmode="decimal" autocomplete="off" maxlength="14" placeholder="0" value="${esc(v)}"></div>`);
    case 'textarea':
      return wrap(`${label}<textarea ${common} rows="3" maxlength="1000"${placeholder}>${esc(v)}</textarea>`);
    case 'select':
      return wrap(`${label}<select ${common}>
          <option value="">Choose</option>
          ${field.options.map((o) => `<option${o === v ? ' selected' : ''}>${esc(o)}</option>`).join('')}
        </select>`);
    case 'choice':
    case 'months': {
      const multi = field.kind === 'months';
      const selected = multi ? (Array.isArray(v) ? v : String(v).split(',').map((x) => x.trim()).filter(Boolean)) : [v];
      const options = multi ? monthChoices(selected) : field.options;
      const pills = options.map((o, i) => `
          <label class="pill${multi ? ' pill--multi' : ''}">
            <input type="${multi ? 'checkbox' : 'radio'}" name="${esc(field.key)}" value="${esc(o)}" id="${i === 0 ? id : `${id}-${i}`}"${selected.includes(o) ? ' checked' : ''}>
            <span>${esc(o)}</span>
          </label>`).join('');
      return `
        <fieldset class="field" data-field="${esc(field.key)}" aria-describedby="${describedBy}">
          <legend class="label">${esc(field.label)}${star}</legend>
          <div class="pills">${pills}</div>
          ${hint}${error}
        </fieldset>`;
    }
    default:
      return '';
  }
}

function collectValues(form, formEl) {
  const values = {};
  for (const field of form.fields) {
    if (field.kind === 'choice') {
      const checked = formEl.querySelector(`input[name="${field.key}"]:checked`);
      values[field.key] = checked ? checked.value : '';
    } else if (field.kind === 'months') {
      values[field.key] = Array.from(formEl.querySelectorAll(`input[name="${field.key}"]:checked`), (c) => c.value);
    } else {
      const el = formEl.elements.namedItem(field.key);
      values[field.key] = el ? el.value : '';
    }
  }
  return values;
}

function isUntouched(form, values) {
  const defaults = defaultValues(form);
  return form.fields.every((f) => JSON.stringify(values[f.key]) === JSON.stringify(defaults[f.key]));
}

function saveDraftNow() {
  if (currentView !== 'form' || !currentForm) return;
  clearTimeout(draftTimer);
  const formEl = app.querySelector('form.entry');
  if (!formEl) return;
  const values = collectValues(currentForm, formEl);
  if (isUntouched(currentForm, values)) store.remove(DRAFT_PREFIX + currentForm.type);
  else store.set(DRAFT_PREFIX + currentForm.type, { values, at: Date.now() });
}

function scheduleDraftSave() {
  clearTimeout(draftTimer);
  draftTimer = setTimeout(saveDraftNow, 300);
}

function showErrors(formEl, errors) {
  let first = null;
  for (const [key, message] of Object.entries(errors || {})) {
    const box = formEl.querySelector(`[data-field="${key}"]`);
    if (!box) continue;
    box.classList.add('has-error');
    const p = box.querySelector('.field-error');
    p.textContent = message;
    p.hidden = false;
    for (const input of box.querySelectorAll('input, select, textarea')) input.setAttribute('aria-invalid', 'true');
    if (!first) first = box;
  }
  if (first) {
    first.scrollIntoView({ block: 'center', behavior: 'smooth' });
    const input = first.querySelector('input, select, textarea');
    if (input) setTimeout(() => input.focus({ preventScroll: true }), 250);
  }
}

function clearFieldError(target) {
  const box = target && target.closest ? target.closest('[data-field]') : null;
  if (!box || !box.classList.contains('has-error')) return;
  box.classList.remove('has-error');
  box.querySelector('.field-error').hidden = true;
  for (const input of box.querySelectorAll('[aria-invalid]')) input.removeAttribute('aria-invalid');
}

function renderForm(form) {
  currentView = 'form';
  currentForm = form;
  document.title = `${form.title} | ${APP_NAME}`;
  const draft = store.get(DRAFT_PREFIX + form.type, null);
  const values = draft && draft.values ? { ...defaultValues(form), ...draft.values } : defaultValues(form);
  const notice = draft
    ? `<p class="notice">${esc(draft.note || 'Your unfinished entry is back.')} <button type="button" class="linkish" data-action="restart">Clear the form</button></p>`
    : '';
  app.innerHTML = `
    <header class="bar">
      <a class="bar-back" href="#/" aria-label="Back to the home screen">${icon('back')}</a>
      <h1 class="bar-title">${esc(form.title)}</h1>
      <span class="status" data-status>${statusInner()}</span>
    </header>
    <main class="paper">
      <form class="entry" novalidate autocomplete="off">
        <div class="entry-lines" style="--tile:${esc(form.color)}">
          ${notice}
          <p class="req-note"><span class="req" aria-hidden="true">*</span> must be filled in</p>
          ${form.fields.map((f) => fieldHtml(f, values[f.key])).join('')}
          <div class="hp" aria-hidden="true"><label>Leave empty <input type="text" name="website" tabindex="-1" autocomplete="off"></label></div>
        </div>
        <div class="actions">
          <p class="form-error" role="alert" hidden></p>
          <button class="btn btn-primary" type="submit">${esc(form.button)}</button>
        </div>
      </form>
    </main>`;
  window.scrollTo(0, 0);

  const formEl = app.querySelector('form.entry');
  formEl.addEventListener('input', (e) => { clearFieldError(e.target); scheduleDraftSave(); });
  formEl.addEventListener('change', (e) => { clearFieldError(e.target); scheduleDraftSave(); });
  formEl.addEventListener('submit', (e) => { e.preventDefault(); submitForm(form, formEl); });
  const restart = formEl.querySelector('[data-action="restart"]');
  if (restart) {
    restart.addEventListener('click', () => {
      store.remove(DRAFT_PREFIX + form.type);
      renderForm(form);
    });
  }
  if (draft && (draft.errors || draft.message)) {
    if (draft.message) {
      const box = formEl.querySelector('.form-error');
      box.textContent = draft.message;
      box.hidden = false;
    }
    showErrors(formEl, draft.errors);
    store.set(DRAFT_PREFIX + form.type, { values: draft.values, at: Date.now(), note: draft.note });
  }
}

/* ---------------- Saving ---------------- */

async function postJson(url, body) {
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), SEND_TIMEOUT_MS) : null;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-successpath': '1' },
      body: JSON.stringify(body),
      cache: 'no-store',
      signal: controller ? controller.signal : undefined,
    });
    let data = null;
    try { data = await res.json(); } catch (e) { /* not JSON */ }
    return { status: res.status, data };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// Returns { result: 'saved' | 'retry' | 'rejected', ... }
async function sendEntry(entry) {
  let res;
  try {
    res = await postJson('/api/entries', {
      client_id: entry.client_id,
      cancel_token: entry.cancel_token,
      type: entry.type,
      data: entry.data,
    });
  } catch (e) {
    return { result: 'retry' };
  }
  if ((res.status === 200 || res.status === 201) && res.data && res.data.ok) {
    outbox.remove(entry.client_id);
    recent.update(entry.client_id, { state: 'saved', code: res.data.entry.code, savedAt: res.data.entry.created_at });
    return { result: 'saved', code: res.data.entry.code };
  }
  if (res.status === 400 || res.status === 409 || res.status === 422) {
    return {
      result: 'rejected',
      message: (res.data && res.data.error) || 'This entry was not accepted.',
      fields: (res.data && res.data.fields) || {},
    };
  }
  return { result: 'retry' };
}

async function submitForm(form, formEl) {
  const button = formEl.querySelector('button[type="submit"]');
  if (button.disabled) return;
  const errorBox = formEl.querySelector('.form-error');
  errorBox.hidden = true;
  if (formEl.elements.namedItem('website').value) return;

  const values = collectValues(form, formEl);
  const checked = validateEntry(form, values, localToday());
  if (!checked.ok) {
    showErrors(formEl, checked.errors);
    return;
  }

  button.disabled = true;
  button.textContent = 'Saving…';
  const entry = {
    client_id: newId(),
    cancel_token: randomHex(16),
    type: form.type,
    data: checked.data,
    at: new Date().toISOString(),
  };
  // Keep it on the device first, so it survives a closed tab or a lost connection.
  outbox.add(entry);
  recent.put({ id: entry.client_id, type: form.type, data: checked.data, state: 'pending', at: entry.at, token: entry.cancel_token });
  clearTimeout(draftTimer);
  store.remove(DRAFT_PREFIX + form.type);
  updateStatus();

  const sent = await sendEntry(entry);
  if (sent.result === 'rejected') {
    outbox.remove(entry.client_id);
    recent.remove(entry.client_id);
    store.set(DRAFT_PREFIX + form.type, { values, at: Date.now() });
    button.disabled = false;
    button.textContent = form.button;
    errorBox.textContent = sent.message;
    errorBox.hidden = false;
    showErrors(formEl, sent.fields);
    updateStatus();
    return;
  }
  location.replace(`#/saved/${encodeURIComponent(entry.client_id)}`);
}

async function flushOutbox() {
  if (flushing) return;
  const queue = outbox.all();
  if (!queue.length) return;
  flushing = true;
  try {
    for (const entry of queue) {
      const sent = await sendEntry(entry);
      if (sent.result === 'retry') break;
      if (sent.result === 'saved') toast(`${sent.code} saved`);
      if (sent.result === 'rejected') {
        outbox.remove(entry.client_id);
        recent.update(entry.client_id, { state: 'failed', error: sent.message, fields: sent.fields });
        toast('One entry needs fixing. See "Saved on this device".');
      }
    }
  } finally {
    flushing = false;
    refresh();
  }
}

/* ---------------- The saved screen ---------------- */

function stampFor(item) {
  switch (item.state) {
    case 'saved': {
      const when = whenSaved(item.savedAt || item.at);
      const phrase = /^(Today|Yesterday)/.test(when) ? when.charAt(0).toLowerCase() + when.slice(1) : `on ${when}`;
      return { cls: 'ok', big: item.code, word: 'Saved', text: `Saved ${phrase}.` };
    }
    case 'pending':
      return { cls: 'warn', big: 'Waiting', word: 'for internet', text: 'No connection right now. This entry is kept on this device and will be sent by itself when the internet is back. You can carry on.' };
    case 'failed':
      return { cls: 'bad', big: 'Not saved', word: 'needs fixing', text: item.error || 'This entry was not accepted.' };
    case 'cancelled':
      return { cls: 'muted', big: item.code, word: 'Cancelled', text: `Reason: ${item.cancelReason || 'not given'}` };
    default:
      return { cls: 'muted', big: '', word: '', text: '' };
  }
}

function linesHtml(form, item) {
  const rows = form.fields
    .map((field) => ({ field, value: displayValue(field, (item.data || {})[field.key]) }))
    .filter((row) => row.value !== '')
    .map((row) => `<div><dt>${esc(row.field.label)}</dt><dd>${esc(row.value)}</dd></div>`);
  return `<dl class="lines">${rows.join('')}</dl>`;
}

function renderSaved(id) {
  const item = recent.get(id);
  const form = item ? getForm(item.type) : null;
  if (!item || !form) {
    location.replace('#/');
    return;
  }
  currentView = 'saved';
  currentForm = null;
  document.title = `${form.title} | ${APP_NAME}`;
  const s = stampFor(item);
  app.innerHTML = `
    <header class="bar">
      <a class="bar-back" href="#/" data-replace aria-label="Back to the home screen">${icon('back')}</a>
      <h1 class="bar-title">${esc(form.title)}</h1>
      <span class="status" data-status>${statusInner()}</span>
    </header>
    <main class="paper paper--receipt">
      <section class="receipt" aria-label="Entry ${esc(s.big)}">
        <p class="receipt-org">${esc(APP_NAME)}</p>
        <div class="stamp stamp--${s.cls}">
          <span class="stamp-big">${esc(s.big)}</span>
          <span class="stamp-word">${esc(s.word)}</span>
        </div>
        <p class="receipt-text">${esc(s.text)}</p>
        ${linesHtml(form, item)}
      </section>
      <div class="actions actions--stack">
        ${item.state === 'failed'
          ? '<button class="btn btn-primary" type="button" data-action="fix">Fix and save again</button>'
          : `<a class="btn btn-primary" href="#/new/${esc(form.type)}" data-replace>Add another ${esc(form.noun)}</a>`}
        <a class="btn btn-quiet" href="#/" data-replace>Go to home</a>
      </div>
    </main>`;
  window.scrollTo(0, 0);
  const fix = app.querySelector('[data-action="fix"]');
  if (fix) fix.addEventListener('click', () => reopenInForm(item, 'Fix the fields marked in red, then save again.', true));
  announce(`${s.big} ${s.word}`);
}

function reopenInForm(item, note, removeItem) {
  const form = getForm(item.type);
  store.set(DRAFT_PREFIX + form.type, {
    values: toFormValues(form, item.data || {}),
    at: Date.now(),
    note,
    errors: removeItem ? item.fields : undefined,
    message: removeItem ? item.error : undefined,
  });
  if (removeItem) recent.remove(item.id);
  closePanel(false);
  location.replace(`#/new/${form.type}`);
}

/* ---------------- Entry details and cancelling ---------------- */

let panelReturnFocus = null;

function closePanel(restoreFocus = true) {
  const overlay = document.querySelector('.overlay');
  if (!overlay) return;
  overlay.remove();
  document.body.classList.remove('no-scroll');
  document.removeEventListener('keydown', panelKeys);
  if (restoreFocus && panelReturnFocus && document.contains(panelReturnFocus)) panelReturnFocus.focus();
  panelReturnFocus = null;
}

function panelKeys(e) {
  const panel = document.querySelector('.panel');
  if (!panel) return;
  if (e.key === 'Escape') {
    closePanel();
    return;
  }
  if (e.key !== 'Tab') return;
  const items = Array.from(panel.querySelectorAll('button, a[href], textarea, input, select')).filter((el) => !el.disabled);
  if (!items.length) return;
  const first = items[0];
  const last = items[items.length - 1];
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
}

function openPanel(id) {
  const item = recent.get(id);
  const form = item ? getForm(item.type) : null;
  if (!item || !form) return;
  closePanel(false);
  panelReturnFocus = document.activeElement;
  const overlay = document.createElement('div');
  overlay.className = 'overlay';
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closePanel(); });
  document.body.appendChild(overlay);
  document.body.classList.add('no-scroll');
  document.addEventListener('keydown', panelKeys);
  showDetails(overlay, item, form);
}

function showDetails(overlay, item, form) {
  const s = stampFor(item);
  let actions = '';
  if (item.state === 'saved' && item.token) {
    actions = '<button class="btn btn-danger-quiet" type="button" data-action="cancel">Mark as cancelled</button>';
  } else if (item.state === 'failed') {
    actions = '<button class="btn btn-primary" type="button" data-action="fix">Fix and save again</button>';
  } else if (item.state === 'pending') {
    actions = '<button class="btn btn-quiet" type="button" data-action="retry">Try sending now</button>';
  } else if (item.state === 'cancelled') {
    actions = '<button class="btn btn-quiet" type="button" data-action="again">Enter it again correctly</button>';
  }
  overlay.innerHTML = `
    <div class="panel" role="dialog" aria-modal="true" aria-labelledby="panel-title">
      <div class="panel-head">
        <h2 class="panel-title" id="panel-title">${esc(form.title)}</h2>
        <button class="panel-close" type="button" data-action="close" aria-label="Close">${icon('close')}</button>
      </div>
      <p class="panel-state panel-state--${esc(s.cls)}"><strong>${esc(s.big)}</strong> ${esc(s.word)}</p>
      <p class="panel-text">${esc(s.text)}</p>
      ${linesHtml(form, item)}
      <div class="panel-actions">${actions}</div>
    </div>`;
  const on = (name, handler) => {
    const el = overlay.querySelector(`[data-action="${name}"]`);
    if (el) el.addEventListener('click', handler);
  };
  on('close', () => closePanel());
  on('cancel', () => showCancel(overlay, item, form));
  on('fix', () => reopenInForm(item, 'Fix the fields marked in red, then save again.', true));
  on('again', () => reopenInForm(item, `This is a copy of cancelled entry ${item.code}. Correct it and save.`, false));
  on('retry', async () => {
    await flushOutbox();
    const latest = recent.get(item.id);
    if (latest && latest.state === 'pending') toast('Still no connection. It will keep trying.');
    closePanel();
  });
  const focusTarget = overlay.querySelector('.panel-close');
  if (focusTarget) focusTarget.focus();
}

function showCancel(overlay, item, form) {
  overlay.innerHTML = `
    <div class="panel" role="dialog" aria-modal="true" aria-labelledby="panel-title">
      <div class="panel-head">
        <h2 class="panel-title" id="panel-title">Mark ${esc(item.code)} as cancelled?</h2>
        <button class="panel-close" type="button" data-action="close" aria-label="Close">${icon('close')}</button>
      </div>
      <p class="panel-text">The entry stays in the records, marked as cancelled. You can then enter it again correctly.</p>
      <div class="field" data-field="reason">
        <label class="label" for="cancel-reason">Why is it wrong?<span class="req" aria-hidden="true">*</span></label>
        <textarea id="cancel-reason" rows="2" maxlength="300" placeholder="For example: wrong amount" aria-describedby="cancel-err"></textarea>
        <p class="field-error" id="cancel-err" hidden></p>
      </div>
      <div class="panel-actions">
        <button class="btn btn-danger" type="button" data-action="confirm">Mark as cancelled</button>
        <button class="btn btn-quiet" type="button" data-action="back">Go back</button>
      </div>
    </div>`;
  const reasonEl = overlay.querySelector('#cancel-reason');
  const errorEl = overlay.querySelector('#cancel-err');
  const showError = (message) => {
    errorEl.textContent = message;
    errorEl.hidden = false;
    reasonEl.setAttribute('aria-invalid', 'true');
  };
  reasonEl.addEventListener('input', () => { errorEl.hidden = true; reasonEl.removeAttribute('aria-invalid'); });
  overlay.querySelector('[data-action="close"]').addEventListener('click', () => closePanel());
  overlay.querySelector('[data-action="back"]').addEventListener('click', () => showDetails(overlay, item, form));
  overlay.querySelector('[data-action="confirm"]').addEventListener('click', async (e) => {
    const button = e.currentTarget;
    const reason = reasonEl.value.trim();
    if (reason.length < 3) {
      showError('Please write a short reason.');
      reasonEl.focus();
      return;
    }
    button.disabled = true;
    button.textContent = 'Cancelling…';
    let res;
    try {
      res = await postJson(`/api/entries/${encodeURIComponent(item.code)}/cancel`, { token: item.token, reason });
    } catch (err) {
      res = null;
    }
    if (res && res.status === 200 && res.data && res.data.ok) {
      const updated = recent.update(item.id, { state: 'cancelled', cancelReason: reason });
      toast(`${item.code} marked as cancelled`);
      refresh();
      showDetails(overlay, updated, form);
      return;
    }
    button.disabled = false;
    button.textContent = 'Mark as cancelled';
    showError(res && res.data && res.data.error ? res.data.error : 'No internet connection. Please try again when you are online.');
  });
  reasonEl.focus();
}

/* ------------------------------------------------------------------ */
/* Start                                                               */
/* ------------------------------------------------------------------ */

document.addEventListener('click', (e) => {
  const link = e.target.closest ? e.target.closest('a[data-replace]') : null;
  if (!link) return;
  e.preventDefault();
  location.replace(link.getAttribute('href'));
});

window.addEventListener('hashchange', route);
window.addEventListener('online', () => { updateStatus(); flushOutbox(); });
window.addEventListener('offline', updateStatus);
window.addEventListener('pagehide', saveDraftNow);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) saveDraftNow();
  else flushOutbox();
});
setInterval(() => { if (outbox.all().length) flushOutbox(); }, RETRY_EVERY_MS);

route();
flushOutbox();

if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => { /* the page works without it */ });
  });
}
