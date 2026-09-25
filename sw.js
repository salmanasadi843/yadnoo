
/* Yadno offline service worker v3 */
const CACHE_NAME = 'yadno-shell-v3';
const PREFIX = 'yadno-shell-';

const SHELL = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png'
];

const FIREBASE_ROOT =
  'https://www.gstatic.com/firebasejs/10.13.0/';

const FIREBASE_ENTRIES = [
  'firebase-app.js',
  'firebase-auth.js',
  'firebase-firestore.js',
  'firebase-storage.js'
];

const CDN_HOSTS = new Set([
  'www.gstatic.com',
  'cdnjs.cloudflare.com',
  'fonts.googleapis.com',
  'fonts.gstatic.com'
]);

// ذخیره ماژول‌های Firebase و وابستگی‌های آنها
async function cacheFirebaseModules(cache) {
  const visited = new Set();

  const pending = FIREBASE_ENTRIES.map(
    name => new URL(name, FIREBASE_ROOT).href
  );

  while (pending.length && visited.size < 120) {
    const url = pending.shift();

    if (visited.has(url)) continue;
    visited.add(url);

    try {
      const request = new Request(url, {
        mode: 'cors'
      });

      let response = await cache.match(request);

      if (!response) {
        response = await fetch(request);

        if (!response.ok) continue;

        await cache.put(
          request,
          response.clone()
        );
      }

      const js = await response.text();

      const imports =
        /(?:\bfrom\s*|\bimport\s*\(|\bimport\s*)(?:['"])([^'"\s]+)(?:['"])/g;

      let match;

      while ((match = imports.exec(js))) {
        const specifier = match[1];

        if (
          !specifier.startsWith('.') &&
          !specifier.startsWith('https://')
        ) {
          continue;
        }

        const dependency = new URL(
          specifier,
          url
        );

        if (
          dependency.hostname === 'www.gstatic.com' &&
          !visited.has(dependency.href)
        ) {
          pending.push(dependency.href);
        }
      }

    } catch (error) {
      console.warn(
        '[Yadno offline] Could not precache:',
        url,
        error
      );
    }
  }
}

// نصب و ذخیره فایل‌های ضروری
self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);

    await cache.add('./index.html');

    await Promise.allSettled(
      SHELL
        .filter(x => x !== './index.html')
        .map(x => cache.add(x))
    );

    await cacheFirebaseModules(cache);

    await self.skipWaiting();
  })());
});

// فعال‌سازی و پاک‌سازی کش‌های قدیمی یادنو
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();

    await Promise.all(
      keys
        .filter(
          k =>
            k.startsWith(PREFIX) &&
            k !== CACHE_NAME
        )
        .map(k => caches.delete(k))
    );

    await self.clients.claim();
  })());
});

// پاسخ به درخواست‌های برنامه
self.addEventListener('fetch', event => {
  const request = event.request;

  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  const sameOrigin =
    url.origin === self.location.origin;

  const isNavigation =
    request.mode === 'navigate';

  const isShell =
    sameOrigin &&
    (
      isNavigation ||
      SHELL.some(
        path =>
          url.pathname ===
          new URL(
            path,
            self.registration.scope
          ).pathname
      )
    );

  // فایل‌های اصلی: ابتدا اینترنت، سپس کش
  if (isShell) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);

      try {
        const network = await fetch(request);

        if (network.ok) {
          await cache.put(
            request,
            network.clone()
          );
        }

        return network;

      } catch (_) {
        return (
          await cache.match(
            request,
            { ignoreSearch: true }
          )
        ) || (
          await cache.match(
            new URL(
              './index.html',
              self.registration.scope
            ).href
          )
        ) || new Response(
          'یادنو هنوز برای اجرای آفلاین ذخیره نشده است. یک بار با اینترنت باز کنید.',
          {
            status: 503,
            headers: {
              'Content-Type':
                'text/plain; charset=utf-8'
            }
          }
        );
      }
    })());

    return;
  }

  // کتابخانه‌های خارجی: ابتدا کش
  if (CDN_HOSTS.has(url.hostname)) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);

      const cached = await cache.match(request);

      if (cached) {
        event.waitUntil(
          fetch(request)
            .then(response => {
              if (response.ok) {
                return cache.put(
                  request,
                  response.clone()
                );
              }
            })
            .catch(() => {})
        );

        return cached;
      }

      const response = await fetch(request);

      if (response.ok) {
        event.waitUntil(
          cache.put(
            request,
            response.clone()
          )
        );
      }

      return response;
    })());
  }

  // درخواست‌های Firestore و Authentication
  // به خود Firebase واگذار می‌شوند.
});
