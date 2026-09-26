
/* Yadno Offline Service Worker - sw2.js */
const CACHE_NAME = 'yadno-shell-v4';
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

// ذخیره کتابخانه‌های Firebase و وابستگی‌های آن‌ها
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

        await cache.put(request, response.clone());
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

        const dependency = new URL(specifier, url);

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

// نصب سرویس‌ورکر
self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);

    // ذخیره فایل اصلی
    await cache.add(
      new Request('./index.html', {
        cache: 'reload'
      })
    );

    // ذخیره سایر فایل‌های برنامه
    await Promise.allSettled(
      SHELL
        .filter(path => path !== './index.html')
        .map(path => cache.add(path))
    );

    // ذخیره کتابخانه‌های Firebase
    await cacheFirebaseModules(cache);

    await self.skipWaiting();
  })());
});

// فعال‌سازی و پاک‌سازی کش‌های قدیمی برنامه
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();

    await Promise.all(
      keys
        .filter(
          key =>
            key.startsWith(PREFIX) &&
            key !== CACHE_NAME
        )
        .map(key => caches.delete(key))
    );

    await self.clients.claim();
  })());
});

// مدیریت درخواست‌ها
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

  // فایل‌های اصلی برنامه:
  // ابتدا اینترنت، سپس نسخه ذخیره‌شده
  if (isShell) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);

      try {
        const network = await Promise.race([
          fetch(request),

          new Promise((_, reject) =>
            setTimeout(
              () => reject(
                new Error('Network timeout')
              ),
              3500
            )
          )
        ]);

        if (network.ok) {
          await cache.put(
            request,
            network.clone()
          );
        }

        return network;

      } catch (error) {
        const cached =
          await cache.match(
            request,
            { ignoreSearch: true }
          );

        if (cached) return cached;

        const fallback =
          await cache.match(
            new URL(
              './index.html',
              self.registration.scope
            ).href
          );

        if (fallback) return fallback;

        return new Response(
          'یادنو هنوز برای اجرای آفلاین ذخیره نشده است. یک بار با اینترنت برنامه را باز کنید.',
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

  // کتابخانه‌های خارجی:
  // ابتدا کش، سپس اینترنت
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

    return;
  }

  // درخواست‌های Firestore و Authentication
  // توسط خود Firebase مدیریت می‌شوند.
});
