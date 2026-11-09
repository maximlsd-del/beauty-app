/* app.js — каркас интерфейса, экран «Записи» и шит записи PWA «Мои Записи».
 *
 * Что делает этот файл:
 *   - берёт состояние ТОЛЬКО через MZ.store.load() (никаких прямых обращений к localStorage);
 *   - переключает вкладки и запоминает позицию прокрутки каждой вкладки;
 *   - применяет тему из state.settings.theme (шесть тем, включая auto);
 *   - рисует строку недели (7 дней, неделя с понедельника), доход дня и список записей;
 *   - стрелки ◀ ▶ листают недели, «Сегодня» возвращает текущую;
 *   - кнопка «+» и тап по карточке открывают шит записи: создание, правка, перенос,
 *     удаление, скидка с итогом, примечание к цене, оплата. Приёмы формы перенесены
 *     из макета (resetNewAppt, roundHour, defaultDate, syncScrollLock).
 *
 * Правила контракта (beauty-pwa-ПЛАН.md):
 *   - даты только локальные, toISOString() для дат не используется;
 *   - никаких имён в inline-onclick: только addEventListener и data-атрибуты,
 *     пользовательский текст проходит через esc() и textContent.
 */
(function () {
  'use strict';

  var MZ = window.MZ = window.MZ || {};
  var store = MZ.store;

  var $ = function (sel) { return document.querySelector(sel); };
  var $$ = function (sel) { return Array.prototype.slice.call(document.querySelectorAll(sel)); };

  var screens = $('#screens');
  var listEl = $('#dayList');

  if (!store || typeof store.load !== 'function') {
    /* Слой данных не загрузился — говорим об этом текстом, а не молчанием. */
    if (listEl) listEl.textContent = 'Ошибка: слой данных js/store.js не загрузился. Обновите страницу.';
    return;
  }

  /* ---------- состояние ---------- */

  var state = store.load();

  var THEMES = ['classic', 'dark', 'trend', 'lavender', 'graphite', 'auto'];
  var WD = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
  var MON = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
    'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
  /* Именительный падеж — для заголовка календаря («Ноябрь 2026»). */
  var MON_NOM = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
    'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];

  /* ---------- утилиты ---------- */

  var pad2 = function (n) { return n < 10 ? '0' + n : String(n); };

  /* Локальная метка YYYY-MM-DD. toISOString() здесь запрещён:
     он переводит дату в UTC и в UTC+ сдвигает день на сутки при работе ночью. */
  function isoLocal(d) {
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }

  /* Полдень выбран сознательно: перевод часов не перекидывает дату на соседний день. */
  function parseISO(s) {
    var p = String(s).split('-');
    return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]), 12, 0, 0, 0);
  }

  function addDays(d, n) {
    var x = new Date(d.getTime());
    x.setDate(x.getDate() + n);
    return x;
  }

  /* Неделя начинается с понедельника: getDay() даёт 0 для воскресенья. */
  function mondayOf(d) {
    return addDays(d, -((d.getDay() + 6) % 7));
  }

  function money(n) {
    var v = Number(n);
    if (!isFinite(v)) v = 0;
    return v.toLocaleString('ru-RU');
  }

  function cur() {
    return (state.settings && state.settings.currency) || '₽';
  }

  /* Экранирование пользовательского текста и значений, попадающих в разметку. */
  function esc(value) {
    return String(value === null || value === undefined ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  var byTime = function (a, b) { return String(a.time).localeCompare(String(b.time)); };

  function recordsOf(date) {
    return state.records.filter(function (r) { return r.date === date; }).sort(byTime);
  }

  var today = new Date();
  today.setHours(12, 0, 0, 0);

  /* Показываемый месяц календаря — первое число в полдень (перевод часов не сдвигает сутки). */
  var calMonth = new Date(today.getFullYear(), today.getMonth(), 1, 12);
  var selDate = isoLocal(today);
  /* ---------- тема ---------- */

  function normalizeTheme(name) {
    return THEMES.indexOf(name) === -1 ? 'classic' : name;
  }

  function applyTheme() {
    document.body.dataset.theme = normalizeTheme(state.settings && state.settings.theme);
  }

  /* Единственная точка смены темы: её вызовет переключатель в «Ещё» на следующем шаге. */
  function setTheme(name) {
    var theme = normalizeTheme(name);
    if (!state.settings) state.settings = {};
    state.settings.theme = theme;
    applyTheme();
    store.save(state);
    return theme;
  }

  /* ---------- вкладки ---------- */

  /* У каждой вкладки своя позиция прокрутки: запоминаем scrollTop уходящего экрана
     и возвращаем его при возврате. Прокрутка живёт только в .screens. */
  var scrollPos = {};

  function activeScreen() {
    var found = $$('.screen').filter(function (s) { return s.classList.contains('is-active'); })[0];
    return found || $('#s-notes');
  }

  function activeId() {
    var s = activeScreen();
    return s && s.id ? s.id : 's-notes';
  }

  function rememberScroll() {
    if (screens) scrollPos[activeId()] = screens.scrollTop;
  }

  function go(t) {
    rememberScroll();
    $$('.screen').forEach(function (s) { s.classList.toggle('is-active', s.id === 's-' + t); });
    $$('.tab').forEach(function (b) { b.classList.toggle('is-active', b.dataset.tab === t); });
    if (screens) screens.scrollTop = scrollPos['s-' + t] || 0;
  }

  if (screens && typeof screens.addEventListener === 'function') {
    screens.addEventListener('scroll', rememberScroll, { passive: true });
  }

  /* ---------- неделя ---------- */

  /* Календарь месяца: всегда 6 строк по 7 дней с понедельника. Дни соседних
     месяцев показываются приглушённо — так сетка не «прыгает» по высоте. */
  function renderWeek() {
    var week = $('#week');
    if (!week) return;

    var first = calMonth;
    var firstDow = (first.getDay() + 6) % 7;   /* понедельник — первый столбец */
    var start = addDays(first, -firstDow);

    var cells = [];
    for (var i = 0; i < 42; i++) {
      var d = addDays(start, i);
      var dISO = isoLocal(d);
      var cls = 'day' +
        (d.getMonth() !== first.getMonth() ? ' is-other' : '') +
        (dISO === selDate ? ' is-sel' : '') +
        (recordsOf(dISO).length ? ' has-rec' : '');
      cells.push('<button class="' + cls + '" type="button" data-date="' + dISO + '">' +
        '<span class="dn">' + d.getDate() + '</span><span class="dot"></span></button>');
    }
    week.innerHTML = cells.join('');

    $$('#week .day').forEach(function (b) {
      b.addEventListener('click', function () {
        selDate = b.dataset.date;
        calMonth = monthOf(selDate);
        renderWeek();
        renderDay();
      });
    });

    var labelEl = $('#weekLabel');
    if (labelEl) labelEl.textContent = MON_NOM[first.getMonth()] + ' ' + first.getFullYear();

    /* В шапке — неделя выбранного дня: она подсказывает, куда смотреть в списке. */
    var a = mondayOf(parseISO(selDate));
    var b = addDays(a, 6);
    var top = $('#topDate');
    if (top) top.textContent = a.getDate() + ' – ' + b.getDate() + ' ' + MON[b.getMonth()];
  }

  /* Соседний месяц: листаем календарь, не трогая выбранный день. */
  function shiftMonth(delta) {
    calMonth = new Date(calMonth.getFullYear(), calMonth.getMonth() + delta, 1, 12);
    renderWeek();
  }

  /* ---------- день ---------- */

  function renderDay() {
    var list = recordsOf(selDate);
    var sum = list.reduce(function (acc, r) { return acc + (Number(r.price) || 0); }, 0);

    var totalEl = $('#dayTotal');
    if (totalEl) totalEl.textContent = money(sum);
    $$('.rub').forEach(function (rub) { rub.textContent = cur(); });

    var countEl = $('#dayCount');
    if (countEl) {
      if (!list.length) {
        countEl.textContent = 'записей нет';
      } else {
        var paid = list.filter(function (r) { return r.paid; }).length;
        var word = list.length === 1 ? 'запись' : (list.length < 5 ? 'записи' : 'записей');
        countEl.textContent = list.length + ' ' + word + ' · ' + paid + ' оплачено';
      }
    }

    if (!listEl) return;
    if (!list.length) {
      var d = parseISO(selDate);
      listEl.innerHTML = '<p class="empty">На ' + d.getDate() + ' ' + MON[d.getMonth()] +
        ' записей нет.<br>Записи этого дня появятся здесь.</p>';
      return;
    }

    /* Карточка — обычный блок с data-id (не <button>): тап открывает шит правки.
       Пользовательский текст идёт через esc() и textContent, в атрибуты попадает только id,
       поэтому апостроф и угловые скобки в имени ничего не ломают. */
    listEl.innerHTML = list.map(function (r) {
      var base = Number(r.base) || 0;
      var disc = Number(r.discount) || 0;
      var price = Number(r.price) || 0;
      /* зачёркнутая базовая цена — только когда скидка реально уменьшила сумму */
      var old = (disc > 0 && base > price)
        ? '<span class="old">' + money(base) + ' ' + esc(cur()) + '</span>' : '';
      var discMark = disc > 0 ? '<span class="rec-disc">−' + esc(disc) + '%</span>' : '';
      var priceNote = r.priceNote ? '<span class="rec-note">' + esc(r.priceNote) + '</span>' : '';
      /* Метки шага 8 (js/remind.js): «через N мин / сейчас / закончилась», «пора напомнить»
         и «напомнила 9 ноября». Файла может не быть (отдельные проверки) — тогда меток нет.
         Готовую разметку собирает remind.js, здесь она вставляется одним куском. */
      var marks = typeof MZ.apptMarkHTML === 'function' ? MZ.apptMarkHTML(r) : '';

      return '<div class="rec" data-id="' + esc(r.id) + '" role="button" tabindex="0">' +
        '<div class="rec-time"><b>' + esc(r.time) + '</b><span>' + esc(r.minutes) + ' мин</span></div>' +
        '<div class="rec-body">' +
        '<span class="rec-name">' + esc(r.name || 'Без имени') + '</span>' +
        '<span class="rec-svc">' + esc(r.svcName || 'Услуга не указана') + '</span>' +
        priceNote +
        marks +
        '</div>' +
        '<div class="rec-side">' +
        '<span class="rec-price">' + money(price) + ' ' + esc(cur()) + old + '</span>' +
        discMark +
        '<span class="mark ' + (r.paid ? 'ok' : 'no') + '">' + (r.paid ? 'оплачено' : 'не оплачено') + '</span>' +
        '</div></div>';
    }).join('');

    $$('#dayList .rec').forEach(function (card) {
      var id = card.dataset.id;
      card.addEventListener('click', function () { openEditSheet(id); });
      card.addEventListener('keydown', function (ev) {
        if (ev.key === 'Enter' || ev.key === ' ' || ev.key === 'Spacebar') {
          ev.preventDefault();
          openEditSheet(id);
        }
      });
    });
  }

  /* ---------- кнопки ---------- */

  var wkPrev = $('#wkPrev');
  if (wkPrev) wkPrev.addEventListener('click', function () { shiftMonth(-1); });
  var wkNext = $('#wkNext');
  if (wkNext) wkNext.addEventListener('click', function () { shiftMonth(1); });
  var btnToday = $('#btnToday');
  if (btnToday) btnToday.addEventListener('click', function () {
    calMonth = monthOf(isoLocal(today));
    selDate = isoLocal(today);
    renderWeek();
    renderDay();
  });

  $$('.tab').forEach(function (b) {
    b.addEventListener('click', function () { go(b.dataset.tab); });
  });

  /* ══════════════════ ШИТ ЗАПИСИ: создание, правка, перенос, удаление ══════════════════
     Структура и приёмы перенесены из макета (макет/js/app.js + макет/js/extra.js):
     openSheet / openEdit / resetNewAppt / roundHour / defaultDate / syncScrollLock.
     Отличие одно: в макете состояние записи жило в других полях (clientId, dur, note),
     здесь — контракт v2 из beauty-pwa-ПЛАН.md:
     {id, name, phone, svcName, serviceId, date, time, minutes, base, discount, price,
      priceNote, comment, paid, remindedAt}. */

  var OWN_SVC = '__own';        /* пункт «Другая» в списке услуг */

  var sheetNew = $('#sheetNew');
  var formNew = $('#formNew');
  var fabNew = $('#fabNew');

  var editId = null;            /* null — новая запись, иначе id правимой записи */
  var disc = 0;                 /* скидка в процентах */
  var manualPrice = false;      /* итог введён вручную — автопересчёт его не затирает */
  var minutesTouched = false;   /* в «Минут» вводили руками — услуга не перетирает */
  var baseTouched = false;      /* то же для базовой цены */
  var phoneAuto = '';           /* телефон, подставленный из базы по имени клиента */
  var savedScrollY = 0;         /* позиция прокрутки .screens до открытия шита */
  var scrollLocked = false;

  var PRICE_PRESETS = [0, 5, 10, 15, 20];

  function setField(sel, value) {
    var el = $(sel);
    if (el) el.value = String(value);
  }

  function formNum(sel) {
    var el = $(sel);
    var n = el ? Number(el.value) : 0;
    return isFinite(n) ? n : 0;
  }

  /* Имя приводим так же, как это делает слой данных: пробелы подряд — один. */
  function asName(value) {
    return String(value === null || value === undefined ? '' : value)
      .replace(/\s+/g, ' ').trim();
  }

  /* Сравнение клиентов — по имени БЕЗ учёта регистра (как в миграции store.js). */
  function nameKey(value) { return asName(value).toLowerCase(); }

  function clampDisc(value) {
    var n = Math.round(Number(value) || 0);
    return n < 0 ? 0 : (n > 90 ? 90 : n);
  }

  function autoPrice(base, discount) {
    return Math.round((Number(base) || 0) * (1 - (Number(discount) || 0) / 100));
  }

  function findRecord(id) {
    for (var i = 0; i < state.records.length; i++) {
      if (String(state.records[i].id) === String(id)) return state.records[i];
    }
    return null;
  }

  function findClientByName(name) {
    var key = nameKey(name);
    if (!key) return null;
    for (var i = 0; i < state.clients.length; i++) {
      if (nameKey(state.clients[i].name) === key) return state.clients[i];
    }
    return null;
  }

  function svcById(id) {
    for (var i = 0; i < state.services.length; i++) {
      if (String(state.services[i].id) === String(id)) return state.services[i];
    }
    return null;
  }

  /* Свободный id вида c1, c2… — без Date.now(), чтобы id не зависел от часов. */
  function newClientId() {
    var used = {};
    state.clients.forEach(function (c) { used[String(c.id)] = true; });
    var n = 1;
    while (used['c' + n]) n++;
    return 'c' + n;
  }

  /* Свободный id записи. Date.now() только как число для уникальности (никаких дат),
     и то с проверкой на совпадение — id обязан быть уникальным. */
  function newRecordId() {
    var used = {};
    state.records.forEach(function (r) { used[String(r.id)] = true; });
    var n = Date.now();
    while (used['r' + n]) n++;
    return 'r' + n;
  }

  /* ---------- клиент: создание и обновление телефона ---------- */

  function upsertClient(name, phone) {
    var client = findClientByName(name);
    if (!client) {
      client = {
        id: newClientId(),
        name: name,
        phone: phone,
        birthday: null,
        note: '',
        blacklist: false,
        blacklistReason: '',
        remindedAt: null
      };
      state.clients.push(client);
      return client;
    }
    /* Имя в базе не переписываем — оно уже сохранено в своём написании.
       Телефон обновляем, если он введён и отличается: пустое поле не стирает данные. */
    if (phone && phone !== client.phone) client.phone = phone;
    return client;
  }

  /* ---------- услуга: список и подстановка цены/длительности ---------- */

  function renderSvcOptions(keepId) {
    var sel = $('#fService');
    if (!sel) return;

    var html = state.services.map(function (s) {
      return '<option value="' + esc(s.id) + '">' + esc(s.name) + ' — ' +
        money(s.price) + ' ' + esc(cur()) + ' · ' + esc(s.minutes) + ' мин</option>';
    }).join('');

    /* Услугу могли удалить из каталога, а запись осталась: оставляем её в выборе,
       чтобы правка старой записи не теряла название. */
    if (keepId && !svcById(keepId)) {
      var rec = null;
      for (var i = 0; i < state.records.length; i++) {
        if (String(state.records[i].serviceId) === String(keepId)) { rec = state.records[i]; break; }
      }
      html += '<option value="' + esc(keepId) + '">' +
        esc((rec && rec.svcName) || 'Услуга') + ' — вне каталога</option>';
    }

    html += '<option value="' + OWN_SVC + '">Другая</option>';
    sel.innerHTML = html;
  }

  function showOwnSvc(on) {
    var wrap = $('#svcOwnWrap');
    if (wrap) wrap.hidden = !on;
    if (!on) setField('#fSvcName', '');
  }

  /* Выбор услуги в форме записи ПО ID — общая точка для каталога услуг (js/services.js).
     Каталог зовёт её после сохранения новой услуги, добавленной прямо из формы записи:
     приём макета (mSave → fService/fPrice/fDur) — услуга сразу выбрана, цена и длительность
     подставлены принудительно, ручные пометки полей сняты. */
  function pickService(id) {
    var sel = $('#fService');
    if (!sel) return null;

    renderSvcOptions(id);
    var svc = svcById(id);
    if (!svc) return null;

    sel.value = String(svc.id);
    showOwnSvc(false);
    minutesTouched = false;
    baseTouched = false;
    manualPrice = false;
    setField('#fMinutes', svc.minutes);
    setField('#fBase', svc.price);
    syncTotal();
    showHint('#svcHint', '');
    return svc;
  }

  function showHint(sel, text) {
    var el = $(sel);
    if (!el) return;
    if (text) { el.textContent = text; el.hidden = false; }
    else { el.textContent = ''; el.hidden = true; }
  }

  function showErr(text) { showHint('#formErr', text); }

  function onServiceChange() {
    var sel = $('#fService');
    if (!sel) return;

    if (sel.value === OWN_SVC) {
      showOwnSvc(true);
      showHint('#svcHint', '');
      return;
    }
    showOwnSvc(false);

    var svc = svcById(sel.value);
    if (!svc) { showHint('#svcHint', ''); return; }

    /* «Уже введённые значения не затираются молча»: цену и длительность подставляем
       только в нетронутые поля, иначе оставляем ввод пользователя и говорим об этом. */
    var kept = [];
    if (minutesTouched) kept.push('длительность'); else setField('#fMinutes', svc.minutes);
    if (baseTouched) kept.push('цену'); else setField('#fBase', svc.price);
    syncTotal();

    if (kept.length === 2) showHint('#svcHint', 'Цена и длительность оставлены как есть — вы вводили их вручную.');
    else if (kept[0] === 'цену') showHint('#svcHint', 'Базовая цена оставлена как есть — вы вводили её вручную.');
    else if (kept[0] === 'длительность') showHint('#svcHint', 'Длительность оставлена как есть — вы вводили её вручную.');
    else showHint('#svcHint', '');
  }

  /* ---------- скидка и итог ---------- */

  function paintDisc() {
    $$('#discChips [data-disc]').forEach(function (b) {
      b.classList.toggle('is-on', Number(b.dataset.disc) === disc);
    });
  }

  function renderDisc() {
    var box = $('#discChips');
    if (!box) return;
    box.innerHTML = PRICE_PRESETS.map(function (p) {
      return '<button type="button" class="chip' + (disc === p ? ' is-on' : '') +
        '" data-disc="' + p + '">' + p + '%</button>';
    }).join('');
    $$('#discChips [data-disc]').forEach(function (b) {
      b.addEventListener('click', function () {
        disc = clampDisc(b.dataset.disc);
        setField('#fDisc', disc);
        paintDisc();
        syncTotal();
      });
    });
  }

  /* Итог: пока итог не правили руками — это база минус скидка.
     Ручной ввод замораживает автопересчёт (и об этом говорит подсказка). */
  function syncTotal() {
    if (!manualPrice) setField('#fPrice', autoPrice(formNum('#fBase'), disc));
    var row = $('#totalRow');
    if (row) row.classList.toggle('is-manual', manualPrice);
    showHint('#totalHint', manualPrice ? 'Итог введён вручную — пересчёт его не меняет.' : '');
  }

  /* ---------- оплата ---------- */

  function setPaid(on) {
    var el = $('#fPaid');
    if (el) el.setAttribute('aria-checked', on ? 'true' : 'false');
  }
  function isPaid() {
    var el = $('#fPaid');
    return !!el && el.getAttribute('aria-checked') === 'true';
  }

  /* ---------- время по умолчанию ---------- */

  /* Ближайший круглый час: 10:40 → 11:00, 10:00 → 10:00 (приём из макета). */
  function roundHour(t) {
    var m = /^(\d{1,2}):(\d{2})$/.exec(String(t || ''));
    if (!m) return '10:00';
    var h = Number(m[1]) % 24;
    if (Number(m[2]) > 0) h = (h + 1) % 24;
    return pad2(h) + ':00';
  }

  function toMinutes(t) {
    var m = /^(\d{1,2}):(\d{2})$/.exec(String(t || ''));
    return m ? Number(m[1]) * 60 + Number(m[2]) : 0;
  }

  /* Свободное время дня: сразу после последней записи + 15 минут, но круглым часом.
     Пустой день — 10:00. */
  function defaultTime(dateISO) {
    var list = recordsOf(dateISO);
    if (!list.length) return '10:00';
    var last = list[list.length - 1];
    var end = toMinutes(last.time) + (Number(last.minutes) || 0) + 15;
    if (end >= 24 * 60) return '10:00';
    return roundHour(pad2(Math.floor(end / 60)) + ':' + pad2(end % 60));
  }

  /* День по умолчанию — ВЫБРАННЫЙ в журнале (приём из макета). */
  function defaultDate() { return selDate; }

  function phoneOf(name) {
    var client = findClientByName(name);
    return client ? client.phone : '';
  }

  /* ---------- заполнение формы ---------- */

  /* Приём из макета (resetNewAppt): новая запись всегда начинается с чистого листа,
     чтобы в форме не осталось ни имени, ни телефона, ни комментария прошлой записи. */
  function resetNewAppt() {
    editId = null;
    var first = state.services[0] || null;
    var sel = $('#fService');

    setField('#fClient', '');
    setField('#fPhone', '');
    setField('#fSvcName', '');
    setField('#fPriceNote', '');
    setField('#fComment', '');
    phoneAuto = '';

    if (sel) sel.value = first ? String(first.id) : OWN_SVC;
    showOwnSvc(!first);

    setField('#fMinutes', first ? first.minutes : 60);
    setField('#fBase', first ? first.price : 0);

    setField('#fDate', defaultDate());
    setField('#fTime', defaultTime(defaultDate()));

    disc = 0;
    manualPrice = false;
    minutesTouched = false;
    baseTouched = false;
    setField('#fDisc', 0);
    setPaid(false);

    renderDisc();
    syncTotal();
    showHint('#svcHint', '');
    showErr('');
  }

  /* Правка: форма получает данные именно этой записи. */
  function openEdit(id) {
    var rec = findRecord(id);
    if (!rec) return;
    editId = String(rec.id);

    renderSvcOptions(rec.serviceId);
    var sel = $('#fService');
    if (rec.serviceId) {
      /* Услуга либо есть в каталоге, либо оставлена в списке как «вне каталога»
         (renderSvcOptions выше добавил её именно для этой записи). */
      sel.value = String(rec.serviceId);
      showOwnSvc(false);
    } else {
      sel.value = OWN_SVC;
      showOwnSvc(true);
      setField('#fSvcName', rec.svcName || '');
    }

    setField('#fClient', rec.name || '');
    setField('#fPhone', rec.phone || '');
    phoneAuto = rec.phone || '';
    setField('#fDate', rec.date || selDate);
    setField('#fTime', rec.time || defaultTime(rec.date || selDate));
    setField('#fMinutes', Number(rec.minutes) > 0 ? rec.minutes : 60);
    setField('#fBase', Number(rec.base) || 0);
    setField('#fPriceNote', rec.priceNote || '');
    setField('#fComment', rec.comment || '');
    setPaid(!!rec.paid);

    disc = clampDisc(rec.discount);
    setField('#fDisc', disc);
    /* Если итог в записи отличается от «база минус скидка», он был введён вручную. */
    manualPrice = (Number(rec.price) || 0) !== autoPrice(Number(rec.base) || 0, disc);
    minutesTouched = false;
    baseTouched = false;

    renderDisc();
    if (manualPrice) setField('#fPrice', Number(rec.price) || 0);
    syncTotal();
    showHint('#svcHint', '');
    showErr('');
  }

  function openSheet() {
    editId = null;
    renderSvcOptions(null);
    resetNewAppt();
    var title = $('#sheetTitle');
    if (title) title.textContent = 'Новая запись';
    var del = $('#fDelete');
    if (del) del.hidden = true;
    /* Новой записи напоминать не о чем: js/remind.js прячет кнопку «Напомнить клиенту». */
    if (typeof MZ.onSheetRecord === 'function') MZ.onSheetRecord(null);
    showSheet('Новая запись');
  }

  function openEditSheet(id) {
    var rec = findRecord(id);
    if (!rec) return;
    openEdit(id);
    var title = $('#sheetTitle');
    if (title) title.textContent = 'Запись';
    var del = $('#fDelete');
    if (del) del.hidden = false;
    /* Точка расширения шага 8: шит открыт на существующей записи — кнопки напоминания
       показываются по её данным (remindedAt решает, есть ли что снимать). */
    if (typeof MZ.onSheetRecord === 'function') MZ.onSheetRecord(rec);
    showSheet('Запись');
  }

  /* ---------- открытие и закрытие шита ---------- */

  function showSheet(title) {
    if (!sheetNew) return;
    var t = $('#sheetTitle');
    if (t && title) t.textContent = title;
    sheetNew.hidden = false;
    var box = sheetNew.querySelector ? sheetNew.querySelector('.sheet') : null;
    if (box) box.scrollTop = 0;          /* шит всегда открывается сверху */
    syncScrollLock();
  }

  function closeSheet() {
    if (sheetNew) sheetNew.hidden = true;
    editId = null;
    syncScrollLock();
  }

  /* Приём макета (syncScrollLock): пока шит открыт, содержимое .screens не прокручивается,
     позиция запоминается и возвращается после закрытия. Классы is-locked на body/html
     остаются для совместимости — прокрутка документа и так выключена в css/base.css,
     но на iOS их наличие гасит «резинку» родителя.
     Замок один на все шиты приложения (запись, услуга и расход): если поверх шита записи
     открыть шит услуги или расхода, закрытие верхнего фон не разблокирует — блокировка
     снимется только тогда, когда закрыт последний шит. */
  var LOCKING_SHEETS = ['#sheetNew', '#sheetSvc', '#sheetExp'];

  function syncScrollLock() {
    var open = LOCKING_SHEETS.some(function (sel) {
      var el = $(sel);
      return !!el && !el.hidden;
    });
    if (open === scrollLocked) return;

    var body = document.body;
    var root = document.documentElement;

    if (open) {
      savedScrollY = (screens && typeof screens.scrollTop === 'number') ? screens.scrollTop : 0;
      if (screens) screens.classList.add('is-locked');
      if (body) body.classList.add('is-locked');
      if (root) root.classList.add('is-locked');
    } else {
      if (screens) { screens.classList.remove('is-locked'); screens.scrollTop = savedScrollY; }
      if (body) body.classList.remove('is-locked');
      if (root) root.classList.remove('is-locked');
      savedScrollY = 0;
    }
    scrollLocked = open;
  }

  /* ---------- сохранение и удаление ---------- */

  /* Первое число месяца выбранной даты, полдень — для календаря на «Записях». */
  function monthOf(dateISO) {
    var d = parseISO(dateISO);
    return new Date(d.getFullYear(), d.getMonth(), 1, 12);
  }

  function saveForm(e) {
    if (e && typeof e.preventDefault === 'function') e.preventDefault();

    var name = asName(formNew && $('#fClient') ? $('#fClient').value : '');
    var date = String(($('#fDate') || {}).value || '');
    var time = String(($('#fTime') || {}).value || '');
    if (!name || !date || !time) {
      showErr('Заполните клиента, дату и время.');
      return;
    }

    var sel = $('#fService');
    var own = !!sel && sel.value === OWN_SVC;
    var svc = own || !sel ? null : svcById(sel.value);
    var wasEdit = !!editId;
    var current = wasEdit ? findRecord(editId) : null;

    /* svcName — всегда снимок названия: удаление услуги из каталога старые записи не ломает.
       serviceId — id из каталога, иначе null. Исключение: услуга записи удалена из каталога,
       но осталась выбранной как «вне каталога» — тогда сохраняем прежнюю связь и название,
       чтобы простая правка времени не обнуляла услугу. */
    var svcName, serviceId;
    if (own) {
      svcName = asName($('#fSvcName').value);
      serviceId = null;
    } else if (svc) {
      svcName = svc.name;
      serviceId = String(svc.id);
    } else if (current && sel && String(current.serviceId) === String(sel.value)) {
      svcName = current.svcName || '';
      serviceId = current.serviceId ? String(current.serviceId) : null;
    } else {
      svcName = '';
      serviceId = null;
    }

    var minutes = Math.round(formNum('#fMinutes'));
    if (minutes <= 0) minutes = 60;
    var base = Math.round(formNum('#fBase'));
    if (base < 0) base = 0;
    var price = manualPrice ? Math.round(formNum('#fPrice')) : autoPrice(base, disc);
    if (price < 0) price = 0;

    var phone = asName($('#fPhone').value);
    if (MZ.clientsScreen && typeof MZ.clientsScreen.normPhone === 'function') {
      phone = MZ.clientsScreen.normPhone(phone);
    }

    /* Клиент: новый — добавится, существующий — обновит телефон (имя без учёта регистра). */
    upsertClient(name, phone);

    var data = {
      name: name,
      phone: phone,
      svcName: svcName,
      serviceId: serviceId,
      date: date,
      time: time,
      minutes: minutes,
      base: base,
      discount: disc,
      price: price,
      priceNote: String($('#fPriceNote').value || '').trim(),
      comment: String($('#fComment').value || '').trim(),
      paid: isPaid()
    };

    if (current) {
      /* Обновляем ту же запись: id и remindedAt остаются, дубликат не появляется. */
      Object.keys(data).forEach(function (key) { current[key] = data[key]; });
    } else {
      data.id = newRecordId();
      data.remindedAt = null;
      state.records.push(data);
    }

    state = store.save(state);
    closeSheet();

    /* День записи мог быть в другом месяце — показываем его. */
    selDate = date;
    calMonth = monthOf(date);
    renderWeek();
    renderDay();
    /* Записи изменились — цифры отчёта (доход, средний чек, услуги, прибыль) устарели. */
    if (typeof MZ.refreshReport === 'function') MZ.refreshReport();
    /* Новый клиент мог появиться в базе: список «Клиенты» перерисовываем сразу,
       а не только после перезагрузки страницы. */
    if (MZ.clientsScreen && typeof MZ.clientsScreen.render === 'function') {
      MZ.clientsScreen.render();
    }
    showErr('');
  }

  function deleteRecord() {
    if (!editId) return;
    var rec = findRecord(editId);
    if (!rec) { closeSheet(); return; }

    var question = 'Удалить запись «' + (rec.name || 'без имени') + '» на ' +
      rec.date + ' в ' + rec.time + '? Клиент останется в базе.';
    var agreed = true;
    if (typeof confirm === 'function') agreed = confirm(question);
    if (!agreed) return;

    var removedId = String(rec.id);
    state.records = state.records.filter(function (r) { return String(r.id) !== removedId; });
    state = store.save(state);
    closeSheet();
    renderWeek();
    renderDay();
    /* Удаление записи тоже меняет отчёт. */
    if (typeof MZ.refreshReport === 'function') MZ.refreshReport();
  }

  /* ---------- обработчики шита ---------- */

  if (fabNew) fabNew.addEventListener('click', openSheet);
  if (formNew) formNew.addEventListener('submit', saveForm);

  var btnDelete = $('#fDelete');
  if (btnDelete) btnDelete.addEventListener('click', deleteRecord);
  var btnCancel = $('#fCancel');
  if (btnCancel) btnCancel.addEventListener('click', closeSheet);
  $$('[data-close="sheet"]').forEach(function (el) {
    el.addEventListener('click', closeSheet);
  });

  var fPaid = $('#fPaid');
  if (fPaid) fPaid.addEventListener('click', function () { setPaid(!isPaid()); });

  var fService = $('#fService');
  if (fService) fService.addEventListener('change', onServiceChange);

  var fMinutes = $('#fMinutes');
  if (fMinutes) fMinutes.addEventListener('input', function () { minutesTouched = true; });

  var fBase = $('#fBase');
  if (fBase) fBase.addEventListener('input', function () { baseTouched = true; syncTotal(); });

  var fDisc = $('#fDisc');
  if (fDisc) fDisc.addEventListener('input', function () {
    disc = clampDisc(fDisc.value);
    paintDisc();
    syncTotal();
  });

  var fPrice = $('#fPrice');
  if (fPrice) fPrice.addEventListener('input', function () {
    manualPrice = true;      /* ручной итог: пересчёт больше его не трогает */
    syncTotal();
  });

  /* Телефон подтягивается из базы по имени клиента: так «телефон изменился — обновился»
     работает, а пустое поле не стирает сохранённый номер. */
  var fClient = $('#fClient');
  if (fClient) fClient.addEventListener('input', function () {
    var phoneEl = $('#fPhone');
    if (!phoneEl) return;
    var stored = phoneOf(fClient.value);
    var isEmptyOrAuto = !String(phoneEl.value).trim() || phoneEl.value === phoneAuto;
    if (stored && isEmptyOrAuto) { phoneEl.value = stored; phoneAuto = stored; }
    else if (!stored && isEmptyOrAuto) { phoneEl.value = ''; phoneAuto = ''; }
  });

  /* API для следующих шагов и для стенда */

  Object.defineProperty(MZ, 'state', { get: function () { return state; }, configurable: true });
  MZ.applyTheme = applyTheme;
  MZ.setTheme = setTheme;
  MZ.go = go;
  MZ.renderWeek = renderWeek;
  MZ.renderDay = renderDay;
  MZ.isoLocal = isoLocal;
  MZ.mondayOf = mondayOf;
  MZ.addDays = addDays;
  MZ.recordsOf = recordsOf;
  MZ.money = money;
  MZ.esc = esc;
  MZ.openSheet = openSheet;
  MZ.openEdit = openEditSheet;
  MZ.closeSheet = closeSheet;
  MZ.saveForm = saveForm;
  MZ.deleteRecord = deleteRecord;
  MZ.syncScrollLock = syncScrollLock;
  MZ.defaultTime = defaultTime;
  MZ.roundHour = roundHour;
  MZ.findClientByName = findClientByName;
  MZ.nameKey = nameKey;            /* ключ сравнения имён без учёта регистра — общий для шагов */
  MZ.upsertClient = upsertClient;
  MZ.autoPrice = autoPrice;
  MZ.selDate = function () { return selDate; };
  /* Услуги: каталог (js/services.js) переиспользует эти помощники, а не повторяет их. */
  MZ.findService = svcById;
  MZ.renderSvcOptions = renderSvcOptions;
  MZ.onServiceChange = onServiceChange;
  MZ.pickService = pickService;
  MZ.refreshFormAfterServices = function () {
    /* Каталог изменился (правка, удаление) — список услуг и карточки дня обновляем здесь. */
    renderSvcOptions();
    renderDay();
  };

  /* Замена состояния целиком (импорт из файла, шаг 5). Мало записать новое
     состояние на диск: экраны рисуются от объекта в замыкании этого файла,
     поэтому его нужно заменить и перерисовать всё, что зависит от данных. */
  MZ.adoptState = function (next) {
    state = next && typeof next === 'object' ? next : store.load();
    applyTheme();
    renderWeek();
    renderDay();
    renderSvcOptions();
    /* Импорт приносит другие записи и расходы — отчёт пересчитываем тем же проходом. */
    if (typeof MZ.refreshReport === 'function') MZ.refreshReport();
    return state;
  };

  /* ---------- старт ---------- */

  applyTheme();
  renderWeek();
  renderDay();
  go('notes');
})();
