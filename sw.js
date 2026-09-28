/* Yadno Offline Service Worker - Version 26 */
const CACHE_NAME = 'yadno-v26';
const PREFIX = 'yadno-';

const SHELL = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png'
];

const FIREBASE_ROOT = 'https://www.gstatic.com/firebasejs/10.13.0/';
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

// ذخیره‌ی هوشمند کتابخانه‌های Firebase و وابستگی‌های آن‌ها
async function cacheFirebaseModules(cache) {
  const visited = new Set();
  const pending = FIREBASE_ENTRIES.map(name => new URL(name, FIREBASE_ROOT).href);

  while (pending.length && visited.size < 150) {
    const url = pending.shift();
    if (visited.has(url)) continue;
    visited.add(url);

    try {
      const request = new Request(url, { mode: 'cors' });
      let response = await cache.match(request);

      if (!response) {
        response = await fetch(request);
        if (!response.ok) continue;
        await cache.put(request, response.clone());
      }

      const js = await response.text();
      // الگوی بهبودیافته برای یافتن importها در کدهای مینی‌فای شده
      const imports = /(?:\bfrom\s+|import\s*\(|import\s+)(?:['"])([^'"\s]+)(?:['"])/g;
      let match;

      while ((match = imports.exec(js))) {
        const specifier = match[1];
        if (!specifier.startsWith('.') && !specifier.startsWith('https://')) continue;

        const dependency = new URL(specifier, url);
        if (dependency.hostname === 'www.gstatic.com' && !visited.has(dependency.href)) {
          pending.push(dependency.href);
        }
      }
    } catch (error) {
      console.warn('[Yadno SW] Could not precache:', url, error);
    }
  }
}

// ۱. نصب سرویس‌ورکر
self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);

    // ذخیره‌ی فایل اصلی با دور زدن کش مرورگر
    await cache.add(new Request('./index.html', { cache: 'reload' }));

    // ذخیره‌ی سایر فایل‌های پوسته
    await Promise.allSettled(
      SHELL.filter(path => path !== './index.html').map(path => cache.add(path))
    );

    // ذخیره‌ی کتابخانه‌های Firebase
    await cacheFirebaseModules(cache);

    await self.skipWaiting(); // فعال‌سازی فوری نسخه‌ی جدید
  })());
});

// ۲. فعال‌سازی و پاک‌سازی کش‌های قدیمی
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter(key => key.startsWith(PREFIX) && key !== CACHE_NAME)
        .map(key => caches.delete(key))
    );
    await self.clients.claim(); // کنترل فوری تمام تب‌های باز
  })());
});

// ۳. مدیریت درخواست‌ها (استراتژی‌های ترکیبی)
self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  const sameOrigin = url.origin === self.location.origin;
  const isNavigation = request.mode === 'navigate';

  const isShell = sameOrigin && (
    isNavigation ||
    SHELL.some(path => url.pathname === new URL(path, self.registration.scope).pathname)
  );

  // الف) فایل‌های اصلی برنامه: استراتژی Network-First با Timeout
  if (isShell) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      try {
        const network = await Promise.race([
          fetch(request),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Network timeout')), 3000))
        ]);

        if (network.ok) {
          await cache.put(request, network.clone());
        }
        return network;
      } catch (error) {
        // fallback به کش در صورت قطع اینترنت
        const cached = await cache.match(request, { ignoreSearch: true });
        if (cached) return cached;

        const fallback = await cache.match(new URL('./index.html', self.registration.scope).href);
        if (fallback) return fallback;

        return new Response('یادنو هنوز برای اجرای آفلاین آماده نشده است. لطفاً یک بار با اینترنت متصل شوید.', {
          status: 503,
          headers: { 'Content-Type': 'text/plain; charset=utf-8' }
        });
      }
    })());
    return;
  }

  // ب) کتابخانه‌های خارجی (فونت‌ها، Firebase CDN): استراتژی Cache-First (Stale-While-Revalidate)
  if (CDN_HOSTS.has(url.hostname)) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(request);

      if (cached) {
        // به‌روزرسانی پس‌زمینه‌ی کش
        event.waitUntil(
          fetch(request).then(response => {
            if (response.ok) cache.put(request, response.clone());
          }).catch(() => {})
        );
        return cached;
      }

      const response = await fetch(request);
      if (response.ok) {
        event.waitUntil(cache.put(request, response.clone()));
      }
      return response;
    })());
    return;
  }

  // ج) درخواست‌های API و Firebase (Firestore/Auth): اجازه‌ی عبور مستقیم به شبکه
  // (Firebase SDK خودش مدیریت آفلاین را در سطح کلاینت انجام می‌دهد)
});
