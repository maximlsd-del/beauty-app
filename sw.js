/* sw.js — сервис-воркер PWA «Мои Записи».
 *
 * Задача шага 1: оболочка открывается офлайн. Данные пользователя лежат
 * в localStorage и сервис-воркером не читаются, не кэшируются и не изменяются.
 *
 * Стратегии:
 *   - свои статические файлы оболочки → «сначала кэш, потом сеть» с обновлением кэша;
 *   - всё остальное → обычный поход в сеть.
 *
 * ВАЖНО: пути относительные (./), приложение живёт и в корне домена,
 * и в подпапке /beauty-app/ на GitHub Pages, и при локальном открытии.
 */

/* При изменении списка файлов или их содержимого — поднять версию. */
var CACHE_NAME = 'moi-zapisi-shell-v19';

/* Файлы оболочки: перечислены только те, что реально есть в beauty-app/.
   js/clients.js добавлен шагом 3 — экран «Клиенты» и подсказки в форме записи.
   js/services.js добавлен шагом 4 — каталог услуг и экран «Ещё» (темы оформления).
   js/backup.js добавлен шагом 5 — копия базы, восстановление и установка PWA.
   js/report.js добавлен шагом 6 — расходы и настоящий отчёт с прибылью.
   js/care.js добавлен шагом 7 — чёрный список, спящие и дни рождения.
   js/remind.js добавлен шагом 8 — напоминания о записях и сводка при открытии.
   js/broadcast.js добавлен шагом 9 — экран рассылки: очередь по одному получателю. */
var PRECACHE_URLS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/base.css',
  './css/app.css',
  './css/extra.css',
  './js/nozoom.js',
  './js/store.js',
  './js/app.js',
  './js/clients.js',
  './js/care.js',
  './js/services.js',
  './js/report.js',
  './js/backup.js',
  './js/remind.js',
  './js/broadcast.js',
  './icons/icon-180.png',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

var SHELL_EXTENSIONS = ['.html', '.css', '.js', '.webmanifest', '.png', '.jpg', '.jpeg',
  '.webp', '.svg', '.ico', '.woff', '.woff2', '.json'];

function isShellAsset(pathname) {
  if (pathname.charAt(pathname.length - 1) === '/') return true;
  for (var i = 0; i < SHELL_EXTENSIONS.length; i++) {
    var ext = SHELL_EXTENSIONS[i];
    if (pathname.length >= ext.length &&
        pathname.slice(pathname.length - ext.length).toLowerCase() === ext) {
      return true;
    }
  }
  return false;
}

/* ---------- install: предкэш оболочки ---------- */
self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) {
      /* Каждый файл кладём отдельно: отсутствие одного не срывает установку. */
      return Promise.all(PRECACHE_URLS.map(function (url) {
        return cache.add(new Request(url, { cache: 'reload' })).catch(function () {
          return null;
        });
      }));
    }).then(function () {
      return self.skipWaiting();
    })
  );
});

/* ---------- activate: убрать кэши прежних версий ---------- */
self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (names) {
      return Promise.all(names.map(function (name) {
        if (name !== CACHE_NAME) return caches.delete(name);
        return null;
      }));
    }).then(function () {
      return self.clients.claim();
    })
  );
});

/* ---------- fetch ---------- */
function cacheFirst(request) {
  return caches.open(CACHE_NAME).then(function (cache) {
    /* Сеть запрашиваем сразу, но ответ отдаём только если в кэше пусто:
       это обновляет копию при следующем запуске и не тормозит текущий. */
    var network = fetch(request).then(function (response) {
      if (response && response.ok && response.type === 'basic') {
        cache.put(request, response.clone());
      }
      return response;
    }).catch(function () {
      return null;
    });

    return cache.match(request).then(function (cached) {
      if (cached) return cached;
      return network.then(function (response) {
        if (response) return response;
        if (request.mode === 'navigate') {
          return cache.match('./index.html').then(function (fallback) {
            if (fallback) return fallback;
            return new Response('Нет сети', { status: 503, statusText: 'Offline' });
          });
        }
        return new Response('Нет сети', { status: 503, statusText: 'Offline' });
      });
    });
  });
}

self.addEventListener('fetch', function (event) {
  var request = event.request;
  if (request.method !== 'GET') return;   /* данные пользователя не трогаем */

  var url;
  try {
    url = new URL(request.url);
  } catch (e) {
    return;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;

  /* Чужие домены и остальные запросы — как обычно, в сеть. */
  if (url.origin !== self.location.origin) return;
  if (!isShellAsset(url.pathname)) return;

  event.respondWith(cacheFirst(request));
});
