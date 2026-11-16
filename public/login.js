// SuccessPath Classes: the login screen, for the office app and the teacher and student portals.
//
// The office logs in with the office password (ADMIN_PASSWORD on the server). Teachers and students
// log in with their username (name and the year they joined) and the shared portal password.
// A login is kept by the browser for months, so it is asked for rarely.

import { APP_NAME } from './forms.js';
import { app, ui, esc, postJson, getJson } from './lib.js';

const TEXT = {
  admin: {
    title: 'Office login',
    lead: 'Enter the office password. This phone or laptop then stays logged in for a year.',
    user: false,
  },
  teacher: {
    title: 'Teacher portal',
    lead: 'Your username is your name and the year you joined, for example anitanegi2025.',
    user: true,
  },
  student: {
    title: 'Student portal',
    lead: 'Your username is your name and the year you joined, for example rahulsharma2026.',
    user: true,
  },
};

/** Draws the login screen. `onDone` runs after a good login. */
export function renderLogin(role, onDone, message) {
  const t = TEXT[role];
  ui.view = 'login';
  ui.form = null;
  document.title = `${t.title} | ${APP_NAME}`;
  app.innerHTML = `
    <main class="login">
      <form class="login-card" novalidate>
        <p class="login-org">${esc(APP_NAME)}</p>
        <h1 class="login-title">${esc(t.title)}</h1>
        <p class="login-lead">${esc(t.lead)}</p>
        ${message ? `<p class="notice">${esc(message)}</p>` : ''}
        ${t.user ? `
        <div class="field">
          <label class="label" for="login-user">Username</label>
          <input id="login-user" name="username" type="text" autocapitalize="none" autocomplete="username" spellcheck="false" maxlength="80">
        </div>` : ''}
        <div class="field">
          <label class="label" for="login-pass">Password</label>
          <input id="login-pass" name="password" type="password" autocomplete="current-password" maxlength="120">
        </div>
        <p class="form-error" role="alert" hidden></p>
        <button class="btn btn-primary" type="submit">Log in</button>
        ${t.user ? '<p class="login-help">Forgot your username? The office can tell you.</p>' : ''}
      </form>
    </main>`;
  const form = app.querySelector('form');
  const box = form.querySelector('.form-error');
  form.elements.namedItem(t.user ? 'username' : 'password').focus();
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    box.hidden = true;
    const username = t.user ? form.elements.namedItem('username').value : '';
    const password = form.elements.namedItem('password').value;
    if ((t.user && !username.trim()) || !password) {
      box.textContent = t.user ? 'Enter your username and password.' : 'Enter the office password.';
      box.hidden = false;
      return;
    }
    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    button.textContent = 'Logging in…';
    let res;
    try {
      res = await postJson('/api/login', { role, username, password });
    } catch (err) {
      res = { status: 0, data: { error: 'No internet connection. Try again when you are online.' } };
    }
    button.disabled = false;
    button.textContent = 'Log in';
    if (res.status === 200 && res.data && res.data.ok) {
      onDone(res.data);
      return;
    }
    box.textContent = (res.data && res.data.error) || 'That did not work. Please try again.';
    box.hidden = false;
    form.elements.namedItem('password').value = '';
    form.elements.namedItem('password').focus();
  });
}

/** Is this device logged in? null when there is no internet. */
export async function checkSession(role) {
  try {
    return await getJson(`/api/session?role=${role}`);
  } catch (err) {
    return null;
  }
}

export async function logOut(role) {
  try {
    await postJson('/api/logout', { role });
  } catch (err) {
    /* offline: try again later */
  }
}
