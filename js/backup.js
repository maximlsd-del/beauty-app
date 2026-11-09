/* backup.js — сохранность данных и установка PWA «Мои Записи» (шаг 5).
 *
 * Что делает файл:
 *   - «Сохранить копию» на экране «Ещё»: файл мои-записи-ГГГГ-ММ-ДД.json.
 *     Сначала пробуем нативный «Поделиться» (на iPhone только он отдаёт файл
 *     в «Файлы»/iCloud), а если он не умеет файлы — скачиваем через Blob и
 *     ссылку с атрибутом download;
 *   - после успешного сохранения пишет в состояние settings.lastBackup —
 *     локальную дату «ГГГГ-ММ-ДД»;
 *   - напоминание на экране «Записи»: баннер, если копии не было ни разу или
 *     ей больше 14 дней; баннер закрывается на сегодня; на пустой базе не виден;
 *   - «Восстановить из файла»: выбор файла, FileReader, проверка через
 *     MZ.store.import (он НЕ применяет), показ количества записей и клиентов и
 *     даты файла, подтверждение, затем MZ.store.applyImport — он сам кладёт
 *     прежнее состояние в beauty_app_backup_before_import;
 *   - карточка установки на «Ещё»: «Установлено» / кнопка из beforeinstallprompt /
 *     пошаговая инструкция для iOS Safari и честное предупреждение о том, что
 *     у установленного приложения отдельное хранилище;
 *   - онбординг с установкой при первом запуске: показывается один раз, факт
 *     показа хранится в состоянии (settings.installCardSeenOn).
 *
 * Правила контракта (beauty-pwa-ПЛАН.md):
 *   - даты только локальные: «ГГГГ-ММ-ДД» собирается из getFullYear/getMonth/getDate;
 *     перевод даты в UTC здесь запрещён — он сдвигал день на сутки в UTC+;
 *   - никаких пользовательских данных в inline-обработчиках: только addEventListener,
 *     textContent и data-атрибуты;
 *   - состояние читается и пишется только через MZ.store, своих ключей файл не заводит;
 *   - без внешних зависимостей: всё, чего нет в браузере, честно отключается текстом.
 */
(function () {
  'use strict';

  var MZ = window.MZ;
  if (!MZ || !MZ.store) return;

  var $ = function (sel) { return document.querySelector(sel); };
  var $$ = function (sel) { return Array.prototype.slice.call(document.querySelectorAll(sel)); };

  var BACKUP_EVERY_DAYS = 14;
  var MON = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
    'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];

  /* ---------- даты: только локальные ---------- */

  function pad2(n) { return n < 10 ? '0' + n : String(n); }

  function isoLocal(d) {
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }

  function todayISO() { return isoLocal(new Date()); }

  /* Разбор «ГГГГ-ММ-ДД» в полдень: перевод часов не перекидывает дату. */
  function parseISO(value) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value === null || value === undefined ? '' : value));
    if (!m) return null;
    var d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0, 0);
    return isFinite(d.getTime()) ? d : null;
  }

  function humanDate(iso) {
    var d = parseISO(iso);
    return d ? d.getDate() + ' ' + MON[d.getMonth()] + ' ' + d.getFullYear() : '';
  }

  /* Сколько целых дней прошло с даты копии. Считаем по полудням, без UTC. */
  function daysSince(iso) {
    var d = parseISO(iso);
    if (!d) return null;
    var now = new Date();
    var base = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12, 0, 0, 0);
    return Math.round((base.getTime() - d.getTime()) / 86400000);
  }

  function plural(n, one, few, many) {
    var abs = Math.abs(Number(n) || 0) % 100;
    var last = abs % 10;
    if (abs > 10 && abs < 20) return many;
    if (last === 1) return one;
    if (last >= 2 && last <= 4) return few;
    return many;
  }

  /* ---------- состояние ---------- */

  function state() { return MZ.state || MZ.store.load(); }

  function settings() {
    var s = state();
    if (!s.settings || typeof s.settings !== 'object') s.settings = {};
    return s.settings;
  }

  function records() {
    var s = state();
    return Array.isArray(s.records) ? s.records : [];
  }

  function clients() {
    var s = state();
    return Array.isArray(s.clients) ? s.clients : [];
  }

  function recordCount() { return records().length; }
  function clientCount() { return clients().length; }

  /* Точечная запись настроек: объект состояния — тот же, что у js/app.js,
     поэтому внесённое значение уже видно интерфейсу; на диск кладём через стор. */
  function saveLight() {
    var saved = MZ.store.save(state());
    return saved;
  }

  /* Полная замена состояния (после восстановления из файла): экраны рисуются
     от объекта в замыкании js/app.js, поэтому его нужно принять и перерисовать всё. */
  function reloadFromStore() {
    var fresh = MZ.store.load();
    if (typeof MZ.adoptState === 'function') {
      MZ.adoptState(fresh);
    } else {
      Object.defineProperty(MZ, 'state', { get: function () { return fresh; }, configurable: true });
    }
    redrawAll();
    return fresh;
  }

  function redrawAll() {
    if (MZ.clientsScreen && typeof MZ.clientsScreen.render === 'function') MZ.clientsScreen.render();
    if (MZ.servicesScreen && typeof MZ.servicesScreen.render === 'function') MZ.servicesScreen.render();
    if (MZ.moreScreen && typeof MZ.moreScreen.renderThemes === 'function') MZ.moreScreen.renderThemes();
    refresh();
  }

  function refresh() {
    renderBanner();
    renderAbout();
    renderInstall();
  }

  /* ---------- сообщения на «Ещё» ---------- */

  function showMsg(text, isError) {
    var el = $('#backupMsg');
    if (!el) return;
    el.textContent = String(text === null || text === undefined ? '' : text);
    el.hidden = !el.textContent;
    if (el.classList && typeof el.classList.toggle === 'function') {
      el.classList.toggle('is-err', !!isError);
    }
  }

  /* ---------- копия файла целиком ---------- */

  function fileName(date) {
    return 'мои-записи-' + isoLocal(date) + '.json';
  }

  function payloadFor(date) {
    var data;
    try {
      data = (typeof MZ.store.export === 'function') ? MZ.store.export() : MZ.store.normalize(state());
    } catch (e) {
      data = MZ.store.normalize(state());
    }
    var copy;
    try {
      copy = JSON.parse(JSON.stringify(data));
    } catch (e) {
      copy = data;
    }
    if (!copy || typeof copy !== 'object') copy = {};
    copy.schemaVersion = MZ.store.SCHEMA_VERSION || 2;
    copy.exportedAt = isoLocal(date) + ' ' + pad2(date.getHours()) + ':' + pad2(date.getMinutes());
    if (!copy.settings || typeof copy.settings !== 'object') copy.settings = {};
    copy.settings.lastBackup = isoLocal(date);
    return copy;
  }

  function textOf(payload) {
    try {
      return JSON.stringify(payload, null, 2);
    } catch (e) {
      return '';
    }
  }

  /* ---------- возможности платформы ---------- */

  function downloadSupported() {
    try {
      return typeof Blob !== 'undefined' && typeof document !== 'undefined' && document &&
        typeof document.createElement === 'function';
    } catch (e) { return false; }
  }

  function shareSupported() {
    try {
      if (typeof navigator === 'undefined' || !navigator || typeof navigator.share !== 'function') return false;
      if (typeof File !== 'function') return false;
      return true;
    } catch (e) { return false; }
  }

  function canShareFiles(file) {
    if (!file) return false;
    try {
      if (typeof navigator === 'undefined' || !navigator || typeof navigator.share !== 'function') return false;
      if (typeof navigator.canShare === 'function') return !!navigator.canShare({ files: [file] });
      return true;   /* canShare нет — пробуем нативный обмен и ловим ошибку */
    } catch (e) { return false; }
  }

  function exportSupported() {
    try {
      return downloadSupported() || shareSupported();
    } catch (e) { return false; }
  }

  function makeFile(text, name) {
    if (typeof Blob === 'undefined' || typeof File !== 'function') return null;
    try {
      return new File([new Blob([text], { type: 'application/json' })], name, { type: 'application/json' });
    } catch (e) {
      return null;
    }
  }

  function download(text, name) {
    if (!downloadSupported()) {
      return { ok: false, method: 'download', fileName: name, error: 'браузер не умеет сохранять файлы' };
    }

    var url = '';
    try {
      var blob = new Blob([text], { type: 'application/json;charset=utf-8' });
      if (typeof URL !== 'undefined' && URL && typeof URL.createObjectURL === 'function') {
        url = URL.createObjectURL(blob);
      }
    } catch (e) { url = ''; }
    if (!url) url = 'data:application/json;charset=utf-8,' + encodeURIComponent(text);

    var a = null;
    try { a = document.createElement('a'); } catch (e) { a = null; }
    if (!a || typeof a.click !== 'function') {
      return { ok: false, method: 'download', fileName: name, error: 'браузер не даёт скачать файл' };
    }

    a.href = url;
    a.download = name;
    a.rel = 'noopener';
    if (typeof a.setAttribute === 'function') a.setAttribute('download', name);

    /* Ссылку на один клик добавляем в документ: так работает и Safari, и Chrome. */
    var host = document.body || document.documentElement;
    var attached = false;
    if (host && typeof host.appendChild === 'function') {
      try { host.appendChild(a); attached = true; } catch (e) { attached = false; }
    }

    try {
      a.click();
    } catch (e) {
      return { ok: false, method: 'download', fileName: name, error: 'браузер заблокировал скачивание' };
    }

    if (attached && host && typeof host.removeChild === 'function') {
      try { host.removeChild(a); } catch (e) { /* ссылка не критична */ }
    }
    if (url.indexOf('blob:') === 0 && typeof URL !== 'undefined' && URL &&
        typeof URL.revokeObjectURL === 'function') {
      setTimeout(function () {
        try { URL.revokeObjectURL(url); } catch (e) { /* уже освобождён */ }
      }, 1000);
    }

    return { ok: true, method: 'download', fileName: name, error: null };
  }

  /* ---------- отметка об успешной копии ---------- */

  function markBackup(date) {
    var s = settings();
    s.lastBackup = isoLocal(date);
    delete s.backupBannerHiddenOn;    /* свежая копия снимает «скрыто на сегодня» */
    saveLight();
    refresh();
    return s.lastBackup;
  }

  function savedMessage(date) {
    return 'Копия сохранена. Файл лежит в Загрузках (или в Файлах на iPhone). ' +
      'Дата копии: ' + humanDate(isoLocal(date)) + '.';
  }

  /* ---------- «Сохранить копию» ---------- */

  var exporting = false;

  function afterShare(date, name) {
    markBackup(date);
    showMsg(savedMessage(date), false);
    return { ok: true, method: 'share', fileName: name, error: null };
  }

  function afterDownload(text, name, date) {
    var res = download(text, name);
    if (!res.ok) {
      showMsg('Не удалось сохранить файл: ' + (res.error || 'браузер не поддерживает сохранение') +
        '. Данные в приложении целы — попробуйте ещё раз.', true);
      return res;
    }
    markBackup(date);
    showMsg(savedMessage(date), false);
    return res;
  }

  function saveCopy() {
    if (exporting) {
      return Promise.resolve({ ok: false, busy: true, error: 'Сохранение уже идёт.' });
    }

    if (!exportSupported()) {
      showMsg('Этот браузер не умеет сохранять файл. Откройте приложение в Safari или Chrome — ' +
        'данные внутри целы.', true);
      return Promise.resolve({ ok: false, error: 'платформа не поддерживает сохранение файла' });
    }

    var date = new Date();
    var name = fileName(date);
    var payload = payloadFor(date);
    var text = textOf(payload);

    if (!text) {
      showMsg('Не удалось собрать копию: состояние не читается. Данные в приложении целы.', true);
      return Promise.resolve({ ok: false, error: 'не удалось собрать файл' });
    }

    var file = makeFile(text, name);

    if (canShareFiles(file)) {
      exporting = true;
      var shared;
      try {
        shared = navigator.share({ files: [file], title: 'Мои Записи — копия базы' });
      } catch (e) {
        exporting = false;
        return Promise.resolve(afterDownload(text, name, date));
      }
      if (!shared || typeof shared.then !== 'function') {
        exporting = false;
        return Promise.resolve(afterShare(date, name));
      }
      return shared.then(function () {
        exporting = false;
        return afterShare(date, name);
      }).catch(function (err) {
        exporting = false;
        var code = String((err && (err.name || err.message)) || '');
        if (/abort|cancel|отмен/i.test(code)) {
          showMsg('Сохранение отменено. Копия не записана, данные в приложении целы.', true);
          return { ok: false, canceled: true, method: 'share', fileName: name, error: 'отменено' };
        }
        return afterDownload(text, name, date);
      });
    }

    return Promise.resolve(afterDownload(text, name, date));
  }

  /* ---------- баннер напоминания на экране «Записи» ---------- */

  function bannerReason() {
    if (!recordCount()) return null;                    /* нет данных — не о чем напоминать */
    var s = settings();
    if (s.backupBannerHiddenOn === todayISO()) return null;   /* закрыт на сегодня */
    var last = s.lastBackup || null;
    if (!last) return { kind: 'never', days: null, last: null };
    var days = daysSince(last);
    if (days === null) return { kind: 'never', days: null, last: null };
    if (days > BACKUP_EVERY_DAYS) return { kind: 'stale', days: days, last: last };
    return null;
  }

  function renderBanner() {
    var box = $('#backupBanner');
    if (!box) return;

    var reason = bannerReason();
    var saveBtn = $('#backupBannerSave');
    var hideBtn = $('#backupBannerHide');
    if (saveBtn) saveBtn.disabled = !exportSupported();

    if (!reason) {
      box.hidden = true;
      return;
    }

    box.hidden = false;
    var title = $('#backupBannerTitle');
    var text = $('#backupBannerText');

    if (title) {
      title.textContent = reason.kind === 'never'
        ? 'Копия не сохранялась ни разу'
        : 'Копия не сохранялась ' + reason.days + ' ' + plural(reason.days, 'день', 'дня', 'дней');
    }
    if (text) {
      text.textContent = reason.kind === 'never'
        ? 'Если браузер очистит данные сайта, записи пропадут. Сохраните копию — это один файл.'
        : 'Последняя копия — ' + humanDate(reason.last) + '. Сделайте новую, чтобы не потерять записи.';
    }
    if (hideBtn) hideBtn.disabled = false;
  }

  function hideBannerForToday() {
    var s = settings();
    s.backupBannerHiddenOn = todayISO();
    saveLight();
    renderBanner();
    return s.backupBannerHiddenOn;
  }

  /* ---------- «О приложении»: дата последней копии ---------- */

  function renderAbout() {
    var el = $('#aboutBackup');
    if (!el) return;
    var last = settings().lastBackup;
    el.textContent = last ? humanDate(last) : 'Копия ещё не сохранялась';
  }

  /* ---------- восстановление из файла ---------- */

  var pending = null;      /* { data, counts, name, date } — прочитано, ждёт подтверждения */

  function fileInputSupported() {
    var input = $('#backupFile');
    if (!input || typeof input.click !== 'function') return false;
    return typeof FileReader !== 'undefined';
  }

  function resetFileInput() {
    var input = $('#backupFile');
    if (!input) return;
    try { input.value = ''; } catch (e) { /* некоторые браузеры запрещают */ }
  }

  function hidePreview() {
    var box = $('#restorePreview');
    if (box) box.hidden = true;
  }

  function renderPreview() {
    var box = $('#restorePreview');
    if (!box || !pending) return;
    box.hidden = false;

    var meta = $('#restoreMeta');
    if (meta) {
      meta.textContent = 'В файле: ' + pending.counts.records + ' ' +
        plural(pending.counts.records, 'запись', 'записи', 'записей') + ' и ' +
        pending.counts.clients + ' ' + plural(pending.counts.clients, 'клиент', 'клиента', 'клиентов') +
        '. Дата файла: ' + (pending.date ? humanDate(pending.date) : 'не указана') + '.';
    }
    var btn = $('#restoreApply');
    if (btn) btn.disabled = false;
  }

  function fileDate(data, name) {
    var raw = '';
    if (data && typeof data === 'object') {
      raw = data.exportedAt || data.savedAt || data.createdAt || '';
    }
    var m = /^(\d{4}-\d{2}-\d{2})/.exec(String(raw === null || raw === undefined ? '' : raw));
    if (m) return m[1];
    var fromName = /(\d{4}-\d{2}-\d{2})/.exec(String(name || ''));
    return fromName ? fromName[1] : null;
  }

  function failRestore(message) {
    pending = null;
    hidePreview();
    showMsg(message, true);
    return null;
  }

  /* Проверка содержимого файла: стор говорит, годится ли он, но НЕ применяет. */
  function handleText(text, name) {
    pending = null;
    hidePreview();

    if (!String(text === null || text === undefined ? '' : text).trim()) {
      return failRestore('Файл пустой — в нём нет данных. Текущие данные не тронуты.');
    }

    var data = null;
    try {
      data = JSON.parse(text);
    } catch (e) {
      return failRestore('Файл повреждён: это не JSON. Похоже, файл открыли и сохранили в другой ' +
        'программе. Текущие данные не тронуты.');
    }

    var check = null;
    try {
      check = (typeof MZ.store.import === 'function') ? MZ.store.import(data) : null;
    } catch (e) {
      check = { ok: false, error: 'Не удалось прочитать файл: ' +
        String(e && e.message ? e.message : 'ошибка разбора') + '. Текущие данные не тронуты.' };
    }

    if (!check || !check.ok) {
      return failRestore((check && check.error) || 'Это не файл «Мои Записи». Текущие данные не тронуты.');
    }

    var counts = check.counts || { records: 0, clients: 0 };
    pending = {
      data: data,
      counts: {
        records: Number(counts.records) || 0,
        clients: Number(counts.clients) || 0
      },
      name: String(name || ''),
      date: fileDate(data, name)
    };

    renderPreview();
    showMsg('Файл прочитан. Проверьте, что внутри, и подтвердите восстановление.', false);
    return pending;
  }

  function onFileChosen() {
    var input = $('#backupFile');
    if (!input) return;

    var files = input.files;
    if (!files || !files.length) return;      /* выбор отменили — молчим, данные целы */
    var file = files[0];

    if (typeof FileReader === 'undefined') {
      failRestore('Браузер не умеет читать файлы. Откройте приложение в Safari или Chrome.');
      return;
    }

    var reader = null;
    try { reader = new FileReader(); } catch (e) { reader = null; }
    if (!reader) {
      failRestore('Браузер не умеет читать файлы. Откройте приложение в Safari или Chrome.');
      return;
    }

    reader.onerror = function () {
      failRestore('Не удалось прочитать файл. Попробуйте другой файл — текущие данные не тронуты.');
    };
    reader.onload = function () {
      var text = reader.result === null || reader.result === undefined ? '' : String(reader.result);
      var name = '';
      try { name = file && file.name ? String(file.name) : ''; } catch (e) { name = ''; }
      handleText(text, name);
      resetFileInput();
    };

    try {
      reader.readAsText(file);
    } catch (e) {
      failRestore('Не удалось прочитать файл. Попробуйте другой файл — текущие данные не тронуты.');
    }
  }

  function openPicker() {
    var input = $('#backupFile');
    if (!input) return null;

    if (!fileInputSupported()) {
      showMsg('Этот браузер не умеет выбирать файлы. Откройте приложение в Safari или Chrome — ' +
        'текущие данные целы.', true);
      return null;
    }

    try {
      input.click();
    } catch (e) {
      showMsg('Не удалось открыть выбор файла. Попробуйте ещё раз.', true);
      return null;
    }
    return input;
  }

  function cancelRestore() {
    pending = null;
    hidePreview();
    resetFileInput();
    showMsg('Восстановление отменено. Данные в приложении не изменились.', true);
    return null;
  }

  function applyRestore() {
    if (!pending) {
      showMsg('Сначала выберите файл копии.', true);
      return { ok: false, error: 'файл не выбран' };
    }

    var counts = pending.counts;
    var result = null;
    try {
      result = MZ.store.applyImport(pending.data);
    } catch (e) {
      result = { ok: false, error: 'Не удалось восстановить данные: ' +
        String(e && e.message ? e.message : 'ошибка') + '. Текущие данные не изменены.' };
    }

    if (!result || !result.ok) {
      return failRestore((result && result.error) ||
        'Не удалось восстановить данные. Текущие данные не изменены.');
    }

    pending = null;
    hidePreview();
    resetFileInput();

    /* applyImport уже заменил состояние и сохранил прежнее в резервную копию;
       теперь нужно принять новое состояние интерфейсом и перерисовать экраны. */
    reloadFromStore();

    showMsg('Данные восстановлены: ' + counts.records + ' ' +
      plural(counts.records, 'запись', 'записи', 'записей') + ' и ' +
      counts.clients + ' ' + plural(counts.clients, 'клиент', 'клиента', 'клиентов') +
      '. Прежние данные сохранены в резервной копии.', false);

    return { ok: true, counts: counts };
  }

  /* ---------- установка на телефон ---------- */

  var deferredPrompt = null;
  var installedEvent = false;

  function ua() {
    try {
      return String((typeof navigator !== 'undefined' && navigator && navigator.userAgent) || '');
    } catch (e) { return ''; }
  }

  function hasTouch() {
    try { return !!(navigator && Number(navigator.maxTouchPoints) > 1); } catch (e) { return false; }
  }

  function isIOS() {
    var s = ua();
    return /iPad|iPhone|iPod/.test(s) || (/Macintosh/.test(s) && hasTouch());
  }

  function isIOSSafari() {
    return isIOS() && !/CriOS|FxiOS|EdgiOS|OPiOS|YaBrowser/i.test(ua());
  }

  function isAndroid() { return /Android/i.test(ua()); }

  function isStandalone() {
    if (installedEvent) return true;
    try {
      if (typeof navigator !== 'undefined' && navigator && navigator.standalone === true) return true;
    } catch (e) { /* доступа к navigator нет — идём дальше */ }
    try {
      if (typeof window !== 'undefined' && typeof window.matchMedia === 'function' &&
          window.matchMedia('(display-mode: standalone)').matches) return true;
    } catch (e) { /* matchMedia может отсутствовать */ }
    return false;
  }

  function platform() {
    if (isStandalone()) return 'installed';
    if (isIOSSafari()) return 'ios';
    if (isIOS()) return 'ios-other';
    if (isAndroid()) return 'android';
    return 'desktop';
  }

  function renderInstall() {
    var statusEl = $('#installState');
    if (!statusEl) return;

    var steps = $('#installSteps');
    var note = $('#installNote');
    var btn = $('#installBtn');
    var saveBtn = $('#installSaveCopy');
    var installed = isStandalone();
    var total = recordCount() + clientCount();

    if (installed) {
      statusEl.textContent = 'Установлено';
      if (steps) { steps.hidden = true; steps.textContent = ''; }
      if (btn) { btn.hidden = true; btn.disabled = true; }
      if (saveBtn) saveBtn.hidden = !total;
      if (note) {
        if (total) {
          note.hidden = false;
          note.textContent = 'В браузере остались данные (' + recordCount() + ' ' +
            plural(recordCount(), 'запись', 'записи', 'записей') + '). Сохраните копию и восстановите её ' +
            'в установленном приложении — хранилища у них разные.';
        } else {
          note.hidden = true;
          note.textContent = '';
        }
      }
      return;
    }

    if (saveBtn) saveBtn.hidden = true;
    if (note) { note.hidden = true; note.textContent = ''; }

    if (deferredPrompt) {
      statusEl.textContent = 'Можно установить';
      if (btn) { btn.hidden = false; btn.disabled = false; btn.textContent = 'Установить'; }
      if (steps) {
        steps.hidden = false;
        steps.textContent = 'Нажмите «Установить» — браузер предложит добавить приложение на главный экран.';
      }
      return;
    }

    if (btn) { btn.hidden = true; btn.disabled = true; }

    if (isIOSSafari()) {
      statusEl.textContent = 'Установка на iPhone — вручную';
      if (steps) {
        steps.hidden = false;
        steps.textContent = '1. Нажмите «Поделиться» внизу экрана Safari.\n' +
          '2. Выберите «На экран „Домой“».\n' +
          '3. Нажмите «Добавить» — значок «Записи» появится на домашнем экране.';
      }
      return;
    }

    if (isIOS()) {
      statusEl.textContent = 'Откройте страницу в Safari';
      if (steps) {
        steps.hidden = false;
        steps.textContent = 'На iPhone установка возможна только из Safari: откройте эту страницу ' +
          'в Safari и нажмите «Поделиться» → «На экран „Домой“».';
      }
      return;
    }

    if (isAndroid()) {
      statusEl.textContent = 'Можно установить из меню браузера';
      if (steps) {
        steps.hidden = false;
        steps.textContent = 'Меню браузера (⋮) → «Установить приложение» или «Добавить на главный экран».';
      }
      return;
    }

    statusEl.textContent = 'Откройте страницу на телефоне';
    if (steps) {
      steps.hidden = false;
      steps.textContent = 'На iPhone откройте эту страницу в Safari, на Android — в Chrome. ' +
        'С компьютера приложение не устанавливается: откройте его на телефоне, а копию базы ' +
        'можно сохранить и здесь.';
    }
  }

  function installNow() {
    if (!deferredPrompt) return null;
    var prompt = deferredPrompt;
    deferredPrompt = null;

    try {
      if (typeof prompt.prompt === 'function') prompt.prompt();
    } catch (e) {
      renderInstall();
      return null;
    }

    var choice = null;
    try { choice = prompt.userChoice; } catch (e) { choice = null; }

    var finish = function (accepted) {
      if (accepted) installedEvent = true;
      renderInstall();
      if (accepted) {
        showInstallMsg('Приложение устанавливается. Дальше порядок такой: сохранить копию → ' +
          'открыть установленное приложение → восстановить данные из файла.');
      } else {
        showInstallMsg('Установку отменили. Можно попробовать позже — данные в браузере целы.');
      }
    };

    if (choice && typeof choice.then === 'function') {
      choice.then(function (res) {
        finish(!!(res && res.outcome === 'accepted'));
      }).catch(function () { renderInstall(); });
    } else {
      renderInstall();
    }
    return prompt;
  }

  function showInstallMsg(text) {
    var el = $('#installMsg');
    if (!el) return;
    el.textContent = text;
    el.hidden = !text;
  }

  function onBeforeInstall(event) {
    if (event && typeof event.preventDefault === 'function') event.preventDefault();
    deferredPrompt = event || null;
    renderInstall();
  }

  function onInstalled() {
    deferredPrompt = null;
    installedEvent = true;
    renderInstall();
  }

  try { window.addEventListener('beforeinstallprompt', onBeforeInstall); } catch (e) { /* старый браузер */ }
  try { window.addEventListener('appinstalled', onInstalled); } catch (e) { /* старый браузер */ }

  /* ---------- онбординг с установкой: один раз ---------- */

  function initIntro() {
    var card = $('#installIntro');
    if (!card) return;

    var s = settings();
    if (s.installCardSeenOn) { card.hidden = true; return; }
    if (isStandalone()) { card.hidden = true; return; }

    card.hidden = false;
    s.installCardSeenOn = todayISO();
    saveLight();
  }

  /* ---------- обработчики ---------- */

  var btnSaveCopy = $('#btnSaveCopy');
  if (btnSaveCopy) btnSaveCopy.addEventListener('click', function () { saveCopy(); });

  var btnRestore = $('#btnRestore');
  if (btnRestore) btnRestore.addEventListener('click', openPicker);

  var backupFile = $('#backupFile');
  if (backupFile) backupFile.addEventListener('change', onFileChosen);

  var restoreApply = $('#restoreApply');
  if (restoreApply) restoreApply.addEventListener('click', applyRestore);

  var restoreCancel = $('#restoreCancel');
  if (restoreCancel) restoreCancel.addEventListener('click', cancelRestore);

  var bannerSave = $('#backupBannerSave');
  if (bannerSave) bannerSave.addEventListener('click', function () { saveCopy(); });

  var bannerHide = $('#backupBannerHide');
  if (bannerHide) bannerHide.addEventListener('click', hideBannerForToday);

  var installBtn = $('#installBtn');
  if (installBtn) installBtn.addEventListener('click', installNow);

  var installSave = $('#installSaveCopy');
  if (installSave) installSave.addEventListener('click', function () { saveCopy(); });

  var introGo = $('#installIntroGo');
  if (introGo) introGo.addEventListener('click', function () {
    var card = $('#installIntro');
    if (card) card.hidden = true;
    if (typeof MZ.go === 'function') MZ.go('more');
    renderInstall();
  });

  var introLater = $('#installIntroLater');
  if (introLater) introLater.addEventListener('click', function () {
    var card = $('#installIntro');
    if (card) card.hidden = true;
  });

  /* ---------- старт ---------- */

  if (!exportSupported()) {
    if (btnSaveCopy) {
      btnSaveCopy.disabled = true;
      btnSaveCopy.title = 'Браузер не умеет сохранять файл';
    }
    showMsg('Этот браузер не умеет сохранять файл. Откройте приложение в Safari или Chrome: ' +
      'данные внутри целы, но копию из этого браузера сделать нельзя.', true);
  }

  if (!fileInputSupported() && btnRestore) {
    btnRestore.disabled = true;
    btnRestore.title = 'Браузер не умеет выбирать файл';
  }

  renderBanner();
  renderAbout();
  renderInstall();
  initIntro();

  /* ---------- API для следующих шагов и для стенда ---------- */

  MZ.backupScreen = {
    render: refresh,
    saveCopy: saveCopy,
    fileName: function (date) { return fileName(date instanceof Date ? date : new Date()); },
    payload: function (date) { return payloadFor(date instanceof Date ? date : new Date()); },
    supported: exportSupported,
    supportsShare: shareSupported,
    openPicker: openPicker,
    readText: function (text, name) { return handleText(text, name); },
    pending: function () { return pending; },
    confirmRestore: applyRestore,
    cancelRestore: cancelRestore,
    bannerReason: bannerReason,
    hideBannerForToday: hideBannerForToday,
    lastBackup: function () { return settings().lastBackup || null; },
    installed: isStandalone,
    platform: platform,
    installNow: installNow,
    hasDeferredPrompt: function () { return !!deferredPrompt; }
  };

  if (MZ.moreScreen) {
    MZ.moreScreen.backup = refresh;
    MZ.moreScreen.saveCopy = saveCopy;
    MZ.moreScreen.lastBackup = function () { return settings().lastBackup || null; };
  }
})();
