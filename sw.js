// Generated at build time. Do not edit.
const CACHE = 'warmup-6k5gtq';
const ASSETS = [
  "./",
  "./assets/index-BJpNRjU6.js",
  "./assets/index-ESlrAVLR.css",
  "./icons/apple-touch-icon.png",
  "./icons/favicon.png",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-512.png",
  "./img/hem-logo.webp",
  "./img/hoodie-back.webp",
  "./img/hoodie-front.webp",
  "./img/hoodie-thumb.webp",
  "./img/logo.webp",
  "./img/shop-black-front.jpg",
  "./img/shop-bone-back.jpg",
  "./manifest.webmanifest"
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(ASSETS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith('warmup-') && key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  if (new URL(request.url).origin !== self.location.origin) return;
  if (request.mode === 'navigate') {
    // Prefer a fresh page, fall back to the cached shell when offline.
    event.respondWith(fetch(request).catch(() => caches.match('./index.html').then((hit) => hit || caches.match('./'))));
    return;
  }
  event.respondWith(caches.match(request).then((hit) => hit || fetch(request)));
});
