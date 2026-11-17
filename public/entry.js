// SuccessPath Classes: the home screen, the forms, and sending entries.
//
// How an entry travels:
//   1. It is checked on the device, then kept in the device's outbox (so nothing is lost).
//   2. It is sent to the server. If the internet is down, it waits and is sent automatically later.
//   3. The server checks it again, saves it, links it to the student or teacher (adding them to the
//      register if they are new) and returns its entry number, for example FEE-0012.

import { APP_NAME, APP_VERSION, FORMS, GROUPS, PEOPLE, PICKER_KINDS, MONTHS, getForm, validateEntry, swapForMinus, localToday, nameKey } from './forms.js';
import {
  app, ui, store, outbox, recent, esc, icon, newId, randomHex, whenSaved, longDate, displayValue, announce, toast,
  postJson, statusInner, updateStatus, topBar, tabBar, DRAFT_PREFIX, openOverlay, closePanel, bellButton, summaryText,
} from './lib.js';
import { cachedPeople, findPerson, rememberPerson, personHref } from './people.js';
import { logOut } from './login.js';

let draftTimer = null;
let flushing = false;
let picks = {}; // the person chosen in each name box of the open form: { fieldKey: { code, name, kind } }

/* ------------------------------------------------------------------ */
/* Home                                                                */
/* ------------------------------------------------------------------ */

export function renderHome(keepScroll) {
  ui.view = 'home';
  ui.form = null;
  document.title = APP_NAME;
  const scroll = window.scrollY;
  const items = recent.all();
  app.innerHTML = `
    <header class="masthead">
      <div class="masthead-row">
        <h1 class="brand">${esc(APP_NAME)}</h1>
        <div class="masthead-end">
          ${bellButton()}
          <span class="status" data-status>${statusInner()}</span>
        </div>
      </div>
      <p class="masthead-date">${esc(longDate(new Date()))}</p>
    </header>
    <main class="home with-tabs">
      ${GROUPS.map((group) => {
        const forms = FORMS.filter((f) => f.group === group && !f.hidden);
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
        <a class="log-link" href="#/log">
          <span class="log-link-icon" aria-hidden="true">${icon('log')}</span>
          <span class="log-link-text"><strong>Activity log</strong><span>What changed in the last 30 days, and who made it</span></span>
          ${icon('chevron')}
        </a>
      </section>
      <footer class="foot">Version ${esc(APP_VERSION)}${ui.logins ? ' <span aria-hidden="true">·</span> <button type="button" class="linkish foot-logout" data-logout>Log out of this phone</button>' : ''}</footer>
    </main>
    ${tabBar('home')}`;
  const logoutButton = app.querySelector('[data-logout]');
  if (logoutButton) {
    let armed = null;
    logoutButton.addEventListener('click', async () => {
      if (!armed) {
        logoutButton.textContent = 'Tap again to log out';
        armed = setTimeout(() => { armed = null; logoutButton.textContent = 'Log out of this phone'; }, 4000);
        return;
      }
      clearTimeout(armed);
      await logOut('admin');
      window.dispatchEvent(new CustomEvent('sp:logout'));
    });
  }
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

/* ------------------------------------------------------------------ */
/* The form                                                            */
/* ------------------------------------------------------------------ */

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

function monthChoices(field, selected) {
  const now = new Date();
  const list = [...(field.extraChoices || [])];
  for (let k = -1; k <= 2; k += 1) {
    const d = new Date(now.getFullYear(), now.getMonth() + k, 1);
    list.push(`${MONTHS[d.getMonth()]} ${d.getFullYear()}`);
  }
  for (const s of selected) if (!list.includes(s)) list.push(s);
  return list;
}

export function fieldHtml(field, value) {
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
  const wrap = (inner, cls = '') => `<div class="field${cls}" data-field="${esc(field.key)}">${inner}${hint}${error}</div>`;
  const v = value === undefined || value === null ? '' : value;

  switch (field.kind) {
    case 'name':
      return wrap(`${label}<input ${common} type="text" autocapitalize="words" autocomplete="off" spellcheck="false" maxlength="80"${placeholder} value="${esc(v)}">`);
    case 'student':
    case 'teacher':
    case 'person':
      return `
        <div class="field picker" data-field="${esc(field.key)}">
          ${label}
          <div class="picker-box">
            <input ${common} type="text" autocapitalize="words" autocomplete="off" spellcheck="false" maxlength="80"
              role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="${id}-list"${placeholder} value="${esc(v)}">
            <ul class="suggest" id="${id}-list" role="listbox" hidden></ul>
          </div>
          <p class="linked" id="${id}-linked" hidden></p>
          ${hint}${error}
        </div>`;
    case 'text':
      return wrap(`${label}<input ${common} type="text" autocomplete="off" maxlength="120"${placeholder} value="${esc(v)}">`);
    case 'phone':
      return wrap(`${label}<input ${common} type="tel" inputmode="tel" autocomplete="off" maxlength="16" placeholder="10-digit number" value="${esc(v)}">`);
    case 'email':
      return wrap(`${label}<input ${common} type="email" inputmode="email" autocapitalize="off" autocomplete="off" spellcheck="false" maxlength="120" placeholder="name@example.com" value="${esc(v)}">`);
    case 'date':
      return wrap(`${label}<input ${common} type="date" min="2000-01-01" max="2099-12-31" value="${esc(v)}">`);
    case 'money':
      return wrap(`${label}<div class="money"><span class="money-sign" aria-hidden="true">₹</span><input ${common} type="text" inputmode="decimal" autocomplete="off" maxlength="14" placeholder="0" value="${esc(v)}"></div>`);
    case 'number':
      return wrap(`${label}<input ${common} type="text" inputmode="decimal" autocomplete="off" maxlength="9"${placeholder} value="${esc(v)}">`, ' field--short');
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
      const options = multi ? monthChoices(field, selected) : field.options;
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

export function collectValues(form, formEl) {
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

export function saveDraftNow() {
  if (ui.view !== 'form' || !ui.form) return;
  clearTimeout(draftTimer);
  const formEl = app.querySelector('form.entry');
  if (!formEl) return;
  const values = collectValues(ui.form, formEl);
  if (isUntouched(ui.form, values)) store.remove(DRAFT_PREFIX + ui.form.type);
  else store.set(DRAFT_PREFIX + ui.form.type, { values, links: { ...picks }, at: Date.now() });
}

function scheduleDraftSave() {
  clearTimeout(draftTimer);
  draftTimer = setTimeout(saveDraftNow, 300);
}

export function showErrors(formEl, errors) {
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

export function clearFieldError(target) {
  const box = target && target.closest ? target.closest('[data-field]') : null;
  if (!box || !box.classList.contains('has-error')) return;
  box.classList.remove('has-error');
  box.querySelector('.field-error').hidden = true;
  for (const input of box.querySelectorAll('[aria-invalid]')) input.removeAttribute('aria-invalid');
}

/** Opens a form. `personCode` fills it in for a student or teacher (from their page). */
export function renderForm(form, personCode) {
  ui.view = 'form';
  ui.form = form;
  picks = {};
  document.title = `${form.title} | ${APP_NAME}`;
  const fromPerson = personCode ? findPerson(personCode) : null;
  // Opened from a student's or teacher's page: start fresh for them instead of reopening a draft.
  const draft = fromPerson ? null : store.get(DRAFT_PREFIX + form.type, null);
  let values = draft && draft.values ? { ...defaultValues(form), ...draft.values } : defaultValues(form);
  if (draft && draft.links) {
    for (const [key, link] of Object.entries(draft.links)) {
      if (link && values[key] === link.name) picks[key] = link;
    }
  }
  if (fromPerson && form.person) {
    values = applyPerson(form, values, fromPerson);
    picks[form.person.field] = { code: fromPerson.code, name: fromPerson.name, kind: fromPerson.kind };
  }
  const back = fromPerson ? personHref(fromPerson.code) : '#/';
  const notice = draft && !fromPerson
    ? `<p class="notice">${esc(draft.note || 'Your unfinished entry is back.')} <button type="button" class="linkish" data-action="restart">Clear the form</button></p>`
    : '';
  app.innerHTML = `
    ${topBar(form.title, back)}
    <main class="paper">
      <form class="entry" novalidate autocomplete="off">
        <div class="entry-lines" style="--tile:${esc(form.color)}">
          ${notice}
          ${form.fields.some((f) => f.required) ? '<p class="req-note"><span class="req" aria-hidden="true">*</span> must be filled in</p>' : ''}
          ${form.fields.filter((f) => !f.hidden).map((f) => fieldHtml(f, values[f.key])).join('')}
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
  for (const field of form.fields) if (PICKER_KINDS.includes(field.kind)) wirePicker(form, formEl, field);
  formEl.addEventListener('input', (e) => { clearFieldError(e.target); scheduleDraftSave(); });
  formEl.addEventListener('change', (e) => { clearFieldError(e.target); scheduleDraftSave(); });
  formEl.addEventListener('submit', (e) => { e.preventDefault(); submitForm(form, formEl, fromPerson); });
  const restart = formEl.querySelector('[data-action="restart"]');
  if (restart) {
    restart.addEventListener('click', () => {
      store.remove(DRAFT_PREFIX + form.type);
      renderForm(form, personCode);
    });
  }
  if (draft && (draft.errors || draft.message)) {
    if (draft.message) {
      const box = formEl.querySelector('.form-error');
      box.textContent = draft.message;
      box.hidden = false;
    }
    showErrors(formEl, draft.errors);
    store.set(DRAFT_PREFIX + form.type, { values: draft.values, links: draft.links, at: Date.now(), note: draft.note });
  }
}

/** Fills the name, class and phone of a chosen person into the form values. */
function applyPerson(form, values, person) {
  const link = form.person;
  const out = { ...values, [link.field]: person.name };
  if (link.classField && person.class) out[link.classField] = person.class;
  if (link.phoneField && person.phone && !out[link.phoneField]) out[link.phoneField] = person.phone;
  // Details already known (for example from a teacher enquiry, when hiring): fill the empty boxes.
  const saved = store.get(`sp.person.v1.${person.code}`, null);
  const details = (saved && saved.data && saved.data.person && saved.data.person.details) || {};
  if (details.salary_asked && !details.salary) details.salary = details.salary_asked;
  for (const key of link.details || []) {
    if (details[key] !== undefined && details[key] !== null && (out[key] === undefined || out[key] === '')) out[key] = details[key];
  }
  return out;
}

/* ---------------- Name suggestions ---------------- */

function kindsFor(field) {
  return field.kind === 'person' ? Object.keys(PEOPLE) : [field.kind];
}

function suggestionsFor(field, query) {
  const key = nameKey(query);
  if (!key) return [];
  const out = [];
  for (const kind of kindsFor(field)) {
    const saved = cachedPeople(kind);
    for (const p of saved ? saved.people : []) {
      if (nameKey(p.name).includes(key) || p.code.toLowerCase().startsWith(key)) out.push({ ...p, kind });
    }
  }
  const starts = (p) => (nameKey(p.name).startsWith(key) ? 0 : 1);
  const left = (p) => (p.status === 'Active' ? 0 : 1);
  out.sort((a, b) => starts(a) - starts(b) || left(a) - left(b) || a.name.localeCompare(b.name));
  return out.slice(0, 6);
}

function wirePicker(form, formEl, field) {
  const box = formEl.querySelector(`[data-field="${field.key}"]`);
  const input = box.querySelector('input');
  const list = box.querySelector('.suggest');
  const linked = box.querySelector('.linked');
  const isLink = form.person && form.person.field === field.key;
  let options = [];
  let active = -1;

  const showLinked = () => {
    const pick = picks[field.key];
    if (!pick) {
      linked.hidden = true;
      linked.innerHTML = '';
      return;
    }
    const who = pick.kind === 'teacher' ? 'teacher' : 'student';
    linked.innerHTML = `Saving to this ${who}'s record: <strong>${esc(pick.code)}</strong>. <button type="button" class="linkish">Not this ${who}</button>`;
    linked.hidden = false;
    linked.querySelector('button').addEventListener('click', () => {
      delete picks[field.key];
      showLinked();
      input.focus();
      scheduleDraftSave();
    });
  };

  const close = () => {
    list.hidden = true;
    list.innerHTML = '';
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
    active = -1;
  };

  const choose = (person) => {
    picks[field.key] = { code: person.code, name: person.name, kind: person.kind };
    input.value = person.name;
    if (isLink) {
      const link = form.person;
      if (link.classField && person.class) {
        const select = formEl.elements.namedItem(link.classField);
        if (select && Array.from(select.options).some((o) => o.value === person.class)) select.value = person.class;
      }
      if (link.phoneField && person.phone) {
        const phone = formEl.elements.namedItem(link.phoneField);
        if (phone && !phone.value) phone.value = person.phone;
      }
    }
    close();
    clearFieldError(input);
    showLinked();
    scheduleDraftSave();
  };

  const open = () => {
    if (picks[field.key] && input.value === picks[field.key].name) return close();
    options = suggestionsFor(field, input.value);
    if (!options.length) return close();
    active = -1;
    list.innerHTML = options.map((p, i) => `
      <li role="option" id="${input.id}-opt-${i}" data-i="${i}">
        <strong>${esc(p.name)}</strong>
        <span>${esc([p.class, p.code, p.status === 'Left' ? 'left' : ''].filter(Boolean).join(', '))}</span>
      </li>`).join('');
    list.hidden = false;
    input.setAttribute('aria-expanded', 'true');
  };

  const highlight = (i) => {
    active = i;
    for (const li of list.children) li.classList.toggle('is-active', Number(li.dataset.i) === i);
    if (i >= 0) input.setAttribute('aria-activedescendant', `${input.id}-opt-${i}`);
  };

  input.addEventListener('input', () => {
    if (picks[field.key] && input.value !== picks[field.key].name) {
      delete picks[field.key];
      showLinked();
    }
    open();
  });
  input.addEventListener('focus', open);
  input.addEventListener('blur', () => setTimeout(close, 150));
  input.addEventListener('keydown', (e) => {
    if (list.hidden) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); highlight(Math.min(options.length - 1, active + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); highlight(Math.max(0, active - 1)); }
    else if (e.key === 'Enter' && active >= 0) { e.preventDefault(); choose(options[active]); }
    else if (e.key === 'Escape') close();
  });
  list.addEventListener('pointerdown', (e) => {
    const li = e.target.closest('li[data-i]');
    if (!li) return;
    e.preventDefault();
    choose(options[Number(li.dataset.i)]);
  });
  showLinked();
}

/* ---------------- Saving ---------------- */

// Returns { result: 'saved' | 'retry' | 'rejected', ... }
async function sendEntry(entry) {
  let res;
  try {
    res = await postJson('/api/entries', {
      client_id: entry.client_id,
      cancel_token: entry.cancel_token,
      type: entry.type,
      data: entry.data,
      person_code: entry.person_code || undefined,
    });
  } catch (e) {
    return { result: 'retry' };
  }
  if ((res.status === 200 || res.status === 201) && res.data && res.data.ok) {
    outbox.remove(entry.client_id);
    const person = res.data.person || null;
    recent.update(entry.client_id, { state: 'saved', code: res.data.entry.code, savedAt: res.data.entry.created_at, person });
    if (person) {
      const form = getForm(entry.type);
      const link = form && form.person;
      const extra = {};
      if (link && link.classField && entry.data[link.classField]) extra.class = entry.data[link.classField];
      if (link && link.phoneField && entry.data[link.phoneField]) extra.phone = entry.data[link.phoneField];
      // an enquiry only makes a new person an enquiry, and a demo only moves an enquiry to Demo;
      // neither changes someone already studying or teaching here
      const known = findPerson(person.code);
      if (link && link.status && (person.added || !['Enquiry', 'Demo'].includes(link.status)
        || (link.status === 'Demo' && known && known.status === 'Enquiry'))) extra.status = link.status;
      rememberPerson(person.kind, { code: person.code, name: person.name, ...extra });
    }
    return { result: 'saved', code: res.data.entry.code, person };
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

async function submitForm(form, formEl, fromPerson) {
  const button = formEl.querySelector('button[type="submit"]');
  if (button.disabled) return;
  const errorBox = formEl.querySelector('.form-error');
  errorBox.hidden = true;
  if (formEl.elements.namedItem('website').value) return;

  const values = collectValues(form, formEl);
  const checked = validateEntry(form, values, localToday());
  if (!checked.ok) {
    if (checked.errors._form) {
      errorBox.textContent = checked.errors._form;
      errorBox.hidden = false;
    }
    showErrors(formEl, checked.errors);
    return;
  }

  // A fee typed with a minus amount is money given back: save it as Money returned.
  let saveAs = form;
  let data = checked.data;
  const swap = swapForMinus(form, checked.data, localToday());
  if (swap) {
    const again = validateEntry(swap.form, swap.data, localToday());
    if (!again.ok) {
      errorBox.textContent = again.errors._form || 'Please check the fields marked in red.';
      errorBox.hidden = false;
      showErrors(formEl, again.errors);
      return;
    }
    saveAs = swap.form;
    data = again.data;
  }

  button.disabled = true;
  button.textContent = 'Saving…';
  const pick = form.person ? picks[form.person.field] : null;
  const entry = {
    client_id: newId(),
    cancel_token: randomHex(16),
    type: saveAs.type,
    data,
    person_code: pick ? pick.code : undefined,
    at: new Date().toISOString(),
  };
  // Keep it on the device first, so it survives a closed tab or a lost connection.
  outbox.add(entry);
  recent.put({
    id: entry.client_id, type: saveAs.type, data, state: 'pending', at: entry.at,
    token: entry.cancel_token, from: fromPerson ? fromPerson.code : undefined,
    swappedFrom: swap ? form.type : undefined,
  });
  clearTimeout(draftTimer);
  store.remove(DRAFT_PREFIX + form.type);
  updateStatus();

  const sent = await sendEntry(entry);
  if (sent.result === 'rejected') {
    outbox.remove(entry.client_id);
    recent.remove(entry.client_id);
    store.set(DRAFT_PREFIX + form.type, { values, links: { ...picks }, at: Date.now() });
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

/** Sends entries that are waiting on this device. `refresh` redraws the screen afterwards. */
export async function flushOutbox(refresh) {
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
    if (refresh) refresh();
  }
}

/* ------------------------------------------------------------------ */
/* The saved screen                                                    */
/* ------------------------------------------------------------------ */

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
      return { cls: 'muted', big: item.code, word: 'Cancelled', text: item.cancelReason ? `Reason: ${item.cancelReason}` : 'No reason given.' };
    default:
      return { cls: 'muted', big: '', word: '', text: '' };
  }
}

// A next step offered after saving, for example "Record money returned" after a student left.
function thenHtml(form, item) {
  if (!form.then || item.state === 'failed') return '';
  const who = (item.person && item.person.code) || item.from || '';
  const href = `#/new/${form.then.type}${who ? `?person=${encodeURIComponent(who)}` : ''}`;
  return `<a class="btn btn-quiet btn-then" href="${esc(href)}" data-replace>${esc(form.then.label)}</a>`;
}

function personLine(item) {
  const p = item.person;
  if (!p || item.state !== 'saved') return '';
  const who = p.kind === 'teacher' ? 'teacher' : 'student';
  const form = getForm(item.type);
  const enquiry = form && form.person && form.person.status === 'Enquiry';
  let text = p.added
    ? `New ${who} added to ${p.kind === 'teacher' ? 'Teachers' : 'Students'}:`
    : `Saved to the ${who}'s record:`;
  if (enquiry && p.added) text = p.kind === 'student' ? 'Added to Students as an enquiry:' : 'Added to Teachers, under Enquiries:';
  if (form && form.person && form.person.status === 'Demo') text = p.added ? 'Added to Students, in demo classes:' : 'Moved to demo classes:';
  return `<p class="receipt-person">${esc(text)} <a href="${esc(personHref(p.code))}">${esc(p.name)} (${esc(p.code)})</a></p>`;
}

function linesHtml(form, item) {
  const rows = form.fields
    .map((field) => ({ field, value: displayValue(field, (item.data || {})[field.key]) }))
    .filter((row) => row.value !== '')
    .map((row) => `<div><dt>${esc(row.field.label)}</dt><dd>${esc(row.value)}</dd></div>`);
  return `<dl class="lines">${rows.join('')}</dl>`;
}

export function renderSaved(id) {
  const item = recent.get(id);
  const form = item ? getForm(item.type) : null;
  if (!item || !form) {
    location.replace('#/');
    return;
  }
  ui.view = 'saved';
  ui.form = null;
  document.title = `${form.title} | ${APP_NAME}`;
  const s = stampFor(item);
  const from = item.from ? findPerson(item.from) : null;
  const again = `#/new/${form.type}${item.from ? `?person=${encodeURIComponent(item.from)}` : ''}`;
  app.innerHTML = `
    ${topBar(form.title, '#/')}
    <main class="paper paper--receipt">
      <section class="receipt" aria-label="Entry ${esc(s.big)}">
        <p class="receipt-org">${esc(APP_NAME)}</p>
        <div class="stamp stamp--${s.cls}">
          <span class="stamp-big">${esc(s.big)}</span>
          <span class="stamp-word">${esc(s.word)}</span>
        </div>
        <p class="receipt-text">${esc(s.text)}</p>
        ${item.swappedFrom ? `<p class="receipt-text">Saved as ${esc(form.title.toLowerCase())}, because the amount had a minus sign.</p>` : ''}
        ${personLine(item)}
        ${linesHtml(form, item)}
      </section>
      <div class="actions actions--stack">
        ${item.state === 'failed'
          ? '<button class="btn btn-primary" type="button" data-action="fix">Fix and save again</button>'
          : `<a class="btn btn-primary" href="${esc(again)}" data-replace>Add another ${esc(form.noun)}</a>`}
        ${thenHtml(form, item)}
        ${from ? `<a class="btn btn-quiet" href="${esc(personHref(from.code))}" data-replace>Back to ${esc(from.name)}</a>` : ''}
        <a class="btn btn-quiet" href="#/" data-replace>Go to home</a>
      </div>
    </main>`;
  app.querySelector('.bar-back').setAttribute('data-replace', '');
  window.scrollTo(0, 0);
  const fix = app.querySelector('[data-action="fix"]');
  if (fix) fix.addEventListener('click', () => reopenInForm(item, 'Fix the fields marked in red, then save again.', true));
  announce(`${s.big} ${s.word}`);
}

function reopenInForm(item, note, removeItem) {
  const form = getForm(item.type);
  const link = form.person;
  const links = {};
  if (link && item.person && item.person.code) {
    links[link.field] = { code: item.person.code, name: item.person.name, kind: item.person.kind };
  }
  store.set(DRAFT_PREFIX + form.type, {
    values: toFormValues(form, item.data || {}),
    links,
    at: Date.now(),
    note,
    errors: removeItem ? item.fields : undefined,
    message: removeItem ? item.error : undefined,
  });
  if (removeItem) recent.remove(item.id);
  closePanel(false);
  location.replace(`#/new/${form.type}`);
}

/* ------------------------------------------------------------------ */
/* Entry details and cancelling                                        */
/* ------------------------------------------------------------------ */

function openPanel(id) {
  const item = recent.get(id);
  const form = item ? getForm(item.type) : null;
  if (!item || !form) return;
  showDetails(openOverlay(), item, form);
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
      ${personLine(item)}
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
    if (ui.view === 'home') renderHome(true);
  });
  for (const a of overlay.querySelectorAll('.receipt-person a')) a.addEventListener('click', () => closePanel(false));
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
        <label class="label" for="cancel-reason">Why is it wrong?</label>
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
      if (ui.view === 'home') renderHome(true);
      showDetails(overlay, updated, form);
      return;
    }
    button.disabled = false;
    button.textContent = 'Mark as cancelled';
    showError(res && res.data && res.data.error ? res.data.error : 'No internet connection. Please try again when you are online.');
  });
  reasonEl.focus();
}
