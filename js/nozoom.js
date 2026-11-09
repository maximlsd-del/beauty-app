/* nozoom.js — надёжная блокировка масштабирования страницы: щипок двумя пальцами,
   зум по двойному тапу и зум трекпадом (Ctrl + прокрутка).

   ПОЧЕМУ ОТДЕЛЬНЫЙ ФАЙЛ И ПЕРВЫМ СКРИПТОМ.
   Раньше блокировка лежала в конце js/extra.js — если выше по файлу что-то падало,
   до неё выполнение не доходило. Здесь файл подключается первым (до data.js/app.js)
   и не зависит ни от чужого кода, ни от готовности DOM.

   СЛОИ ЗАЩИТЫ (работают вместе, отказ одного не ломает остальные).
     1) CSS (css/base.css): html,body{touch-action:pan-y} — движок применяет это
        до скриптов. pan-y разрешает вертикальную прокрутку и запрещает pinch-zoom
        и двойной тап. Прежнее значение manipulation щипок РАЗРЕШАЛО, потому что
        по спецификации manipulation = pan-x pan-y pinch-zoom.
     2) Этот файл, для Safari/iOS, где одному CSS доверять нельзя:
        - gesturestart / gesturechange / gestureend с preventDefault
          (щипок в iOS приходит именно этими событиями, они всплывают до window,
          поэтому слушаем window И document в фазе перехвата — capture);
        - touchmove с двумя пальцами (страховка для браузеров без gesture-событий);
        - wheel с ctrlKey — зум трекпадом на компьютере;
        - dblclick — ТОЛЬКО на сенсорных устройствах: на компьютере двойной клик
          обязан продолжать выделять слово (это была отдельная жалоба заказчика).
     Всё обёрнуто в try/catch: если API нет, страница работает как обычно и не падает.

   ДИАГНОСТИКА. window.__nozoom = { gesture, touch2, wheel, dbl, attached }.
   Счётчики растут в обработчиках, attached становится true после навешивания.
   Живую страницу с этими счётчиками см. в макет/nozoom-test.html. */
(function () {
  'use strict';

  /* ── 1. Счётчики диагностики (создаём как можно раньше, до проверок API) ── */
  var diag = { gesture: 0, touch2: 0, wheel: 0, dbl: 0, attached: false };
  var host = null, doc = null;
  try {
    if (typeof window !== 'undefined' && window) host = window;
    else if (typeof globalThis !== 'undefined') host = globalThis;
  } catch (_) {}
  try { if (typeof document !== 'undefined' && document) doc = document; } catch (_) {}

  try {
    if (host && host.__nozoom && typeof host.__nozoom === 'object') {
      diag = host.__nozoom;            // файл подключён повторно — не обнуляем счётчики
    } else if (host) {
      host.__nozoom = diag;
    }
  } catch (_) {}
  ['gesture', 'touch2', 'wheel', 'dbl'].forEach(function (k) {
    if (typeof diag[k] !== 'number') diag[k] = 0;
  });
  if (diag.attached === undefined) diag.attached = false;

  /* ── 2. Сенсорное ли устройство (для dblclick это принципиально) ── */
  function isTouchDevice() {
    try {
      if (typeof navigator !== 'undefined' && navigator && navigator.maxTouchPoints > 0) return true;
    } catch (_) {}
    try {
      if (host && ('ontouchstart' in host)) return true;
    } catch (_) {}
    return false;
  }
  var TOUCH = isTouchDevice();

  /* ── 3. Гашение события без падений ── */
  function prevent(e) {
    try { if (e && typeof e.preventDefault === 'function') e.preventDefault(); } catch (_) {}
  }

  /* ── 4. Обработчики ── */
  function onGesture(e) {                       // gesturestart / gesturechange / gestureend — Safari iOS
    diag.gesture++;
    prevent(e);
  }
  function onTouchMove(e) {                     // два пальца на экране = жест масштабирования
    try {
      if (e && e.touches && e.touches.length > 1) { diag.touch2++; prevent(e); }
    } catch (_) {}
  }
  function onWheel(e) {                         // зум трекпадом: Ctrl + прокрутка
    try {
      if (e && e.ctrlKey) { diag.wheel++; prevent(e); }
    } catch (_) {}
  }
  function onDblClick(e) {                      // только сенсор: на ПК двойной клик выделяет слово
    if (!TOUCH) return;
    diag.dbl++;
    prevent(e);
  }

  /* ── 5. Навешивание с фолбэком «без options» для старых движков ── */
  function on(target, type, fn, opts) {
    try {
      if (!target || typeof target.addEventListener !== 'function') return false;
      target.addEventListener(type, fn, opts);
      return true;
    } catch (_) {
      try { target.addEventListener(type, fn, false); return true; } catch (__) { return false; }
    }
  }

  /* ── 6. Только фаза перехвата и non-passive: иначе preventDefault не действует ── */
  var CAPTURE = { capture: true, passive: false };

  function attach() {
    var ok = false;
    var gestures = ['gesturestart', 'gesturechange', 'gestureend'];
    for (var i = 0; i < gestures.length; i++) {
      ok = on(host, gestures[i], onGesture, CAPTURE) || ok;
      ok = on(doc, gestures[i], onGesture, CAPTURE) || ok;   // событие всплывает: ловим на обоих
    }
    ok = on(host, 'touchmove', onTouchMove, CAPTURE) || ok;
    ok = on(doc, 'touchmove', onTouchMove, CAPTURE) || ok;
    ok = on(host, 'wheel', onWheel, CAPTURE) || ok;
    ok = on(doc, 'wheel', onWheel, CAPTURE) || ok;
    ok = on(host, 'dblclick', onDblClick, CAPTURE) || ok;
    ok = on(doc, 'dblclick', onDblClick, CAPTURE) || ok;
    if (ok) diag.attached = true;
  }

  /* ── 7. Навешиваем сразу и подтверждаем на DOMContentLoaded ──
     window и document существуют уже во время разбора страницы, поэтому первый
     проход делаем немедленно (обработчики нужны до первого касания). Если документ
     ещё грузился — повторяем на DOMContentLoaded: повторный addEventListener с тем
     же обработчиком и той же фазой браузер игнорирует, вреда нет, а если первый
     проход почему-то не состоялся, второй его добьёт. */
  try { attach(); } catch (_) {}
  try {
    if (doc && doc.readyState === 'loading' && typeof doc.addEventListener === 'function') {
      doc.addEventListener('DOMContentLoaded', function () {
        try { attach(); } catch (_) {}
      }, false);
    }
  } catch (_) {}
})();
