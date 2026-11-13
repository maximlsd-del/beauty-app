/* services.js — каталог услуг и экран «Ещё» PWA «Мои Записи».
 *
 * Что делает файл:
 *   - рисует экран «Услуги и цены» (#s-services): название, цена и длительность
 *     каждой услуги, действия «Изменить» и «Удалить», кнопка «Добавить услугу»
 *     и пустое состояние, когда каталог пуст;
 *   - открывает шит услуги #sheetSvc (разметка из макета, макет/index.html #sheetSvc)
 *     на создание и на правку: поля название/цена/минут, сохранение и удаление
 *     с подтверждением;
 *   - добавляет услугу прямо из формы записи: кнопка «+ Новая услуга» (#fNewSvc)
 *     открывает тот же шит, а после сохранения новая услуга сразу встаёт в выбор
 *     формы записи с подставленными ценой и длительностью (MZ.pickService из js/app.js);
 *   - собирает экран «Ещё»: переключатель шести тем оформления (применяет и сохраняет
 *     MZ.setTheme) и пункт «Каталог услуг» — тот же путь, что в макете:
 *     «Ещё» → «Каталог услуг» → #s-services, назад — кнопкой «Ещё».
 *
 * Услуга — контракт v2: {id, name, price, minutes} (beauty-pwa-ПЛАН.md).
 * Помощники выбора услуги (renderSvcOptions / onServiceChange / findService / pickService)
 * живут в js/app.js и переиспользуются здесь, а не дублируются.
 *
 * Правила контракта:
 *   - даты только локальные, toISOString() не используется (в этом файле дат нет вовсе);
 *   - никаких имён в inline-onclick: только addEventListener, data-id и esc()/textContent;
 *   - списки и подсказки — В ПОТОКЕ, absolute-позиционирования здесь нет;
 *   - цвета — только из переменных тем (образцы палитры заданы в css/app.css).
 */
(function () {
  'use strict';

  var MZ = window.MZ;
  if (!MZ || !MZ.store) return;

  var $ = function (sel) { return document.querySelector(sel); };
  var $$ = function (sel) { return Array.prototype.slice.call(document.querySelectorAll(sel)); };

  /* ---------- состояние и мелкие помощники ---------- */

  function state() { return MZ.state || MZ.store.load(); }

  function services() {
    var s = state();
    if (!Array.isArray(s.services)) s.services = [];
    return s.services;
  }

  function asName(value) {
    return String(value === null || value === undefined ? '' : value).replace(/\s+/g, ' ').trim();
  }

  function esc(value) {
    if (typeof MZ.esc === 'function') return MZ.esc(value);
    return String(value === null || value === undefined ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function money(value) {
    return typeof MZ.money === 'function' ? MZ.money(value) : String(Number(value) || 0);
  }

  function cur() {
    var s = state().settings;
    return (s && s.currency) || '₽';
  }

  function val(sel) {
    var el = $(sel);
    return el ? String(el.value === null || el.value === undefined ? '' : el.value) : '';
  }

  function setVal(sel, value) {
    var el = $(sel);
    if (el) el.value = String(value === null || value === undefined ? '' : value);
  }

  function num(sel, fallback) {
    var n = Number(val(sel));
    return isFinite(n) ? n : (Number(fallback) || 0);
  }

  function plural(n, one, few, many) {
    var abs = Math.abs(Number(n) || 0) % 100;
    var last = abs % 10;
    if (abs > 10 && abs < 20) return many;
    if (last === 1) return one;
    if (last >= 2 && last <= 4) return few;
    return many;
  }

  function findSvc(id) {
    var key = String(id);
    var list = services();
    for (var i = 0; i < list.length; i++) {
      if (String(list[i].id) === key) return list[i];
    }
    return null;
  }

  /* Сколько записей ссылается на услугу. Считаем по снимку названия и по id:
     после удаления услуги связь по id остаётся, а название живёт в самой записи. */
  function usedIn(id) {
    var key = String(id);
    var svc = findSvc(id);
    var name = svc ? asName(svc.name).toLowerCase() : '';
    var list = state().records;
    if (!Array.isArray(list)) return 0;
    return list.filter(function (r) {
      /* В записи может быть несколько услуг: id ищется в каждой, а не только в первой. */
      var items = Array.isArray(r.services) && r.services.length
        ? r.services
        : [{ serviceId: r.serviceId, svcName: r.svcName }];
      return items.some(function (it) {
        if (String(it.serviceId) === key) return true;
        return !!name && asName(it.svcName).toLowerCase() === name;
      });
    }).length;
  }

  /* Свободный id услуги вида s3, s4… — без Date.now(), чтобы id не зависел от часов.
     Занятыми считаются и id, на которые ещё ссылаются записи: удалённую услугу нельзя
     «переиспользовать» под новым названием, иначе старая запись молча получит другое
     название (в записи живёт снимок svcName, а ссылка serviceId осталась прежней). */
  function newServiceId() {
    var used = {};
    services().forEach(function (s) { used[String(s.id)] = true; });
    var list = state().records;
    if (Array.isArray(list)) {
      list.forEach(function (r) {
        (Array.isArray(r.services) && r.services.length ? r.services : [r]).forEach(function (it) {
          if (it && it.serviceId) used[String(it.serviceId)] = true;
        });
      });
    }
    var n = 1;
    while (used['s' + n]) n++;
    return 's' + n;
  }

  /* Пока открыт шит услуги, содержимое .screens не прокручивается. Замок один на всё
     приложение и живёт в js/app.js (syncScrollLock сторожит и #sheetNew, и #sheetSvc):
     здесь только просим пересчитать состояние после того, как переключили hidden.
     Поэтому шит услуги, открытый ПОВЕРХ шита записи, не разблокирует фон при закрытии. */
  function syncLock() {
    if (typeof MZ.syncScrollLock === 'function') MZ.syncScrollLock();
  }

  /* ---------- экран «Услуги и цены» ---------- */

  function rowHTML(s) {
    return '<div class="svc-row">' +
      '<span class="svc-info"><b class="svc-name">' + esc(s.name || 'Без названия') + '</b>' +
      '<span class="muted">' + esc(s.minutes) + ' мин · ' + money(s.price) + ' ' + esc(cur()) + '</span></span>' +
      '<span class="svc-acts">' +
      '<button class="mini-btn" type="button" data-act="edit" data-id="' + esc(s.id) + '">Изменить</button>' +
      '<button class="mini-btn is-danger" type="button" data-act="del" data-id="' + esc(s.id) + '">Удалить</button>' +
      '</span></div>';
  }

  function renderSvcList() {
    var box = $('#svcList');
    if (!box) return;

    var list = services();
    box.innerHTML = list.map(rowHTML).join('');

    $$('#svcList [data-act="edit"]').forEach(function (b) {
      b.addEventListener('click', function () { openSheet(b.dataset.id, 'list'); });
    });
    $$('#svcList [data-act="del"]').forEach(function (b) {
      b.addEventListener('click', function () { remove(b.dataset.id); });
    });

    var empty = $('#svcEmpty');
    if (empty) {
      empty.hidden = list.length > 0;
      empty.textContent = 'Услуг нет. Добавьте первую — кнопкой ниже.';
    }
  }

  /* ---------- шит услуги: создание, правка, удаление ---------- */

  var editId = null;          /* null — новая услуга, иначе id правимой */
  var fromForm = false;       /* шит открыт из формы записи — после сохранения выберем там */

  function showErr(text) {
    var el = $('#gErr');
    if (!el) return;
    if (text) { el.textContent = text; el.hidden = false; }
    else { el.textContent = ''; el.hidden = true; }
  }

  function openSheet(id, from) {
    var sheet = $('#sheetSvc');
    if (!sheet) return;

    var svc = id ? findSvc(id) : null;
    editId = svc ? String(svc.id) : null;
    fromForm = from === 'form';

    var title = $('#svcTitle');
    if (title) title.textContent = svc ? 'Услуга' : 'Новая услуга';

    setVal('#gName', svc ? svc.name : '');
    setVal('#gPrice', svc ? svc.price : 2000);
    setVal('#gDur', svc ? svc.minutes : 60);

    var del = $('#gDel');
    if (del) del.hidden = !svc;

    showErr('');
    sheet.hidden = false;
    syncLock();

    var nameEl = $('#gName');
    if (nameEl && typeof nameEl.focus === 'function') {
      try { nameEl.focus(); } catch (e) { /* фокус не критичен */ }
    }
  }

  function closeSheet() {
    var sheet = $('#sheetSvc');
    if (sheet) sheet.hidden = true;
    editId = null;
    fromForm = false;
    showErr('');
    syncLock();
  }

  /* Сохранение: создаём услугу или правим существующую. Если шит открыт из формы записи,
     новая услуга сразу выбирается в ней с подставленными ценой и длительностью. */
  function save(e) {
    if (e && typeof e.preventDefault === 'function') e.preventDefault();

    var name = asName(val('#gName'));
    if (!name) { showErr('Введите название услуги.'); return; }

    var price = Math.round(num('#gPrice', 0));
    if (price < 0) price = 0;
    var minutes = Math.round(num('#gDur', 60));
    if (minutes <= 0) minutes = 60;

    var s = state();
    var savedId;
    var target = editId ? findSvc(editId) : null;

    if (target) {
      target.name = name;
      target.price = price;
      target.minutes = minutes;
      savedId = String(target.id);
    } else {
      var created = { id: newServiceId(), name: name, price: price, minutes: minutes };
      services().push(created);
      savedId = String(created.id);
    }

    MZ.store.save(s);
    var backToForm = fromForm;
    closeSheet();
    renderSvcList();

    /* Форма записи: новая или изменённая услуга должна быть видна в выборе сразу. */
    if (backToForm && typeof MZ.pickService === 'function') MZ.pickService(savedId);
    else if (typeof MZ.refreshFormAfterServices === 'function') MZ.refreshFormAfterServices();
  }

  /* Удаление услуги. Записи не трогаем: в записи хранится снимок названия (svcName),
     поэтому история остаётся читаемой — об этом честно сказано в подтверждении. */
  function remove(id) {
    var svc = findSvc(id);
    if (!svc) return;

    var count = usedIn(id);
    var question = 'Удалить услугу «' + svc.name + '» из каталога?';
    if (count) {
      question = 'Услуга «' + svc.name + '» встречается в ' + count + ' ' +
        plural(count, 'записи', 'записях', 'записях') +
        '. Записи останутся в журнале и сохранят название «' + svc.name + '». ' +
        'Удалить услугу из каталога?';
    }

    var agreed = true;
    if (typeof confirm === 'function') agreed = confirm(question);
    if (!agreed) return;

    var s = state();
    s.services = services().filter(function (x) { return String(x.id) !== String(svc.id); });
    MZ.store.save(s);

    if (editId && editId === String(svc.id)) closeSheet();
    renderSvcList();
    if (typeof MZ.refreshFormAfterServices === 'function') MZ.refreshFormAfterServices();
  }

  /* ---------- экран «Ещё»: шесть тем оформления ---------- */

  var THEMES = [
    { id: 'classic', name: 'Классика' },
    { id: 'dark', name: 'Тёмная' },
    { id: 'trend', name: 'Тренд' },
    { id: 'lavender', name: 'Лаванда' },
    { id: 'graphite', name: 'Графит' },
    { id: 'auto', name: 'Как в системе' }
  ];

  function themeOf(id) {
    for (var i = 0; i < THEMES.length; i++) {
      if (THEMES[i].id === id) return THEMES[i];
    }
    return null;
  }

  function currentTheme() {
    var s = state().settings;
    var id = s && s.theme;
    return themeOf(id) ? id : 'classic';
  }

  function themeHTML(t, current) {
    var on = t.id === current;
    return '<button class="theme' + (on ? ' is-on' : '') + '" type="button" data-theme="' + esc(t.id) +
      '" aria-pressed="' + (on ? 'true' : 'false') + '">' +
      '<span class="swatch" aria-hidden="true"></span>' +
      '<span class="tt">' + esc(t.name) + '</span></button>';
  }

  function renderThemes() {
    var box = $('#themeList');
    if (!box) return;

    var current = currentTheme();
    box.innerHTML = THEMES.map(function (t) { return themeHTML(t, current); }).join('');

    $$('#themeList .theme').forEach(function (b) {
      b.addEventListener('click', function () { applyTheme(b.dataset.theme); });
    });
  }

  /* Смена темы: единственная точка — MZ.setTheme из js/app.js (немедленно применяет
     тему к body и сохраняет её в state.settings.theme). Здесь только перерисовка
     отметки и человеческая подпись о том, что изменение сохранено. */
  function applyTheme(id) {
    var t = themeOf(id);
    if (!t) return null;
    if (typeof MZ.setTheme === 'function') MZ.setTheme(t.id);

    renderThemes();
    var hint = $('#themeHint');
    if (hint) {
      hint.textContent = 'Тема «' + t.name + '» применена и сохранена.';
      hint.hidden = false;
    }
    return t.id;
  }

  /* ---------- обработчики ---------- */

  var btnEditServices = $('#btnEditServices');
  if (btnEditServices) btnEditServices.addEventListener('click', function () {
    renderSvcList();
    if (typeof MZ.go === 'function') MZ.go('services');
  });

  var svcBack = $('#svcBack');
  if (svcBack) svcBack.addEventListener('click', function () {
    if (typeof MZ.go === 'function') MZ.go('more');
  });

  var svcAdd = $('#svcAdd');
  if (svcAdd) svcAdd.addEventListener('click', function () { openSheet(null, 'list'); });

  var fNewSvc = $('#fNewSvc');
  if (fNewSvc) fNewSvc.addEventListener('click', function () { openSheet(null, 'form'); });

  var formSvc = $('#formSvc');
  if (formSvc) formSvc.addEventListener('submit', save);

  var gDel = $('#gDel');
  if (gDel) gDel.addEventListener('click', function () { if (editId) remove(editId); });

  var gCancel = $('#gCancel');
  if (gCancel) gCancel.addEventListener('click', closeSheet);

  $$('[data-close="svc"]').forEach(function (el) {
    el.addEventListener('click', closeSheet);
  });

  /* ---------- старт и API для следующих шагов ---------- */

  renderSvcList();
  renderThemes();

  MZ.servicesScreen = {
    render: renderSvcList,
    open: function (id) { openSheet(id, 'list'); },
    openFromForm: function () { openSheet(null, 'form'); },
    close: closeSheet,
    save: save,
    remove: remove,
    find: findSvc,
    usedIn: usedIn,
    list: services,
    themes: renderThemes,
    themeNames: function () {
      return THEMES.map(function (t) { return t.id + ': ' + t.name; });
    },
    setTheme: applyTheme,
    currentTheme: currentTheme
  };

  /* Экран «Ещё» — часть этого файла: переключатель тем живёт рядом с каталогом. */
  MZ.moreScreen = {
    renderThemes: renderThemes,
    setTheme: applyTheme,
    themes: function () { return THEMES.slice(); },
    currentTheme: currentTheme
  };
})();
