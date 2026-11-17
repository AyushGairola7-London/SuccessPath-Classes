// SuccessPath Classes: lets the page open even without internet.
// Always tries the internet first, so updates you deploy show up straight away.
// Entries are never stored here; the page keeps unsent entries itself.

const CACHE = 'successpath-v3-2';
const SHELL = [
  '/',
  '/app.js',
  '/lib.js',
  '/entry.js',
  '/people.js',
  '/tasks.js',
  '/calendar.js',
  '/leave.js',
  '/log.js',
  '/edit.js',
  '/analytics.js',
  '/login.js',
  '/portal.js',
  '/teacher/',
  '/student/',
  '/forms.js',
  '/styles.css',
  '/manifest.webmanifest',
  '/icons/icon.svg',
  '/icons/icon-192.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin === self.location.origin) {
    if (url.pathname.startsWith('/api/')) return; // never keep server answers
    event.respondWith(networkFirst(request));
  } else if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    event.respondWith(cacheFirst(request));
  }
});

async function networkFirst(request) {
  const cache = await caches.open(CACHE);
  try {
    const response = await fetch(request);
    if (response.ok && !response.redirected) cache.put(request, response.clone());
    return response;
  } catch (err) {
    const cached = await cache.match(request, { ignoreSearch: true });
    if (cached) return cached;
    if (request.mode === 'navigate') {
      // each app opens its own page: the office app, or the teacher or student portal
      const path = new URL(request.url).pathname;
      const page = path.startsWith('/teacher') ? '/teacher/' : path.startsWith('/student') ? '/student/' : '/';
      const shell = await cache.match(page);
      if (shell) return shell;
    }
    throw err;
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok || response.type === 'opaque') cache.put(request, response.clone());
  return response;
}
