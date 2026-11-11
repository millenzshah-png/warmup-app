import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import react from '@vitejs/plugin-react';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';

/** Every file under a folder, as paths relative to it. */
function listFiles(dir: string, base: string = dir): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...listFiles(full, base));
    else if (!name.startsWith('.')) out.push(relative(base, full).split('\\').join('/'));
  }
  return out;
}

/** A short, stable hash of a string. Enough to name a cache. */
function hashOf(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
}

/**
 * Writes sw.js into the build. The worker caches the app shell so the app
 * opens with no connection once it has been loaded, which is what lets it
 * be added to a phone's home screen and behave like an installed app.
 */
function warmupServiceWorker(): Plugin {
  return {
    name: 'warmup-service-worker',
    apply: 'build',
    generateBundle(_options, bundle) {
      const built = Object.keys(bundle).filter((file) => !file.endsWith('.map'));
      const publicFiles = listFiles('public');
      const sizes = publicFiles.map((file) => `${file}:${statSync(join('public', file)).size}`);
      const assets = ['./', ...[...built, ...publicFiles].map((file) => `./${file}`)];
      const version = hashOf([...built, ...sizes].join('|'));
      const source = `// Generated at build time. Do not edit.
const CACHE = 'warmup-${version}';
const ASSETS = ${JSON.stringify(assets, null, 2)};

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
`;
      this.emitFile({ type: 'asset', fileName: 'sw.js', source });
    },
  };
}

export default defineConfig({
  // Relative asset paths, so the build runs from any folder or sub-path.
  base: './',
  plugins: [react(), warmupServiceWorker()],
  build: { target: 'es2022' },
  server: { port: 5173, strictPort: false },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
