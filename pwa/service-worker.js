// Tormenta de Ideas — service worker
// Estrategia:
//   - shell (HTML/CSS/JS/manifest/iconos): cache-first, actualiza en background
//   - datos (fetches a Supabase): network-first, sin cache

const VERSION = 'tormenta-shell-v5';
const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/app.css',
  './js/app.js',
  './js/storage.js',
  './js/voice.js',
  './js/pin.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-180.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(VERSION).then((cache) => cache.addAll(SHELL).catch(() => {}))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(names.filter((n) => n !== VERSION).map((n) => caches.delete(n)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // No cachear POST/PUT ni orígenes remotos (Supabase, R2, etc.)
  if (req.method !== 'GET') return;
  if (url.origin !== location.origin) return;

  // Shell del app: cache-first
  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) {
        // refresh en background
        fetch(req).then((fresh) => {
          if (fresh && fresh.status === 200) {
            caches.open(VERSION).then((c) => c.put(req, fresh.clone()));
          }
        }).catch(() => {});
        return cached;
      }
      return fetch(req).then((fresh) => {
        if (fresh && fresh.status === 200) {
          const copy = fresh.clone();
          caches.open(VERSION).then((c) => c.put(req, copy));
        }
        return fresh;
      }).catch(() => caches.match('./index.html'));
    })
  );
});
