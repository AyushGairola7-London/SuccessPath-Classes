// SuccessPath Classes: the Tasks board (what to do next) and the exams coming up.
//
// A task moves from To do to Doing to Done. Nothing is deleted: "Remove from board" only hides a
// task here, and the Google Sheet still lists it. On a laptop the cards can also be dragged
// between the columns.

import { APP_NAME, TASK_STAGES, MONTHS, indiaToday } from './forms.js';
import {
  app, ui, store, esc, icon, timeOf, whenSaved, getJson, postJson, newId, topBar, tabBar, toast,
  openOverlay, closePanel, dateFromIso, money,
} from './lib.js';

const SAVED_KEY = 'sp.tasks.v1';
const EXAMS_SHOWN = 3;
const NEXT = { 'To do': { stage: 'Doing', label: 'Start' }, Doing: { stage: 'Done', label: 'Mark done' } };
const EMPTY = {
  'To do': 'Nothing here. Write the next thing to do in the box above.',
  Doing: 'Nothing in progress. Tap Start on a task when work on it begins.',
  Done: 'Finished tasks are stamped and kept here.',
};
const WIDE = typeof matchMedia === 'function' ? matchMedia('(min-width: 900px) and (pointer: fine)') : null;

// What the screen shows. `tasks` is every task this device knows, `meta` the rest of the board.
const board = { tasks: null, meta: null, savedAt: 0, note: '', failed: '', column: null, examsOpen: false, justDone: null };

/* ---------------- The screen ---------------- */

export function renderTasks() {
  ui.view = 'tasks';
  ui.form = null;
  document.title = `Tasks | ${APP_NAME}`;
  if (!TASK_STAGES.includes(board.column)) board.column = 'To do';
  if (!board.tasks) {
    const saved = store.get(SAVED_KEY, null);
    if (saved && saved.data) useData(saved.data, saved.at);
  }
  app.innerHTML = `
    ${topBar('Tasks')}
    <main class="tasks-page with-tabs">
      <section class="exams" data-exams aria-labelledby="exams-title"></section>
      <form class="task-add" data-add novalidate autocomplete="off">
        <label class="task-add-label" for="task-title">Add a task</label>
        <div class="task-add-row">
          <input id="task-title" name="title" type="text" maxlength="200" placeholder="For example: hire a maths teacher" enterkeyhint="done" aria-describedby="task-add-error">
          <button class="btn btn-primary task-add-button" type="submit">${icon('plus')}<span>Add</span></button>
        </div>
        <p class="field-error" id="task-add-error" data-add-error hidden></p>
        <details class="task-more">
          <summary>Add dates, budget, owner or notes</summary>
          <div class="task-more-fields">
            <div class="field">
              <label class="label" for="task-start">Start date</label>
              <input id="task-start" name="start_on" type="date">
            </div>
            <div class="field">
              <label class="label" for="task-due">End date</label>
              <input id="task-due" name="due_on" type="date">
            </div>
            <div class="field">
              <label class="label" for="task-budget">Budget</label>
              <div class="money"><span class="money-sign" aria-hidden="true">₹</span><input id="task-budget" name="budget" type="text" inputmode="decimal" maxlength="14" placeholder="0"></div>
            </div>
            <div class="field">
              <label class="label" for="task-owner">Owner</label>
              <input id="task-owner" name="owner" type="text" maxlength="60" list="task-owners" placeholder="For example: Papa">
            </div>
            <div class="field">
              <label class="label" for="task-notes">Notes</label>
              <textarea id="task-notes" name="notes" rows="2" maxlength="2000"></textarea>
            </div>
          </div>
        </details>
      </form>
      <datalist id="task-owners"></datalist>
      <p class="list-note" data-note></p>
      <div class="board" data-board></div>
    </main>
    ${tabBar('tasks')}`;
  wireAdd(app.querySelector('[data-add]'));
  wireBoard(app.querySelector('[data-board]'));
  draw();
  load();
}

async function load() {
  try {
    const data = await getJson('/api/tasks');
    useData(data, Date.now());
    board.note = '';
    board.failed = '';
    persist();
  } catch (err) {
    if (board.tasks) {
      const when = timeOf(new Date(board.savedAt));
      board.note = navigator.onLine === false
        ? `Offline: showing the board saved at ${when}.`
        : `Could not refresh (${err.message}) Showing the board saved at ${when}.`;
    } else {
      board.failed = err.message;
    }
  }
  if (ui.view === 'tasks') draw();
}

function useData(data, at) {
  const { open = [], done = [], ...meta } = data;
  board.tasks = [...open, ...done];
  board.meta = meta;
  board.savedAt = at;
}

function persist() {
  const tasks = board.tasks || [];
  const open = tasks.filter((t) => t.stage === 'To do' || t.stage === 'Doing');
  const done = tasks.filter((t) => t.stage === 'Done');
  store.set(SAVED_KEY, { at: board.savedAt || Date.now(), data: { ...board.meta, open, done } });
}

function today() {
  return (board.meta && board.meta.today) || indiaToday();
}

function draw() {
  if (ui.view !== 'tasks') return;
  drawExams();
  drawOwners();
  const note = app.querySelector('[data-note]');
  const el = app.querySelector('[data-board]');
  if (!el) return;
  if (!board.tasks) {
    note.textContent = '';
    if (board.failed) {
      el.innerHTML = `<p class="empty">${esc(board.failed)} <button type="button" class="linkish" data-retry>Try again</button></p>`;
    } else {
      el.innerHTML = `<p class="empty">${navigator.onLine === false ? 'Connect to the internet to see the board.' : 'Loading…'}</p>`;
    }
    return;
  }
  note.textContent = board.note;
  const counts = Object.fromEntries(TASK_STAGES.map((s) => [s, column(s).length]));
  const doneTotal = board.meta && board.meta.done_total > counts.Done ? board.meta.done_total : counts.Done;
  el.innerHTML = `
    <div class="segmented board-switch" role="group" aria-label="Which tasks to show">
      ${TASK_STAGES.map((s) => `
        <button type="button" data-column="${esc(s)}" aria-pressed="${board.column === s}">
          ${esc(s)} <span class="count">${counts[s]}</span>
        </button>`).join('')}
    </div>
    <div class="columns" data-show="${esc(board.column)}">
      ${TASK_STAGES.map((s) => `
        <section class="column" data-col="${esc(s)}" aria-label="${esc(s)}">
          <h2 class="column-title">${esc(s)} <span class="count">${counts[s]}</span></h2>
          ${counts[s]
            ? `<ol class="cards" data-drop="${esc(s)}">${column(s).map((t) => cardHtml(t)).join('')}</ol>`
            : `<ol class="cards cards--empty" data-drop="${esc(s)}"><li class="column-empty">${esc(EMPTY[s])}</li></ol>`}
          ${s === 'Done' && doneTotal > counts.Done ? `<p class="column-note">Showing the latest ${counts.Done} of ${doneTotal}. All of them are in the Google Sheet.</p>` : ''}
        </section>`).join('')}
    </div>`;
  board.justDone = null;
}

function column(stage) {
  return (board.tasks || [])
    .filter((t) => t.stage === stage)
    .sort((a, b) => a.position - b.position || codeNumber(b.code) - codeNumber(a.code));
}

function codeNumber(code) {
  return Number(String(code).replace(/\D/g, '')) || 0;
}

function find(code) {
  return (board.tasks || []).find((t) => t.code === code) || null;
}

/* ---------------- One card ---------------- */

function cardHtml(t) {
  const next = NEXT[t.stage];
  const due = t.stage === 'Done' ? null : dueText(t.due_on);
  const starts = t.stage === 'To do' && t.start_on && t.start_on > today() ? `Starts ${dayMonth(t.start_on)}` : '';
  const firstLine = t.notes ? t.notes.split('\n')[0] : '';
  const done = t.stage === 'Done';
  const stamped = done ? dayMonth(utcToLocalIso(t.done_at)) : '';
  return `
    <li class="task${done ? ' is-done' : ''}${board.justDone === t.code ? ' just-done' : ''}" data-code="${esc(t.code)}"${WIDE && WIDE.matches ? ' draggable="true"' : ''}>
      <button type="button" class="task-open" data-open="${esc(t.code)}">${esc(t.title)}</button>
      ${due || starts || t.owner || t.budget ? `
        <p class="task-meta">
          ${starts ? `<span class="due due--plain">${esc(starts)}</span>` : ''}
          ${due ? `<span class="due due--${due.tone}">${esc(due.text)}</span>` : ''}
          ${t.budget ? `<span class="budget">Budget ${esc(money(t.budget))}</span>` : ''}
          ${t.owner ? `<span class="who">${esc(t.owner)}</span>` : ''}
        </p>` : ''}
      ${firstLine ? `<p class="task-notes">${esc(firstLine)}${t.notes.includes('\n') ? '…' : ''}</p>` : ''}
      ${next ? `<button type="button" class="task-move" data-move="${esc(next.stage)}">${esc(next.label)}</button>` : ''}
      ${done ? `<span class="task-stamp"><span>Done</span>${stamped ? `<small>${esc(stamped)}</small>` : ''}</span>` : ''}
    </li>`;
}

function dueText(due) {
  if (!due) return null;
  const now = today();
  if (due < now) return { tone: 'late', text: `Overdue, was due ${dayMonth(due)}` };
  if (due === now) return { tone: 'soon', text: 'Due today' };
  if (due === addDays(now, 1)) return { tone: 'soon', text: 'Due tomorrow' };
  if (due <= addDays(now, 6)) return { tone: 'soon', text: `Due ${weekday(due)} ${dayMonth(due)}` };
  return { tone: 'plain', text: `Due ${dayMonth(due)}` };
}

/* ---------------- Exams coming up ---------------- */

function drawExams() {
  const el = app.querySelector('[data-exams]');
  if (!el) return;
  const exams = (board.meta && board.meta.exams) || [];
  const days = (board.meta && board.meta.exam_days) || 45;
  const shown = board.examsOpen ? exams : exams.slice(0, EXAMS_SHOWN);
  el.innerHTML = `
    <div class="exams-head">
      <h2 class="exams-title" id="exams-title">Exams in the next ${days} days</h2>
      <a class="exams-add" href="#/new/exam">${icon('plus')}<span>Exam dates</span></a>
    </div>
    ${!board.meta ? '' : exams.length
      ? `<ul class="exam-list">${shown.map(examRow).join('')}</ul>`
      : '<p class="exams-empty">No exam dates saved for these weeks. Add the school exam dates, like the half-yearly, and they show here.</p>'}
    ${exams.length > EXAMS_SHOWN ? `<button type="button" class="linkish exams-more" data-more-exams>${board.examsOpen ? 'Show fewer' : `Show all ${exams.length}`}</button>` : ''}`;
}

function examRow(x) {
  const now = today();
  const start = x.starts_on;
  const d = dateFromIso(start);
  const ongoing = start <= now;
  const who = x.person_code
    ? `<a href="#/students/${esc(x.person_code)}">${esc(x.student_name)}</a>`
    : esc(x.student_name || (x.class ? `All of ${x.class}` : 'Whole class'));
  let when;
  if (ongoing) when = x.ends_on && x.ends_on !== now ? `On now, until ${dayMonth(x.ends_on)}` : 'Today';
  else if (start === addDays(now, 1)) when = 'Starts tomorrow';
  else when = `Starts in ${daysBetween(now, start)} days`;
  if (!ongoing && x.ends_on && x.ends_on !== start) when += `, until ${dayMonth(x.ends_on)}`;
  const sub = [x.student_name ? x.class : '', x.school, when].filter(Boolean).join('. ');
  return `
    <li class="exam-row${ongoing ? ' is-on' : ''}">
      <span class="leaf" aria-hidden="true"><span class="leaf-month">${MONTHS[d.getMonth()]}</span><span class="leaf-day">${d.getDate()}</span></span>
      <span class="exam-main">
        <span class="exam-name"><strong>${esc(x.exam || 'Exam')}</strong>, ${who}</span>
        <span class="exam-sub">${esc(sub)}</span>
      </span>
    </li>`;
}

function drawOwners() {
  const list = app.querySelector('#task-owners');
  if (!list) return;
  const names = new Set(((board.meta && board.meta.owners) || []).filter(Boolean));
  for (const t of board.tasks || []) if (t.owner) names.add(t.owner);
  for (const n of (board.meta && board.meta.teachers) || []) names.add(n);
  list.innerHTML = [...names].slice(0, 40).map((n) => `<option value="${esc(n)}"></option>`).join('');
}

/* ---------------- Adding a task ---------------- */

function wireAdd(form) {
  let pendingId = null; // the same id is sent again if the first try did not get an answer
  const error = form.querySelector('[data-add-error]');
  const title = form.elements.namedItem('title');
  title.addEventListener('input', () => { error.hidden = true; pendingId = null; });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = {
      title: title.value,
      start_on: form.elements.namedItem('start_on').value || null,
      due_on: form.elements.namedItem('due_on').value || null,
      budget: form.elements.namedItem('budget').value,
      owner: form.elements.namedItem('owner').value,
      notes: form.elements.namedItem('notes').value,
    };
    if (body.start_on && body.due_on && body.due_on < body.start_on) {
      showAddError('The end date cannot be before the start date.');
      return;
    }
    if (!body.title.trim()) {
      showAddError('Write what needs doing.');
      title.focus();
      return;
    }
    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    pendingId = pendingId || newId();
    let r = null;
    try { r = await postJson('/api/tasks', { client_id: pendingId, ...body }); } catch (err) { r = null; }
    button.disabled = false;
    if (!r || !r.data || !r.data.ok) {
      showAddError(r && r.data && r.data.error ? r.data.error : 'No internet connection. The task was not added. Try again when you are online.');
      return;
    }
    pendingId = null;
    const task = r.data.task;
    board.tasks = [task, ...(board.tasks || []).filter((t) => t.code !== task.code)];
    board.column = 'To do';
    persist();
    form.reset();
    form.querySelector('details').open = false;
    draw();
    toast(`Added to To do: ${task.title}`);
    title.focus();
  });

  function showAddError(message) {
    error.textContent = message;
    error.hidden = false;
  }
}

/* ---------------- Moving, editing and removing ---------------- */

function wireBoard(el) {
  el.addEventListener('click', (e) => {
    const target = e.target.closest('button, a');
    if (!target) return;
    if (target.hasAttribute('data-retry')) { board.failed = ''; draw(); load(); return; }
    if (target.hasAttribute('data-column')) {
      board.column = target.getAttribute('data-column');
      draw();
      return;
    }
    const card = target.closest('.task');
    if (!card) return;
    const code = card.getAttribute('data-code');
    if (target.hasAttribute('data-open')) openTask(code);
    if (target.hasAttribute('data-move')) {
      const stage = target.getAttribute('data-move');
      moveWithMessage(code, { stage });
    }
  });
  const exams = app.querySelector('[data-exams]');
  exams.addEventListener('click', (e) => {
    if (!e.target.closest('[data-more-exams]')) return;
    board.examsOpen = !board.examsOpen;
    drawExams();
  });
  wireDrag(el);
}

async function moveWithMessage(code, patch) {
  const before = find(code);
  if (!before) return;
  const from = before.stage;
  const result = await changeTask(code, patch);
  if (!result.ok) return;
  const task = result.task;
  if (task.stage !== from) {
    const back = { stage: from, position: before.position };
    toast(`Moved to ${task.stage}: ${task.title}`, { label: 'Undo', run: () => changeTask(code, back) });
  }
}

/**
 * Changes a task on the server. The board is updated straight away and put back if the change
 * could not be saved. Returns { ok, task } or { ok: false, error, fields }.
 */
async function changeTask(code, patch) {
  const task = find(code);
  if (!task) return { ok: false, error: 'This task is not on the board.' };
  const before = { ...task };
  Object.assign(task, patch);
  if (patch.stage && patch.stage !== before.stage && !('position' in patch)) {
    const others = column(patch.stage).filter((t) => t.code !== code);
    task.position = others.length ? Math.min(...others.map((t) => t.position)) - 1 : 0;
  }
  if (patch.stage === 'Done' && before.stage !== 'Done') {
    task.done_at = new Date().toISOString();
    board.justDone = code;
  } else if (patch.stage === 'To do' || patch.stage === 'Doing') {
    task.done_at = null;
  }
  draw();
  const shown = { ...task };
  let r = null;
  try { r = await postJson(`/api/tasks/${encodeURIComponent(code)}`, patch); } catch (err) { r = null; }
  if (!r || !r.data || !r.data.ok) {
    Object.assign(task, before);
    board.justDone = null;
    draw();
    const error = r && r.data && r.data.error ? r.data.error : 'No internet connection. The task was not changed.';
    if (!(r && r.status === 422)) toast(error);
    return { ok: false, error, fields: (r && r.data && r.data.fields) || {} };
  }
  Object.assign(task, r.data.task);
  persist();
  // Redraw only if the server's answer looks different, so the Done stamp is not pressed twice.
  if (!sameOnScreen(shown, task)) draw();
  return { ok: true, task };
}

function sameOnScreen(a, b) {
  return ['stage', 'title', 'start_on', 'due_on', 'budget', 'owner', 'notes', 'position'].every((k) => (a[k] ?? null) === (b[k] ?? null))
    && utcToLocalIso(a.done_at) === utcToLocalIso(b.done_at);
}

function openTask(code) {
  const t = find(code);
  if (!t) return;
  const overlay = openOverlay();
  let stage = t.stage;
  overlay.innerHTML = `
    <div class="panel" role="dialog" aria-modal="true" aria-labelledby="panel-title">
      <div class="panel-head">
        <h2 class="panel-title" id="panel-title">Task ${esc(t.code)}</h2>
        <button class="panel-close" type="button" data-close aria-label="Close">${icon('close')}</button>
      </div>
      <form class="task-edit" novalidate autocomplete="off">
        <div class="field" data-field="title">
          <label class="label" for="edit-title">What needs doing</label>
          <input id="edit-title" name="title" type="text" maxlength="200" value="${esc(t.title)}" aria-describedby="edit-title-error">
          <p class="field-error" id="edit-title-error" hidden></p>
        </div>
        <div class="field">
          <span class="label" id="edit-stage-label">Stage</span>
          <div class="segmented" role="group" aria-labelledby="edit-stage-label">
            ${TASK_STAGES.map((s) => `<button type="button" data-stage="${esc(s)}" aria-pressed="${s === stage}">${esc(s)}</button>`).join('')}
          </div>
        </div>
        <div class="field" data-field="start_on">
          <label class="label" for="edit-start">Start date</label>
          <div class="date-row">
            <input id="edit-start" name="start_on" type="date" value="${esc(t.start_on || '')}" aria-describedby="edit-start-error">
            <button type="button" class="linkish" data-clear="start_on">No date</button>
          </div>
          <p class="field-error" id="edit-start-error" hidden></p>
        </div>
        <div class="field" data-field="due_on">
          <label class="label" for="edit-due">End date</label>
          <div class="date-row">
            <input id="edit-due" name="due_on" type="date" value="${esc(t.due_on || '')}" aria-describedby="edit-due-error">
            <button type="button" class="linkish" data-clear="due_on">No date</button>
          </div>
          <p class="field-error" id="edit-due-error" hidden></p>
        </div>
        <div class="field" data-field="budget">
          <label class="label" for="edit-budget">Budget</label>
          <div class="money"><span class="money-sign" aria-hidden="true">₹</span><input id="edit-budget" name="budget" type="text" inputmode="decimal" maxlength="14" value="${esc(t.budget ?? '')}" aria-describedby="edit-budget-error"></div>
          <p class="field-error" id="edit-budget-error" hidden></p>
        </div>
        <div class="field">
          <label class="label" for="edit-owner">Owner</label>
          <input id="edit-owner" name="owner" type="text" maxlength="60" list="task-owners" value="${esc(t.owner || '')}">
        </div>
        <div class="field">
          <label class="label" for="edit-notes">Notes</label>
          <textarea id="edit-notes" name="notes" rows="3" maxlength="2000">${esc(t.notes || '')}</textarea>
        </div>
        <p class="panel-text">Added ${esc(whenSaved(t.created_at))}${t.done_at && t.stage === 'Done' ? `. Done ${esc(whenSaved(t.done_at))}` : ''}${t.changed_by ? `. Last changed by ${esc(t.changed_by)}` : ''}.</p>
        <p class="form-error" role="alert" hidden></p>
        <div class="panel-actions">
          <button class="btn btn-primary" type="submit">Save changes</button>
          <button class="btn btn-danger-quiet" type="button" data-remove>Remove from board</button>
        </div>
      </form>
    </div>`;

  const form = overlay.querySelector('form');
  overlay.querySelector('[data-close]').addEventListener('click', () => closePanel());
  for (const b of overlay.querySelectorAll('[data-stage]')) {
    b.addEventListener('click', () => {
      stage = b.getAttribute('data-stage');
      for (const x of overlay.querySelectorAll('[data-stage]')) x.setAttribute('aria-pressed', String(x === b));
    });
  }
  for (const b of overlay.querySelectorAll('[data-clear]')) {
    b.addEventListener('click', () => { form.elements.namedItem(b.getAttribute('data-clear')).value = ''; });
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    for (const p of form.querySelectorAll('.field-error, .form-error')) p.hidden = true;
    const value = (name) => form.elements.namedItem(name).value;
    const patch = {};
    if (value('title').replace(/\s+/g, ' ').trim() !== t.title) patch.title = value('title');
    // both dates go together, so the server can check the end is not before the start
    if ((value('due_on') || null) !== (t.due_on || null) || (value('start_on') || null) !== (t.start_on || null)) {
      patch.start_on = value('start_on') || null;
      patch.due_on = value('due_on') || null;
      if (patch.start_on && patch.due_on && patch.due_on < patch.start_on) {
        showError('due_on', 'The end date cannot be before the start date.');
        return;
      }
    }
    const budgetNow = value('budget').replace(/[₹,\s]/g, '');
    if (budgetNow !== (t.budget === null || t.budget === undefined ? '' : String(t.budget))) patch.budget = budgetNow;
    if (value('owner').replace(/\s+/g, ' ').trim() !== (t.owner || '')) patch.owner = value('owner');
    if (value('notes').replace(/\r\n?/g, '\n').trim() !== (t.notes || '')) patch.notes = value('notes');
    if (stage !== t.stage) patch.stage = stage;
    if (!Object.keys(patch).length) { closePanel(); return; }
    if ('title' in patch && !patch.title.trim()) {
      showError('title', 'Write what needs doing.');
      return;
    }
    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    const result = await changeTask(t.code, patch);
    button.disabled = false;
    if (result.ok) {
      closePanel();
      toast(patch.stage ? `Saved and moved to ${result.task.stage}.` : 'Changes saved.');
      return;
    }
    if (result.fields && Object.keys(result.fields).length) {
      for (const [k, m] of Object.entries(result.fields)) showError(k, m);
    } else {
      const box = form.querySelector('.form-error');
      box.textContent = result.error;
      box.hidden = false;
    }
  });

  overlay.querySelector('[data-remove]').addEventListener('click', async () => {
    const back = { stage: t.stage, position: t.position };
    const result = await changeTask(t.code, { stage: 'Removed' });
    if (!result.ok) {
      const box = form.querySelector('.form-error');
      box.textContent = result.error;
      box.hidden = false;
      return;
    }
    closePanel(false);
    toast('Removed from the board. It stays in the Google Sheet.', { label: 'Undo', run: () => changeTask(t.code, back) });
  });

  function showError(key, message) {
    const box = overlay.querySelector(`[data-field="${key}"] .field-error`) || form.querySelector('.form-error');
    box.textContent = message;
    box.hidden = false;
  }

  overlay.querySelector('#edit-title').focus();
}

/* ---------------- Dragging cards on a laptop ---------------- */

function wireDrag(el) {
  let dragging = null;
  const marker = document.createElement('li');
  marker.className = 'drop-marker';
  marker.setAttribute('aria-hidden', 'true');

  el.addEventListener('dragstart', (e) => {
    const card = e.target.closest && e.target.closest('.task');
    if (!card) return;
    dragging = card.getAttribute('data-code');
    card.classList.add('is-dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', dragging);
  });

  el.addEventListener('dragover', (e) => {
    const list = dragging && e.target.closest ? e.target.closest('[data-drop]') : null;
    if (!list) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const after = [...list.querySelectorAll('.task:not(.is-dragging)')]
      .find((c) => { const r = c.getBoundingClientRect(); return e.clientY < r.top + r.height / 2; });
    if (after) list.insertBefore(marker, after);
    else list.appendChild(marker);
  });

  el.addEventListener('drop', (e) => {
    const list = dragging && e.target.closest ? e.target.closest('[data-drop]') : null;
    if (!list) return;
    e.preventDefault();
    const stage = list.getAttribute('data-drop');
    const neighbour = (start, step) => {
      let n = start;
      while (n && !(n.classList && n.classList.contains('task') && !n.classList.contains('is-dragging'))) n = n[step];
      return n ? find(n.getAttribute('data-code')) : null;
    };
    const above = neighbour(marker.previousElementSibling, 'previousElementSibling');
    const below = neighbour(marker.nextElementSibling, 'nextElementSibling');
    let position = 0;
    if (above && below) position = (above.position + below.position) / 2;
    else if (below) position = below.position - 1;
    else if (above) position = above.position + 1;
    const code = dragging;
    finish();
    const task = find(code);
    if (task && (task.stage !== stage || task.position !== position)) {
      if (task.stage !== stage) moveWithMessage(code, { stage, position });
      else changeTask(code, { position });
    } else {
      draw();
    }
  });

  el.addEventListener('dragend', finish);

  function finish() {
    dragging = null;
    marker.remove();
    for (const c of el.querySelectorAll('.is-dragging')) c.classList.remove('is-dragging');
  }
}

if (WIDE && WIDE.addEventListener) WIDE.addEventListener('change', () => { if (ui.view === 'tasks') draw(); });

/* ---------------- Dates ---------------- */

function addDays(iso, days) {
  const d = dateFromIso(iso);
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function daysBetween(fromIso, toIso) {
  return Math.round((dateFromIso(toIso) - dateFromIso(fromIso)) / 86400000);
}

function dayMonth(iso) {
  if (!iso) return '';
  const d = dateFromIso(iso);
  if (Number.isNaN(d.getTime())) return '';
  const year = d.getFullYear() !== dateFromIso(today()).getFullYear() ? ` ${d.getFullYear()}` : '';
  return `${d.getDate()} ${MONTHS[d.getMonth()]}${year}`;
}

function weekday(iso) {
  return dateFromIso(iso).toLocaleDateString('en-IN', { weekday: 'short' });
}

function utcToLocalIso(stamp) {
  if (!stamp) return '';
  const d = new Date(stamp);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
