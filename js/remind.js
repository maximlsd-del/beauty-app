/* remind.js — напоминания о записях и сводка при открытии (шаг 8).
 * Подключается ПОСЛЕДНИМ, после js/backup.js, и работает через window.MZ.
 *
 * Что делает файл:
 *   1) метки на карточке записи (их рисует js/app.js через MZ.apptMarkHTML):
 *      «через N мин / сейчас / закончилась» — только для сегодняшних записей,
 *      «пора напомнить» — если до начала меньше settings.remindBefore и remindedAt пуст,
 *      «напомнила 9 ноября» — если напоминание уже отправлено;
 *   2) кнопки «Напомнить клиенту» и «Снять напоминание» в шите записи. Текст напоминания
 *      открывается в СУЩЕСТВУЮЩЕМ листе сообщения из js/care.js (WhatsApp, Telegram, SMS,
 *      «Скопировать текст»): второго листа в приложении нет. По кнопке «Напомнила»
 *      у записи проставляется remindedAt — локальная дата ГГГГ-ММ-ДД;
 *   3) сводку при открытии: сколько сегодня записей, ближайшая (через сколько минут /
 *      «начинается сейчас» / «все уже прошли»), доход дня, неоплаченное, кому пора
 *      напомнить (с кнопкой) и у кого день рождения сегодня. Пустой день — короткий
 *      текст, а не пустая карточка. Закрывается крестиком и тапом по фону,
 *      показывается не чаще одного раза в 30 минут (порог как в макете);
 *   4) настройки в «Ещё»: переключатель «Показывать сводку при открытии» (settings.digest)
 *      и «за сколько напоминать» (settings.remindBefore: 60, 180, 1440, 2880 минут).
 *
 * Чего файл НЕ делает (решение заказчика): календаря нет и не будет, фоновых уведомлений
 * без сервера не бывает — напоминание всегда ручное, в один тап.
 *
 * Правила контракта (beauty-pwa-ПЛАН.md):
 *   - даты только локальные: toISOString() здесь нет вообще, время читается через
 *     getHours/getMinutes, разница считается в минутах;
 *   - никаких данных в inline-onclick: только addEventListener, data-id и textContent;
 *   - цвета и размеры — из переменных тем (css/extra.css), поля — 16px, тап-зоны 44px.
 */
(function () {
  'use strict';

  var MZ = window.MZ;
  if (!MZ || !MZ.store) return;

  var doc = typeof document !== 'undefined' ? document : null;
  var $ = function (sel) { return doc ? doc.querySelector(sel) : null; };
  var $$ = function (sel) {
    return doc ? Array.prototype.slice.call(doc.querySelectorAll(sel)) : [];
  };

  var MON = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
    'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];

  /* Значения «за сколько напоминать» — те же, что предлагает интерфейс настроек. */
  var REMIND_VALUES = [60, 180, 1440, 2880];
  var REMIND_LABELS = { 60: 'за час', 180: 'за 3 часа', 1440: 'за день', 2880: 'за 2 дня' };
  var DEF_REMIND = 1440;

  /* Сводка показывается не чаще раза в 30 минут — защита от спама при возврате в приложение. */
  var GAP_MS = 30 * 60 * 1000;
  var gapMs = GAP_MS;
  var lastShown = 0;      /* время показа в мс; 0 — в этой сессии ещё не показывали */
  var shown = false;
  var closed = false;

  /* ---------- состояние и мелкие помощники ---------- */

  function state() { return MZ.state || MZ.store.load(); }

  function settings() {
    var s = state();
    if (!s.settings || typeof s.settings !== 'object') s.settings = {};
    return s.settings;
  }

  function save() {
    try { MZ.store.save(state()); } catch (e) { /* хранилище недоступно — данные уже в памяти */ }
  }

  function esc(value) {
    if (typeof MZ.esc === 'function') return MZ.esc(value);
    return String(value === null || value === undefined ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function asName(value) {
    return String(value === null || value === undefined ? '' : value).replace(/\s+/g, ' ').trim();
  }

  function val(sel) {
    var el = $(sel);
    return el ? String(el.value === null || el.value === undefined ? '' : el.value) : '';
  }

  function setText(sel, text) {
    var el = $(sel);
    if (el) el.textContent = text === null || text === undefined ? '' : String(text);
  }

  function toast(message) {
    if (typeof MZ.toast === 'function') MZ.toast(message);
  }

  function pad2(n) { return n < 10 ? '0' + n : String(n); }

  /* Локальная дата ГГГГ-ММ-ДД. toISOString() запрещён: он сдвигает день в UTC+. */
  function isoLocal(d) {
    if (typeof MZ.isoLocal === 'function') return MZ.isoLocal(d);
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }

  /* Полдень выбран сознательно: перевод часов не перекидывает дату на соседний день. */
  function parseISODay(iso) {
    var p = String(iso).split('-');
    return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]), 12, 0, 0, 0);
  }

  function isISODate(value) { return /^\d{4}-\d{2}-\d{2}$/.test(String(value)); }

  function fmtDate(iso) {
    if (!isISODate(iso)) return '';
    var d = parseISODay(iso);
    return d.getDate() + ' ' + MON[d.getMonth()];
  }

  function money(n) {
    var v = Math.round(Number(n) || 0);
    return typeof MZ.money === 'function' ? MZ.money(v) : String(v);
  }

  function cur() { return settings().currency || '₽'; }

  function plural(n, one, few, many) {
    var abs = Math.abs(Number(n) || 0) % 100;
    var last = abs % 10;
    if (abs >= 11 && abs <= 14) return many;
    if (last === 1) return one;
    if (last >= 2 && last <= 4) return few;
    return many;
  }

  function nOf(n, one, few, many) { return n + ' ' + plural(n, one, few, many); }

  /* ---------- часы: подставные в проверках, системные в приложении ---------- */

  var clock = function () { return new Date(); };

  function nowDate() {
    var d = clock();
    return d instanceof Date ? new Date(d.getTime()) : new Date(d);
  }

  /* ---------- время записи: только локальные геттеры, без UTC ---------- */

  function startOf(rec) {
    if (!rec || !isISODate(rec.date)) return null;
    var p = String(rec.date).split('-');
    var t = String(rec.time === null || rec.time === undefined ? '' : rec.time).split(':');
    var h = Number(t[0]), m = Number(t[1]);
    return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]),
      isFinite(h) ? h : 0, isFinite(m) ? m : 0, 0, 0);
  }

  function minutesOf(rec) {
    var m = Number(rec && rec.minutes);
    return m > 0 ? m : 60;
  }

  function endOf(rec) {
    var st = startOf(rec);
    return st ? new Date(st.getTime() + minutesOf(rec) * 60000) : null;
  }

  /* Сколько минут до начала. Отрицательное — запись уже началась. */
  function minutesUntil(rec, now) {
    var st = startOf(rec);
    if (!st) return null;
    return Math.ceil((st.getTime() - (now || nowDate()).getTime()) / 60000);
  }

  function isToday(rec, now) {
    return !!rec && rec.date === isoLocal(now || nowDate());
  }

  /* ---------- 1. метка времени на карточке ---------- */

  function timeMark(rec, now) {
    now = now || nowDate();
    if (!isToday(rec, now)) return null;      /* метка времени — только у сегодняшних записей */
    var st = startOf(rec);
    if (!st) return null;
    var en = endOf(rec);
    if (now.getTime() < st.getTime()) {
      var m = Math.ceil((st.getTime() - now.getTime()) / 60000);
      if (m < 60) return { text: 'через ' + m + ' мин', cls: 'soon' };
      var h = Math.floor(m / 60), r = m % 60;
      return { text: 'через ' + h + ' ч' + (r ? ' ' + r + ' мин' : ''), cls: 'soon' };
    }
    if (now.getTime() < en.getTime()) return { text: 'сейчас', cls: 'now' };
    return { text: 'закончилась', cls: 'done' };
  }

  /* ---------- 2. «пора напомнить» ---------- */

  function remindBefore() {
    var v = Number(settings().remindBefore);
    return v > 0 ? v : DEF_REMIND;
  }

  /* Пора напомнить: запись ещё не началась, до неё меньше remindBefore минут,
     а мастер ещё не отмечала напоминание. Начавшуюся запись напоминать поздно. */
  function isDue(rec, now) {
    if (!rec || rec.remindedAt) return false;
    var st = startOf(rec);
    if (!st) return false;
    var left = (st.getTime() - (now || nowDate()).getTime()) / 60000;
    return left > 0 && left <= remindBefore();
  }

  function dueList(now) {
    now = now || nowDate();
    return state().records.filter(function (r) { return isDue(r, now); }).sort(function (a, b) {
      var x = startOf(a), y = startOf(b);
      return (x ? x.getTime() : 0) - (y ? y.getTime() : 0);
    });
  }

  function findRecord(id) {
    var list = state().records || [];
    for (var i = 0; i < list.length; i++) {
      if (String(list[i].id) === String(id)) return list[i];
    }
    return null;
  }

  /* Готовая разметка меток для карточки записи (её рисует js/app.js).
     Возвращается строкой HTML, поэтому весь пользовательский текст проходит esc(). */
  function apptMarkHTML(rec) {
    if (!rec) return '';
    var now = nowDate();
    var out = '';
    var tm = timeMark(rec, now);
    if (tm) out += '<span class="tm-mark ' + tm.cls + '">' + esc(tm.text) + '</span>';
    if (isDue(rec, now)) out += '<span class="rec-due">пора напомнить</span>';
    if (rec.remindedAt) out += '<span class="rec-reminded">напомнила ' + esc(fmtDate(rec.remindedAt)) + '</span>';
    return out;
  }

  /* ---------- 3. текст напоминания и лист сообщения из js/care.js ---------- */

  /* Текст напоминания. Поля можно переопределить (opts): в шите записи мастер может
     успеть поправить имя, телефон, дату или время — напоминание должно уйти с ними. */
  function remindText(rec, opts) {
    opts = opts || {};
    var name = asName(opts.name) || asName(rec && rec.name) || 'клиент';
    var date = opts.date !== undefined && opts.date !== '' ? opts.date : (rec ? rec.date : '');
    var time = opts.time !== undefined && opts.time !== '' ? opts.time : (rec ? rec.time : '');
    var svc = opts.svc !== undefined && opts.svc !== '' ? opts.svc : (rec ? rec.svcName : '');
    svc = asName(svc) || 'услуга не указана';
    return 'Здравствуйте, ' + name + '! Напоминаю: ' + fmtDate(date) + ' в ' + time + ', ' + svc + '.';
  }

  function phoneOf(rec) {
    var own = asName(rec && rec.phone);
    if (own) return own;
    var client = typeof MZ.findClientByName === 'function' ? MZ.findClientByName(rec && rec.name) : null;
    return client ? String(client.phone || '') : '';
  }

  /* Лист сообщения ОДИН на всё приложение: он объявлен в index.html и обслуживается
     js/care.js. Здесь только наполнение: заголовок, текст и контекст записи. */
  function openForRecord(rec, opts) {
    if (!rec) return false;
    if (!MZ.care || !MZ.care.sheet || typeof MZ.care.sheet.open !== 'function') return false;
    opts = opts || {};
    var client = typeof MZ.findClientByName === 'function' ? MZ.findClientByName(rec.name) : null;
    MZ.care.sheet.open('Напомнить клиенту', remindText(rec, opts), {
      kind: 'remind',
      record: rec,
      client: client,
      phone: asName(opts.phone) || phoneOf(rec)
    });
    return true;
  }

  /* «Напомнила» ставит записи локальную дату; «снять» возвращает null. */
  function markRecord(id, when) {
    var rec = findRecord(id);
    if (!rec) return null;
    rec.remindedAt = when || isoLocal(nowDate());
    save();
    afterChange();
    return rec;
  }

  function unmarkRecord(id) {
    var rec = findRecord(id);
    if (!rec) return null;
    rec.remindedAt = null;
    save();
    afterChange();
    return rec;
  }

  function afterChange() {
    if (typeof MZ.renderDay === 'function') MZ.renderDay();
    if (shown) render();
    paintSheetButtons();
  }

  /* ---------- 4. сводка при открытии ---------- */

  function byTime(a, b) { return String(a.time).localeCompare(String(b.time)); }

  function todayRecords(now) {
    var iso = isoLocal(now || nowDate());
    return (state().records || []).filter(function (r) { return r.date === iso; }).sort(byTime);
  }

  function birthdaysToday() {
    if (!MZ.care || typeof MZ.care.bdList !== 'function') return [];
    return MZ.care.bdList().filter(function (item) {
      return item && item.info && item.info.days === 0;
    }).map(function (item) { return item.c; });
  }

  function nearestOf(list, now) {
    var running = null;
    for (var i = 0; i < list.length; i++) {
      var st = startOf(list[i]), en = endOf(list[i]);
      if (!st || !en) continue;
      if (en.getTime() <= now.getTime()) continue;        /* уже закончилась */
      if (st.getTime() > now.getTime()) return list[i];   /* первая будущая — она и ближайшая */
      if (!running) running = list[i];                    /* идёт прямо сейчас */
    }
    return running;
  }

  function digestData(now) {
    now = now || nowDate();
    var list = todayRecords(now);
    var income = 0, unpaidSum = 0, unpaidCount = 0;
    list.forEach(function (r) {
      var price = Number(r.price) || 0;
      income += price;
      if (!r.paid) { unpaidSum += price; unpaidCount++; }
    });
    return {
      now: now,
      list: list,
      count: list.length,
      income: income,
      unpaidSum: unpaidSum,
      unpaidCount: unpaidCount,
      nearest: nearestOf(list, now),
      due: dueList(now),
      bd: birthdaysToday()
    };
  }

  /* «9 часов 4 минуты», «1 день 2 часа», «45 минут»: крупные единицы не размениваем
     на минуты. Ноль часов и ноль минут не печатаем, чтобы не было «0 минут». */
  function leftWords(m) {
    if (m <= 0) return 'сейчас';
    var d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60), mm = m % 60;
    var parts = [];
    if (d) parts.push(nOf(d, 'день', 'дня', 'дней'));
    if (h) parts.push(nOf(h, 'час', 'часа', 'часов'));
    if (mm) parts.push(nOf(mm, 'минуту', 'минуты', 'минут'));
    if (!parts.length) return 'меньше минуты';
    return parts.join(' ');
  }

  function nearestText(d) {
    if (!d.nearest) return 'все уже прошли';
    var st = startOf(d.nearest);
    if (!st || d.now.getTime() >= st.getTime()) return 'сейчас';
    var m = Math.ceil((st.getTime() - d.now.getTime()) / 60000);
    return 'ближайшая через ' + leftWords(m);
  }

  function digestText(now) {
    var d = digestData(now);
    if (!d.count) return 'Сегодня записей нет — свободный день';
    var parts = ['Сегодня ' + nOf(d.count, 'запись', 'записи', 'записей')];
    parts.push(nearestText(d));
    parts.push('доход дня ' + money(d.income) + ' ' + cur());
    if (d.unpaidSum > 0) parts.push('не оплачено ' + money(d.unpaidSum) + ' ' + cur());
    return parts.join(' · ');
  }

  /* «сегодня в 14:00» / «завтра в 10:00» / «через 3 дня в 12:00».
     Дни считаем по локальным датам в полдень: перевод часов не даёт сдвига. */
  function whenLabel(rec, now) {
    var st = startOf(rec);
    if (!st) return '';
    now = now || nowDate();
    var days = Math.round((parseISODay(isoLocal(st)).getTime() - parseISODay(isoLocal(now)).getTime()) / 86400000);
    var day;
    if (days <= 0) day = 'сегодня';
    else if (days === 1) day = 'завтра';
    else day = 'через ' + nOf(days, 'день', 'дня', 'дней');
    return day + ' в ' + String(rec.time || '');
  }

  function rowsHTML(d, now) {
    var html = '';
    d.due.forEach(function (rec) {
      html += '<div class="digest-row">' +
        '<span class="digest-note">Пора напомнить: ' + esc(asName(rec.name) || 'без имени') +
        ' — ' + esc(whenLabel(rec, now)) + '</span>' +
        '<button class="mini-btn" type="button" data-remind="' + esc(rec.id) + '">Напомнить</button>' +
        '</div>';
    });
    d.bd.forEach(function (c) {
      html += '<div class="digest-row">' +
        '<span class="digest-note">День рождения сегодня: ' + esc(asName(c.name) || 'без имени') + '</span>' +
        '<button class="mini-btn" type="button" data-greet="' + esc(c.id) + '">Поздравить</button>' +
        '</div>';
    });
    return html;
  }

  function wireRows() {
    $$('#digestList [data-remind]').forEach(function (b) {
      b.addEventListener('click', function () {
        var rec = findRecord(b.dataset.remind);
        if (rec) openForRecord(rec);
      });
    });
    $$('#digestList [data-greet]').forEach(function (b) {
      b.addEventListener('click', function () {
        var client = null;
        var list = state().clients || [];
        for (var i = 0; i < list.length; i++) {
          if (String(list[i].id) === String(b.dataset.greet)) client = list[i];
        }
        if (client && MZ.care && typeof MZ.care.openGreet === 'function') MZ.care.openGreet(client);
      });
    });
  }

  function render() {
    var box = $('#digest');
    if (!box) return '';
    var now = nowDate();
    var d = digestData(now);
    setText('#digestText', digestText(now));
    var list = $('#digestList');
    if (list) {
      var html = rowsHTML(d, now);
      list.innerHTML = html;
      list.hidden = !html;
      if (html) wireRows();
    }
    return digestText(now);
  }

  function digestEnabled() { return settings().digest !== false; }

  function setVisible(v) {
    shown = !!v;
    var box = $('#digest');
    if (box) box.hidden = !v;
  }

  /* Порог 30 минут: первое открытие показываем всегда, повторное — только когда
     с прошлого показа прошло не меньше gapMs. */
  function show() {
    if (closed || !digestEnabled()) return false;
    var box = $('#digest');
    if (!box) return false;
    var t = nowDate().getTime();
    if (lastShown && (t - lastShown) < gapMs) return false;
    render();
    setVisible(true);
    lastShown = t;
    return true;
  }

  function hide() { setVisible(false); }

  /* Крестик: до конца сессии сводка больше не всплывает сама. */
  function close() { closed = true; setVisible(false); }

  /* «Приложение открыли снова»: снимаем и закрытие, и порог (как в макете).
     В обычной жизни этот путь проходит сам: при перезапуске файл загружается заново
     и lastShown начинается с нуля. */
  function reset() { closed = false; lastShown = 0; setVisible(false); }

  function refresh() {
    if (shown) render();
    /* метки времени на карточках тоже пересчитываются: пока приложение было свёрнуто,
       запись могла начаться или закончиться */
    if (typeof MZ.renderDay === 'function') MZ.renderDay();
    return digestText();
  }

  function onReturn() {
    if (doc && doc.hidden) return false;
    refresh();
    return show();
  }

  /* Закрытие тапом по фону: тап по экрану «Записи» вне карточки сводки прячет её —
     именно прячет, а не закрывает до перезапуска: это делает крестик. Спрятанная
     сводка вернётся сама при следующем возврате в приложение, но не раньше порога.
     Тап внутри самой карточки и тап на других экранах (например, переключателя сводки
     в «Ещё») сводку не трогает. Родителя берём через parentNode (браузер) с запасным
     .parent (подставной DOM в проверках). */
  function up(node) { return node.parentNode || node.parent || null; }

  function onDocClick(ev) {
    var box = $('#digest');
    if (!box || box.hidden) return;
    var screen = $('#s-notes');
    var node = ev && ev.target ? ev.target : null;
    var inBox = false, inScreen = false;
    while (node) {
      if (node === box) inBox = true;
      if (node === screen) inScreen = true;
      node = up(node);
    }
    if (inBox || !inScreen) return;
    hide();
  }

  /* ---------- 5. настройки в «Ещё» ---------- */

  function paintToggle() {
    var tg = $('#digestToggle');
    if (tg) tg.setAttribute('aria-checked', digestEnabled() ? 'true' : 'false');
  }

  function paintChips() {
    var box = $('#remindChips');
    if (!box) return;
    var current = remindBefore();
    box.innerHTML = REMIND_VALUES.map(function (v) {
      return '<button type="button" class="chip' + (current === v ? ' is-on' : '') +
        '" data-remind-before="' + v + '">' + REMIND_LABELS[v] + '</button>';
    }).join('');
    $$('#remindChips [data-remind-before]').forEach(function (b) {
      b.addEventListener('click', function () {
        var v = Number(b.dataset.remindBefore);
        settings().remindBefore = v;
        save();
        paintChips();
        if (typeof MZ.renderDay === 'function') MZ.renderDay();
        if (shown) render();
        toast('Напомним ' + (REMIND_LABELS[v] || 'заранее'));
      });
    });
  }

  function wireToggle() {
    var tg = $('#digestToggle');
    if (!tg) return;
    tg.addEventListener('click', function () {
      var st = settings();
      st.digest = !(st.digest !== false);
      save();
      paintToggle();
      if (st.digest) {
        closed = false;
        lastShown = 0;      /* мастер сама включила сводку — показываем сразу */
        show();
      } else {
        hide();
      }
      toast(st.digest ? 'Сводка при открытии включена' : 'Сводка при открытии выключена');
    });
  }

  /* ---------- 6. кнопки напоминания в шите записи ---------- */

  var curRec = null;

  function paintSheetButtons() {
    var rem = $('#fRemind');
    var un = $('#fUnremind');
    if (rem) rem.hidden = !curRec;
    if (un) un.hidden = !(curRec && curRec.remindedAt);
  }

  /* Точка расширения js/app.js: шит открыт на существующей записи (или на новой — null). */
  function onSheetRecord(rec) {
    curRec = rec || null;
    paintSheetButtons();
  }

  function svcFromForm(rec) {
    var sel = $('#fService');
    if (sel) {
      if (sel.value === '__own') return val('#fSvcName') || rec.svcName || '';
      if (typeof MZ.findService === 'function') {
        var svc = MZ.findService(sel.value);
        if (svc) return svc.name;
      }
    }
    return rec.svcName || '';
  }

  function wireSheetButtons() {
    var rem = $('#fRemind');
    if (rem) {
      rem.addEventListener('click', function () {
        if (!curRec) return;
        /* Текст берём из открытой формы: мастер могла поправить имя, телефон, дату
           или время и ещё не сохранить запись. */
        openForRecord(curRec, {
          name: val('#fClient') || curRec.name,
          phone: val('#fPhone'),
          date: val('#fDate') || curRec.date,
          time: val('#fTime') || curRec.time,
          svc: svcFromForm(curRec)
        });
      });
    }
    var un = $('#fUnremind');
    if (un) {
      un.addEventListener('click', function () {
        if (!curRec) return;
        unmarkRecord(curRec.id);
        toast('Напоминание снято');
      });
    }
    paintSheetButtons();
  }

  /* ---------- 7. события браузера ---------- */

  function wireDigestClose() {
    var x = $('#digestClose');
    if (x) x.addEventListener('click', close);
  }

  function listen() {
    if (doc && typeof doc.addEventListener === 'function') {
      doc.addEventListener('visibilitychange', function () {
        if (!doc.hidden) onReturn();
      });
      doc.addEventListener('click', onDocClick);
    }
    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
      window.addEventListener('focus', function () { onReturn(); });
    }
  }

  /* ---------- публичный API ---------- */

  MZ.apptMarkHTML = apptMarkHTML;
  MZ.onSheetRecord = onSheetRecord;
  /* js/care.js зовёт это после «Напомнила»: перерисовать карточки дня и сводку. */
  MZ.onReminded = function () { afterChange(); };

  MZ.remind = {
    values: REMIND_VALUES,
    labels: REMIND_LABELS,
    setClock: function (fn) {
      clock = typeof fn === 'function' ? fn : function () { return new Date(); };
    },
    now: nowDate,
    isoLocal: isoLocal,
    startOf: startOf,
    endOf: endOf,
    minutesUntil: minutesUntil,
    mark: timeMark,
    isDue: isDue,
    dueList: dueList,
    remindBefore: remindBefore,
    textFor: remindText,
    openFor: openForRecord,
    markRecord: markRecord,
    unmarkRecord: unmarkRecord,
    findRecord: findRecord,
    fmtDate: fmtDate,
    whenLabel: whenLabel,
    leftWords: leftWords,
    apptMarkHTML: apptMarkHTML,
    settings: settings,
    digest: {
      data: digestData,
      text: digestText,
      render: render,
      show: show,
      hide: hide,
      close: close,
      reset: reset,
      onReturn: onReturn,
      refresh: refresh,
      enabled: digestEnabled,
      isShown: function () { return shown; },
      isClosed: function () { return closed; },
      lastShown: function () { return lastShown; },
      setGap: function (v) { gapMs = Number(v) || 0; },
      gap: function () { return gapMs; },
      GAP_MS: GAP_MS
    }
  };

  /* ---------- старт ---------- */

  wireSheetButtons();
  wireDigestClose();
  paintToggle();
  paintChips();
  wireToggle();
  listen();
  show();                                     /* первое открытие приложения */
  if (typeof MZ.renderDay === 'function') MZ.renderDay();   /* метки времени и «пора напомнить» */
})();
