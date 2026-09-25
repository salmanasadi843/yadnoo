const CACHE_NAME = 'yadno-shell-v2';
const SHELL_FILES = [
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png'
];

// Third-party origins the app needs to fully boot and function (Firebase SDK
// modules, the Vazirmatn font + its CSS, and the PDF/Word export libraries).
// We don't know their exact sub-resource URLs in advance (they can change
// between versions), so instead of a brittle hardcoded list we cache
// whatever actually gets fetched from these hosts the first time the app
// runs online, then serve that from cache afterwards.
const RUNTIME_CACHE_HOSTS = [
  'fonts.googleapis.com',
  'fonts.gstatic.com',
  'cdnjs.cloudflare.com',
  'www.gstatic.com'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_FILES))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  const isShellFile = SHELL_FILES.some((f) => url.pathname.endsWith(f.replace('./', '')));

  if (isShellFile) {
    // App shell: cache-first, so the app itself opens instantly offline.
    event.respondWith(
      caches.match(event.request).then((cached) => cached || fetch(event.request))
    );
    return;
  }

  if (RUNTIME_CACHE_HOSTS.includes(url.hostname)) {
    // Firebase SDK chunks, fonts, and export libraries: stale-while-revalidate.
    // Serve instantly from cache if we have it (works offline), and always
    // refresh the cache in the background when online so updates still land.
    event.respondWith(
      caches.open(CACHE_NAME).then(async (cache) => {
        const cached = await cache.match(event.request);
        const networkFetch = fetch(event.request).then((response) => {
          if (response && response.ok) cache.put(event.request, response.clone());
          return response;
        }).catch(() => cached); // offline and not cached yet: nothing we can do
        return cached || networkFetch;
      })
    );
    return;
  }

  // Everything else (Firestore, Auth, Storage API calls): straight to
  // network, never cached — Firestore's own local persistence already
  // handles offline reads/writes for actual data.
});
