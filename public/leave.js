// SuccessPath Classes: leave requests from the teacher portal, as the office sees them.
//
// They wait on the Teachers page, on the teacher's page and in the notification bell, each with
// Approve and Decline. Approving saves ordinary Teacher leave, so the calendar shows it.

import { esc, postJson, toast, shortDate, whenSaved } from './lib.js';

export async function decideLeave(code, action, name, note) {
  let res;
  try {
    res = await postJson(`/api/leave-requests/${code}`, { action, note });
  } catch (err) {
    toast('No internet connection. Try again when you are online.');
    return false;
  }
  if (res.status !== 200 || !res.data || !res.data.ok) {
    if (res.status !== 401) toast((res.data && res.data.error) || 'That did not work. Please try again.');
    if (res.status !== 409) return false;
    window.dispatchEvent(new CustomEvent('sp:leave-decided')); // answered already: show how
    return true;
  }
  toast(action === 'approve' ? `Leave approved for ${name}. It is on the calendar.` : `Leave declined for ${name}.`);
  window.dispatchEvent(new CustomEvent('sp:leave-decided'));
  return true;
}

export function spanText(from, to) {
  return to && to !== from ? `${shortDate(from)} to ${shortDate(to)}` : shortDate(from);
}

const STATUS = {
  Pending: ['badge--due', 'Waiting for you'], Approved: ['badge--ok', 'Approved'],
  Declined: ['badge--muted', 'Declined'], Withdrawn: ['badge--muted', 'Withdrawn'],
};

/** A list of leave requests; the waiting ones get Approve and Decline (with an optional note). */
export function requestsHtml(requests, { names = true } = {}) {
  return `<ul class="history leave-requests">${requests.map((r) => `
    <li class="h-row" data-request="${esc(r.code)}">
      <span class="h-date">${esc(spanText(r.from, r.to))}</span>
      <span class="h-main">${names ? `<a href="#/teachers/${esc(r.person_code)}"><strong>${esc(r.name)}</strong></a>, ` : ''}${esc(r.reason || 'leave')}
        <span class="badge ${STATUS[r.status][0]}">${STATUS[r.status][1]}</span></span>
      ${r.notes ? `<span class="h-sub h-note">${esc(r.notes)}</span>` : ''}
      ${r.decision_note ? `<span class="h-sub">Note: ${esc(r.decision_note)}</span>` : ''}
      <span class="h-sub">${esc(r.code)}, asked ${esc(whenSaved(r.created_at))}${r.leave_code ? `, saved as ${esc(r.leave_code)}` : ''}</span>
      ${r.status === 'Pending' ? `
      <span class="h-sub request-actions">
        <button type="button" class="btn btn-primary" data-decide="approve" data-code="${esc(r.code)}" data-name="${esc(r.name)}">Approve</button>
        <button type="button" class="btn btn-quiet" data-decide="decline" data-code="${esc(r.code)}" data-name="${esc(r.name)}">Decline</button>
      </span>` : ''}
    </li>`).join('')}</ul>`;
}

/** Wires the Approve and Decline buttons in `host`; `after` runs once a request is decided. */
export function wireRequests(host, after) {
  host.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-decide]');
    if (!b) return;
    const code = b.getAttribute('data-code');
    const name = b.getAttribute('data-name');
    const action = b.getAttribute('data-decide');
    const row = b.closest('[data-request]');
    if (action === 'decline' && !row.querySelector('[data-decline-note]')) {
      // first tap: ask for a short note the teacher will see
      b.insertAdjacentHTML('afterend', `
        <span class="decline-box">
          <label class="label" for="note-${esc(code)}">Note for ${esc(name)} (optional)</label>
          <input id="note-${esc(code)}" type="text" maxlength="300" data-decline-note placeholder="For example: exams that week">
          <button type="button" class="btn btn-quiet" data-decide="decline" data-code="${esc(code)}" data-name="${esc(name)}">Decline the request</button>
        </span>`);
      b.remove();
      row.querySelector('[data-decline-note]').focus();
      return;
    }
    for (const x of row.querySelectorAll('button')) x.disabled = true;
    const note = action === 'decline' ? (row.querySelector('[data-decline-note]') || {}).value : undefined;
    const done = await decideLeave(code, action, name, note);
    if (done) after();
    else for (const x of row.querySelectorAll('button')) x.disabled = false;
  });
}

