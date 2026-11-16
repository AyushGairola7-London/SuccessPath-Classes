// SuccessPath Classes: the "Edit details" page of a student or teacher.
//
// Changes go straight to the register (the database keeps every earlier version in its history),
// so this page needs the internet. Right after saving, Undo puts the old details back.

import { APP_NAME, PEOPLE, PERSON_EDIT_FIELDS } from './forms.js';
import { app, ui, store, esc, getJson, postJson, topBar, toast } from './lib.js';
import { fieldHtml, collectValues, showErrors, clearFieldError } from './entry.js';
import { rememberPerson, personHref, renderPersonDetail } from './people.js';

const PERSON_PREFIX = 'sp.person.v1.';

export async function renderPersonEdit(kind, code) {
  const conf = PEOPLE[kind];
  const tab = kind === 'student' ? 'students' : 'teachers';
  const back = personHref(code);
  const here = `#/${tab}/${code}/edit`;
  ui.view = 'edit';
  ui.form = null;
  document.title = `Edit details | ${APP_NAME}`;
  app.innerHTML = `${topBar('Edit details', back)}<main class="paper"><p class="list-note edit-loading">Loading…</p></main>`;

  let data;
  try {
    data = await getJson(`/api/people/${encodeURIComponent(code)}`);
    store.set(PERSON_PREFIX + code, { at: Date.now(), data });
  } catch (err) {
    if (ui.view !== 'edit' || location.hash !== here) return;
    app.querySelector('main').innerHTML = `
      <p class="empty">${esc(err.message)} Details can only be changed while the internet is on.</p>
      <div class="actions actions--stack"><a class="btn btn-quiet" href="${esc(back)}">Back</a></div>`;
    return;
  }
  if (ui.view !== 'edit' || location.hash !== here) return;

  const person = data.person;
  const d = person.details || {};
  const fields = PERSON_EDIT_FIELDS[kind]
    .filter((f) => (!f.ifLeft || person.status === 'Left') && (!f.ifStatus || f.ifStatus.includes(person.status)));
  const valueOf = (f) => {
    if (f.values) return Object.keys(f.values).find((label) => f.values[label] === person[f.to]) || '';
    const v = f.to ? person[f.to] : d[f.key];
    return v === undefined || v === null ? '' : v;
  };
  const original = Object.fromEntries(fields.map((f) => [f.key, valueOf(f)]));
  document.title = `Edit ${person.name} | ${APP_NAME}`;
  app.querySelector('main').innerHTML = `
    <form class="entry" novalidate autocomplete="off">
      <div class="entry-lines" style="--tile:${esc(conf.color)}">
        <p class="edit-who">${esc(person.name)} <span>${esc(person.code)}</span></p>
        <p class="hint edit-hint">Change what is wrong or missing, then save. Leave a box empty to remove it.</p>
        ${fields.map((f) => fieldHtml(f, valueOf(f))).join('')}
      </div>
      <div class="actions actions--edit">
        <p class="form-error" role="alert" hidden></p>
        <button class="btn btn-primary" type="submit">Save changes</button>
        <a class="btn btn-quiet" href="${esc(back)}" data-replace>Cancel</a>
      </div>
    </form>`;
  window.scrollTo(0, 0);

  const formEl = app.querySelector('form.entry');
  const errorBox = formEl.querySelector('.form-error');
  formEl.addEventListener('input', (e) => clearFieldError(e.target));
  formEl.addEventListener('change', (e) => clearFieldError(e.target));
  formEl.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorBox.hidden = true;
    const values = collectValues({ fields }, formEl);
    const changes = {};
    for (const f of fields) {
      if (String(values[f.key] ?? '').trim() !== String(original[f.key]).trim()) changes[f.key] = values[f.key];
    }
    if (!Object.keys(changes).length) {
      location.replace(back);
      toast('Nothing was changed.');
      return;
    }
    const button = formEl.querySelector('button[type="submit"]');
    button.disabled = true;
    button.textContent = 'Saving…';
    const result = await send(code, person.updated_at, changes);
    button.disabled = false;
    button.textContent = 'Save changes';
    if (!result.ok) {
      if (result.fields && Object.keys(result.fields).some((k) => k !== '_form')) showErrors(formEl, result.fields);
      errorBox.textContent = result.error;
      errorBox.hidden = false;
      return;
    }
    // what to put back if Undo is tapped
    const undo = Object.fromEntries(Object.keys(changes).map((k) => [k, original[k]]));
    saved(kind, data, result.person);
    location.replace(back);
    toast(`Details saved for ${result.person.name}.`, {
      label: 'Undo',
      run: async () => {
        const again = await send(code, result.person.updated_at, undo);
        if (!again.ok) { toast(again.error); return; }
        saved(kind, data, again.person);
        toast('The old details are back.');
        if (location.hash === back) renderPersonDetail(kind, code);
      },
    });
  });
}

async function send(code, updatedAt, changes) {
  let r = null;
  try { r = await postJson(`/api/people/${encodeURIComponent(code)}`, { updated_at: updatedAt, changes }); } catch { r = null; }
  if (r && r.data && r.data.ok) return { ok: true, person: r.data.person };
  if (!r || !r.data) return { ok: false, error: 'No internet connection. The details were not saved. Try again when you are online.' };
  return { ok: false, error: r.data.error || 'The details were not saved.', fields: r.data.fields };
}

// Keeps the saved copies on this device in step, so the lists and name suggestions show the change.
function saved(kind, data, person) {
  store.set(PERSON_PREFIX + person.code, { at: Date.now(), data: { ...data, person: { ...data.person, ...person } } });
  rememberPerson(kind, {
    code: person.code, name: person.name, class: person.class, phone: person.phone, status: person.status,
    joined_on: person.joined_on, left_on: person.left_on,
    plan: (person.details || {}).fee_plan || null, enrollment: (person.details || {}).enrollment_no || null,
  });
}
