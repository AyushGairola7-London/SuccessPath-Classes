// SuccessPath Classes: small helpers shared by every screen.

export const OUTBOX_KEY = 'sp.outbox.v1';
export const RECENT_KEY = 'sp.recent.v1';
export const DRAFT_PREFIX = 'sp.draft.v1.';
export const RECENT_LIMIT = 25;
const SEND_TIMEOUT_MS = 20000;
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export const app = document.getElementById('app');
const live = document.getElementById('live');

// Which screen is showing. Screens set this so background updates know what to redraw.
export const ui = { view: '', form: null };

/* ---------------- Storage on this device. Never throws; falls back to memory. ---------------- */

const memory = new Map();
export const store = {
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

export const outbox = {
  all() { return store.get(OUTBOX_KEY, []); },
  add(entry) {
    const list = this.all().filter((e) => e.client_id !== entry.client_id);
    list.push(entry);
    store.set(OUTBOX_KEY, list);
  },
  remove(id) { store.set(OUTBOX_KEY, this.all().filter((e) => e.client_id !== id)); },
};

export const recent = {
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

/* ---------------- Text and numbers ---------------- */

export function esc(value) {
  return String(value === undefined || value === null ? '' : value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export function randomHex(bytes) {
  const a = new Uint8Array(bytes);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function newId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const h = randomHex(16);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export function money(n) {
  return `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
}

/** ₹1.2L / ₹12.5K style, for chart axes. */
export function compactMoney(n) {
  const v = Number(n || 0);
  if (v >= 100000) return `₹${trim(v / 100000)}L`;
  if (v >= 1000) return `₹${trim(v / 1000)}K`;
  return `₹${trim(v)}`;
}

function trim(v) {
  return (Math.round(v * 10) / 10).toString();
}

export function dateFromIso(iso) {
  const [y, m, d] = String(iso).split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function shortDate(iso) {
  if (!iso) return '';
  const d = dateFromIso(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return `${d.getDate()} ${MONTH_NAMES[d.getMonth()]} ${d.getFullYear()}`;
}

export function timeOf(date) {
  return date.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
}

export function whenSaved(isoTime) {
  const d = new Date(isoTime);
  if (Number.isNaN(d.getTime())) return '';
  const today = new Date();
  const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return `Today, ${timeOf(d)}`;
  if (d.toDateString() === yesterday.toDateString()) return `Yesterday, ${timeOf(d)}`;
  return `${d.getDate()} ${MONTH_NAMES[d.getMonth()]}, ${timeOf(d)}`;
}

export function longDate(d) {
  return d.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

export function initials(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  return ((parts[0] || '?')[0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}

export function displayValue(field, value) {
  if (value === undefined || value === null || value === '') return '';
  if (field.kind === 'money') return money(value);
  if (field.kind === 'date') return shortDate(value);
  if (Array.isArray(value)) return value.join(', ');
  return String(value);
}

/* ---------------- Messages ---------------- */

export function announce(message) {
  live.textContent = '';
  setTimeout(() => { live.textContent = message; }, 50);
}

/** A short message at the bottom. With `action` ({ label, run }) it shows a button, like Undo. */
export function toast(message, action) {
  announce(message);
  for (const old of document.querySelectorAll('.toast')) old.remove();
  const el = document.createElement('div');
  el.className = action ? 'toast toast--action' : 'toast';
  el.textContent = message;
  if (action) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'toast-button';
    button.textContent = action.label;
    button.addEventListener('click', () => { el.remove(); action.run(); });
    el.appendChild(button);
  }
  document.body.appendChild(el);
  const wait = action ? 6000 : 2800;
  setTimeout(() => el.classList.add('toast--out'), wait);
  setTimeout(() => el.remove(), wait + 500);
}

/* ---------------- The panel that slides up from the bottom ---------------- */

let panelReturnFocus = null;

/** Opens an empty overlay for a panel and returns it. Escape or a tap outside closes it. */
export function openOverlay() {
  closePanel(false);
  panelReturnFocus = document.activeElement;
  const overlay = document.createElement('div');
  overlay.className = 'overlay';
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closePanel(); });
  document.body.appendChild(overlay);
  document.body.classList.add('no-scroll');
  document.addEventListener('keydown', panelKeys);
  return overlay;
}

export function closePanel(restoreFocus = true) {
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

/* ---------------- Talking to the server ---------------- */

export async function postJson(url, body) {
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

/** GET from the server. Returns the parsed body, or throws with a message for people. */
export async function getJson(url) {
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), SEND_TIMEOUT_MS) : null;
  let res;
  try {
    res = await fetch(url, { headers: { 'x-successpath': '1' }, cache: 'no-store', signal: controller ? controller.signal : undefined });
  } catch (e) {
    throw new Error('No internet connection.');
  } finally {
    if (timer) clearTimeout(timer);
  }
  let data = null;
  try { data = await res.json(); } catch (e) { /* not JSON */ }
  if (!res.ok || !data || !data.ok) throw new Error((data && data.error) || 'The server did not answer. Please try again.');
  return data;
}

/* ---------------- Icons (drawn for this app) ---------------- */

const ICONS = {
  fee: '<path d="M7 4.5h10M7 9h10M9.2 4.5c3.4 0 5.1 1.7 5.1 4.5s-1.7 4.6-5.1 4.6H7l7.6 6.9"/>',
  enquiry: '<path d="M4.5 5.5h15v10.5H10l-5.5 4v-4z"/><path d="M10.2 9.2a1.9 1.9 0 1 1 2.6 1.8c-.6.3-.9.7-.9 1.3"/><path d="M11.9 14.3h.01"/>',
  admission: '<circle cx="9.5" cy="8" r="3.3"/><path d="M3.5 19.5c.7-3.4 3.1-5.4 6-5.4s5.3 2 6 5.4"/><path d="M18.5 7.5v6M15.5 10.5h6"/>',
  student_left: '<circle cx="9.5" cy="8" r="3.3"/><path d="M3.5 19.5c.7-3.4 3.1-5.4 6-5.4s5.3 2 6 5.4"/><path d="M15.5 10.5h6M19 8l2.5 2.5L19 13"/>',
  teacher: '<rect x="9.5" y="4" width="11" height="8" rx="1"/><circle cx="6" cy="10" r="2.4"/><path d="M2.5 20c.4-3.1 1.8-5 3.5-5s3.1 1.9 3.5 5"/><path d="M8 14l4.5-3"/>',
  teacher_left: '<path d="M13.5 4.5h-7v15h7"/><path d="M10.5 12h10M17.5 9l3 3-3 3"/>',
  teacher_payment: '<rect x="3.5" y="6" width="17" height="13" rx="2"/><path d="M3.5 10.5h17M15 15h2.5"/>',
  expense: '<path d="M6 3.5h12v17l-2-1.3-2 1.3-2-1.3-2 1.3-2-1.3-2 1.3z"/><path d="M9 8.5h6M9 12.5h6"/>',
  complaint: '<path d="M12 4.2l8.6 15.3H3.4z"/><path d="M12 10v4.2M12 17.1h.01"/>',
  marks: '<rect x="5" y="3.5" width="14" height="17" rx="2"/><path d="M8.5 9.5l2 2 4-4M8.5 16h7"/>',
  note: '<path d="M6 3.5h8.5L18.5 7.5v13H6z"/><path d="M9 11.5h6.5M9 15.5h6.5"/>',
  exam: '<rect x="4" y="5.5" width="16" height="14.5" rx="2"/><path d="M4 10h16M8.5 3.5v4M15.5 3.5v4"/><path d="M8 14.5h3M8 17h6"/>',
  tasks: '<path d="M4.5 6.6l1.7 1.7 3.1-3.2M4.5 12.6l1.7 1.7 3.1-3.2"/><rect x="4.6" y="17" width="4.4" height="3.6" rx="1"/><path d="M12.5 7h7.5M12.5 13h7.5M12.5 18.8h7.5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  entry: '<rect x="5" y="3.5" width="14" height="17" rx="2"/><path d="M8.5 8h7M8.5 12h7M8.5 16h4"/>',
  home: '<path d="M4 10.5L12 4l8 6.5V20h-5.5v-6h-5v6H4z"/>',
  students: '<circle cx="9" cy="8.5" r="3"/><path d="M3.5 19c.6-3 2.8-4.8 5.5-4.8s4.9 1.8 5.5 4.8"/><circle cx="17" cy="9.2" r="2.4"/><path d="M16 14.3c2.3.3 4 1.8 4.5 4.2"/>',
  teachers: '<rect x="9.5" y="4" width="11" height="8" rx="1"/><circle cx="6" cy="10" r="2.4"/><path d="M2.5 20c.4-3.1 1.8-5 3.5-5s3.1 1.9 3.5 5"/><path d="M8 14l4.5-3"/>',
  analytics: '<path d="M4 20.5h16"/><path d="M6.5 17v-5M11 17V6.5M15.5 17v-8M20 17V11"/>',
  phone: '<path d="M6.6 4h2.9l1.4 3.8-1.9 1.2a10.4 10.4 0 0 0 5.9 5.9l1.2-1.9 3.8 1.4v2.9c0 1-.9 1.9-1.9 1.8C10.6 18.6 5.4 13.4 4.8 5.9 4.7 4.9 5.6 4 6.6 4z"/>',
  search: '<circle cx="11" cy="11" r="6"/><path d="M20 20l-4.6-4.6"/>',
  chevron: '<path d="M9.5 5.5l6.5 6.5-6.5 6.5"/>',
  back: '<path d="M15 5l-7 7 7 7"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  up: '<path d="M12 19V5M6 11l6-6 6 6"/>',
  down: '<path d="M12 5v14M6 13l6 6 6-6"/>',
};

export function icon(name) {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${ICONS[name] || ICONS.entry}</svg>`;
}

/* ---------------- Status pill and page chrome ---------------- */

export function statusInner() {
  const waiting = outbox.all().length;
  const online = navigator.onLine !== false;
  if (waiting > 0) {
    const what = `${waiting} waiting`;
    return `<span class="dot dot--warn"></span>${online ? what : `Offline, ${what}`}`;
  }
  return online ? '<span class="dot dot--ok"></span>Online' : '<span class="dot dot--off"></span>Offline';
}

export function updateStatus() {
  for (const el of document.querySelectorAll('[data-status]')) el.innerHTML = statusInner();
}

/** The blue bar at the top of every screen except home. */
export function topBar(title, back) {
  return `
    <header class="bar">
      ${back ? `<a class="bar-back" href="${esc(back)}" aria-label="Back">${icon('back')}</a>` : '<span class="bar-gap"></span>'}
      <h1 class="bar-title">${esc(title)}</h1>
      <span class="status" data-status>${statusInner()}</span>
    </header>`;
}

/** The tabs along the bottom of the main screens. */
export function tabBar(active) {
  const tabs = [
    ['home', '#/', 'Home', 'home'],
    ['students', '#/students', 'Students', 'students'],
    ['teachers', '#/teachers', 'Teachers', 'teachers'],
    ['tasks', '#/tasks', 'Tasks', 'tasks'],
    ['analytics', '#/analytics', 'Analytics', 'analytics'],
  ];
  return `
    <nav class="tabbar" aria-label="Main">
      ${tabs.map(([key, href, label, ic]) => `
        <a class="tab${key === active ? ' is-active' : ''}" href="${href}"${key === active ? ' aria-current="page"' : ''}>
          ${icon(ic)}<span>${label}</span>
        </a>`).join('')}
    </nav>`;
}
