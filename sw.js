// Коммуналка — service worker
// Оболочка приложения кэшируется, данные (Supabase) всегда идут из сети.
const VERSION = 'kom-v3';
const SHELL = [
  '/',
  '/index.html',
  '/styles.css',
  '/app.js',
  '/forecast.js',
  '/ui.js',
  '/screens.js',
  '/entry.js',
  '/manifest.webmanifest',
  '/icon-192.png',
  '/icon-512.png',
  '/icon-180.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(VERSION)
      .then((c) => c.addAll(SHELL).catch(() => {}))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Данные Supabase и Google Apps Script — только сеть, без кэша
  if (url.hostname.endsWith('supabase.co') || url.hostname.endsWith('google.com')) return;

  // Навигация: сеть, при офлайне — последняя сохранённая оболочка
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put('/index.html', copy));
          return res;
        })
        .catch(() => caches.match('/index.html').then((r) => r || caches.match('/')))
    );
    return;
  }

  // Свои файлы (скрипты, стили): сначала сеть — обновления видны сразу, офлайн берём из кэша
  if (url.origin === location.origin && !/\.(png|ico|svg)$/.test(url.pathname)) {
    e.respondWith(
      fetch(req)
        .then((res) => {
          if (res && res.status === 200) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(req, copy)); }
          return res;
        })
        .catch(() => caches.match(req))
    );
    return;
  }

  // Иконки и CDN-библиотеки: кэш, затем сеть
  e.respondWith(
    caches.match(req).then((hit) => hit || fetch(req).then((res) => {
      if (res && (res.status === 200 || res.type === 'opaque')) {
        const copy = res.clone();
        caches.open(VERSION).then((c) => c.put(req, copy));
      }
      return res;
    }).catch(() => new Response('', { status: 504, statusText: 'offline' })))
  );
});
