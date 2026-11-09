/* clients.js — экран «Клиенты», карточка клиента и подсказки при вводе имени.
 *
 * Что делает файл:
 *   - рисует список клиентов: имя, телефон, сколько всего записей, дата последнего
 *     визита и сумма по всем записям;
 *   - ищет по имени и по цифрам телефона («911» находит «+7 911 …»);
 *   - переключает сортировку: по имени / по последнему визиту (сначала недавние);
 *   - открывает карточку клиента в шите: правка имени, телефона и заметки, история
 *     записей (свежие сверху), «Новая запись» и «Удалить клиента» с подтверждением;
 *   - показывает подсказки клиентов в форме записи — блоком В ПОТОКЕ (#fClientHints):
 *     absolute-позиционирование срезал overflow шита, поэтому список расталкивает форму;
 *   - делает кнопку «+» контекстной: «Записи» — форма записи (её открывает js/app.js),
 *     «Клиенты» — карточка нового клиента.
 *
 * Шаг 7 (забота о клиентах) добавил сюда то, что относится к самому списку и карточке:
 *   - метки в списке: «ЧС», «спящий», «ДР …»;
 *   - фильтр-чип «Спящие» рядом с сортировкой и правило «спящего» клиента
 *     (был хотя бы один визит, последний — больше settings.sleepingDays дней назад);
 *   - поля карточки: день и месяц рождения (в контракте — строка «ММ-ДД») и ЧС с причиной.
 * Предупреждение о ЧС в форме записи, лист напоминания и блок «Скоро день рождения» —
 * в js/care.js: он подключается после этого файла и берёт проверки отсюда.
 *
 * Правила контракта (beauty-pwa-ПЛАН.md):
 *   - даты только локальные: toISOString() и Date.parse('YYYY-MM-DD') для дат запрещены;
 *   - никаких имён в inline-onclick: только addEventListener, data-id и esc()/textContent;
 *   - статистика по клиентам считается ОДНИМ проходом по записям за отрисовку,
 *     чтобы поиск по буквам не пересчитывал базу дважды.
 *
 * Клиент — контракт v2: {id, name, phone, birthday, note, blacklist, blacklistReason, remindedAt}.
 * Помощники MZ.upsertClient / MZ.findClientByName / MZ.nameKey — из js/app.js, логика не дублируется.
 */
(function () {
  'use strict';

  var MZ = window.MZ;
  if (!MZ || !MZ.store) return;

  var $ = function (sel) { return document.querySelector(sel); };
  var $$ = function (sel) { return Array.prototype.slice.call(document.querySelectorAll(sel)); };

  var MON = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
    'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];

  var HINTS_LIMIT = 5;                 /* максимум подсказок в форме записи */

  /* ---------- состояние и мелкие помощники ---------- */

  function state() { return MZ.state || MZ.store.load(); }

  function clients() {
    var s = state();
    if (!Array.isArray(s.clients)) s.clients = [];
    return s.clients;
  }

  function records() {
    var s = state();
    if (!Array.isArray(s.records)) s.records = [];
    return s.records;
  }

  function asName(value) {
    return String(value === null || value === undefined ? '' : value).replace(/\s+/g, ' ').trim();
  }

  /* Только цифры: по ним ищем телефон и сравниваем номера в разных написаниях. */
  function digitsOf(value) { return String(value === null || value === undefined ? '' : value).replace(/\D/g, ''); }

  function nameKey(value) {
    return typeof MZ.nameKey === 'function' ? MZ.nameKey(value) : asName(value).toLowerCase();
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

  function plural(n, one, few, many) {
    var abs = Math.abs(Number(n) || 0) % 100;
    var last = abs % 10;
    if (abs > 10 && abs < 20) return many;
    if (last === 1) return one;
    if (last >= 2 && last <= 4) return few;
    return many;
  }

  function visitsText(n) {
    var count = Number(n) || 0;
    return count ? count + ' ' + plural(count, 'запись', 'записи', 'записей') : 'записей нет';
  }

  var toastTimer = null;
  function toast(message) {
    if (!message) return;
    if (typeof MZ.toast === 'function') { MZ.toast(message); return; }
    if (!document.createElement || !document.body || !document.body.appendChild) return;
    var box = $('#toastBox');
    if (!box) {
      box = document.createElement('div');
      box.id = 'toastBox';
      document.body.appendChild(box);
    }
    box.textContent = message;
    box.className = 'toast';
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      box.textContent = '';
      box.className = '';
    }, 2200);
  }

  function findById(id) {
    var key = String(id);
    var list = clients();
    for (var i = 0; i < list.length; i++) {
      if (String(list[i].id) === key) return list[i];
    }
    return null;
  }

  function initials(name) {
    var parts = asName(name).split(' ').filter(Boolean);
    if (!parts.length) return '?';
    var out = parts[0].charAt(0);
    if (parts[1]) out += parts[1].charAt(0);
    return out.toUpperCase();
  }

  /* Локальный разбор даты. Date.parse('2026-11-08') считает строку по UTC
     и в UTC+ сдвигает день — поэтому разбираем вручную, как в js/app.js. */
  function parseISO(value) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''));
    if (!m) return null;
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0, 0);
  }

  function dateText(value) {
    var d = parseISO(value);
    if (!d) return String(value || '');
    var year = d.getFullYear() === new Date().getFullYear() ? '' : ' ' + d.getFullYear();
    return d.getDate() + ' ' + MON[d.getMonth()].slice(0, 3) + year;
  }

  /* Нормализация телефона: 8XXXXXXXXXX и XXXXXXXXXX → «+7 XXX XXX-XX-XX».
     Незнакомый формат (зарубежный номер, добавочный) бережно возвращаем как есть. */
  function normPhone(value) {
    var raw = asName(value);
    if (!raw) return '';
    var digits = digitsOf(raw);
    if (digits.length === 11 && digits.charAt(0) === '8') digits = '7' + digits.slice(1);
    if (digits.length === 10 && digits.charAt(0) === '9') digits = '7' + digits;
    if (digits.length === 11 && digits.charAt(0) === '7') {
      return '+7 ' + digits.slice(1, 4) + ' ' + digits.slice(4, 7) + '-' +
        digits.slice(7, 9) + '-' + digits.slice(9, 11);
    }
    return raw;
  }

/* ---------- забота о клиентах: спящие и дни рождения (шаг 7) ---------- */

  var BD_AHEAD = 7;                    /* «день рождения близко»: сегодня и 7 дней вперёд */
  var DAY_MS = 86400000;
  /* Длина месяца для проверки ввода; февраль 29 разрешён всегда — в невисокосный год
     поздравляем 28 февраля, поэтому такая дата обязана сохраняться. */
  var BD_MONTH_DAYS = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

  function pad2(n) { return n < 10 ? '0' + n : String(n); }

  function settings() {
    var s = state();
    if (!s.settings || typeof s.settings !== 'object') s.settings = {};
    return s.settings;
  }

  /* Порог «спящего» клиента из настроек; пустое или мусорное значение — 60 дней. */
  function sleepingDays() {
    var n = Number(settings().sleepingDays);
    return isFinite(n) && n > 0 ? n : 60;
  }

  /* Полдень сегодняшнего дня: перевод часов и летнее время не сдвигают счёт суток. */
  function todayNoon() {
    var d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12, 0, 0, 0);
  }

  /* Сколько суток назад была дата (локально). null — даты нет или она битая. */
  function daysSince(value) {
    var d = parseISO(String(value === null || value === undefined ? '' : value).slice(0, 10));
    if (!d) return null;
    return Math.round((todayNoon().getTime() - d.getTime()) / DAY_MS);
  }

  /* «Спящий» = хотя бы один визит и последний визит больше settings.sleepingDays дней
     назад. Клиенты без визитов в этот список не попадают. Если мастер недавно нажала
     «Напомнила», клиент уходит из списка на settings.sleepingDays дней, чтобы не
     мозолить глаза: за это время он либо вернётся, либо вернётся в список сам. */
  function sleepInfo(row) {
    var out = { sleeping: false, days: null, care: null };
    if (!row || !row.count || !row.last) return out;
    var days = daysSince(row.last);
    out.days = days;
    if (days === null || days <= sleepingDays()) return out;
    var care = daysSince(row.c.remindedAt);
    out.care = care;
    if (care !== null && care < sleepingDays()) return out;
    out.sleeping = true;
    return out;
  }

  /* День рождения в контракте — строка «ММ-ДД» или null. Старый формат макета
     ({d, m, y}) тоже принимаем: данные пользователя не должны теряться. */
  function parseBd(value) {
    if (value && typeof value === 'object') {
      return validBd(Number(value.m), Number(value.d));
    }
    var m = /^(\d{1,2})-(\d{1,2})$/.exec(asName(value));
    if (!m) return null;
    return validBd(Number(m[1]), Number(m[2]));
  }

  function validBd(month, day) {
    if (!(month >= 1 && month <= 12)) return null;
    if (!(day >= 1 && day <= BD_MONTH_DAYS[month - 1])) return null;
    return pad2(month) + '-' + pad2(day);
  }

  function isLeapYear(year) {
    return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  }

  function daysInMonth(year, month) {
    if (month === 2) return isLeapYear(year) ? 29 : 28;
    return BD_MONTH_DAYS[month - 1];
  }

  /* Ближайший день рождения: сравнение по «ММ-ДД» без Date.parse. 29 февраля в
     невисокосный год переносится на 28 февраля, а день рождения 2 января в конце
     декабря честно уезжает на следующий год. */
  function bdWithin(value, ahead) {
    var bd = parseBd(value);
    if (!bd) return null;

    var month = Number(bd.slice(0, 2));
    var day = Number(bd.slice(3));
    var limit = Number(ahead) >= 0 ? Number(ahead) : BD_AHEAD;
    var base = todayNoon();
    var year = base.getFullYear();

    var when = new Date(year, month - 1, Math.min(day, daysInMonth(year, month)), 12, 0, 0, 0);
    var days = Math.round((when.getTime() - base.getTime()) / DAY_MS);
    if (days < 0) {
      year += 1;
      when = new Date(year, month - 1, Math.min(day, daysInMonth(year, month)), 12, 0, 0, 0);
      days = Math.round((when.getTime() - base.getTime()) / DAY_MS);
    }
    if (days > limit) return null;
    return { md: bd, days: days, month: month, day: day, date: when, year: year };
  }

  /* «сегодня», «завтра», «через 3 дня» — для метки и блока «Скоро день рождения». */
  function inDays(days) {
    var n = Number(days) || 0;
    if (n <= 0) return 'сегодня';
    if (n === 1) return 'завтра';
    return 'через ' + n + ' ' + plural(n, 'день', 'дня', 'дней');
  }

  /* «14 марта» — дата без года: год рождения в контракте не хранится. */
  function bdText(info) {
    if (!info) return '';
    return info.day + ' ' + MON[info.month - 1];
  }

  /* ---------- записи клиента ---------- */

  /* Запись принадлежит клиенту, если совпало имя (регистр не важен) или совпал
     телефон по цифрам: после переименования карточки история не теряется. */
  function clientRecords(client) {
    if (!client) return [];
    var key = nameKey(client.name);
    var digits = digitsOf(client.phone);
    return records().filter(function (r) {
      if (key && nameKey(r.name) === key) return true;
      return !!digits && digitsOf(r.phone) === digits;
    });
  }

  function byFreshness(a, b) {
    var da = String(a.date || '') + ' ' + String(a.time || '');
    var db = String(b.date || '') + ' ' + String(b.time || '');
    if (da === db) return 0;
    return da < db ? 1 : -1;            /* свежие сверху */
  }

  /* ---------- список клиентов ---------- */

  var sortMode = 'name';               /* 'name' | 'last' */
  var listFilter = 'all';              /* 'all' | 'sleep' — чипы «Все» / «Спящие» */

  /* Один проход по записям на всю отрисовку: имя/телефон клиента → записи, визиты, сумма.
     Поиск по буквам перерисовывает список, но статистику берёт из этого же расчёта. */
  function buildRows() {
    var list = clients();
    var byName = {};
    var byPhone = {};

    list.forEach(function (c, i) {
      var key = nameKey(c.name);
      if (key && byName[key] === undefined) byName[key] = i;
      var digits = digitsOf(c.phone);
      if (digits && byPhone[digits] === undefined) byPhone[digits] = i;
    });

    var rows = list.map(function (c) {
      return { c: c, count: 0, sum: 0, last: '' };
    });

    records().forEach(function (r) {
      var key = nameKey(r.name);
      var i = key && byName[key] !== undefined ? byName[key] : -1;
      if (i < 0) {
        var digits = digitsOf(r.phone);
        i = digits && byPhone[digits] !== undefined ? byPhone[digits] : -1;
      }
      if (i < 0) return;
      var row = rows[i];
      row.count++;
      row.sum += Number(r.price) || 0;
      var stamp = String(r.date || '') + ' ' + String(r.time || '');
      if (stamp > row.last) row.last = stamp;
    });

    return rows;
  }

  function filterRows(rows, query) {
    var q = asName(query).toLowerCase();
    if (!q) return rows;
    var digits = digitsOf(q);
    return rows.filter(function (row) {
      if (String(row.c.name || '').toLowerCase().indexOf(q) >= 0) return true;
      return !!digits && digitsOf(row.c.phone).indexOf(digits) >= 0;
    });
  }

  /* Ключ сортировки по имени: ведущая пунктуация («<b>Злой</b>», «"Аня"») не должна
     уводить клиента в начало списка — сравниваем по первой букве или цифре. */
  function sortKey(name) {
    return String(name === null || name === undefined ? '' : name)
      .replace(/^[^0-9A-Za-zА-Яа-яЁё]+/, '');
  }

  function sortRows(rows, mode) {
    var copy = rows.slice();
    if (mode === 'last') {
      copy.sort(function (a, b) {
        if (a.last !== b.last) return a.last < b.last ? 1 : -1;
        return sortKey(a.c.name).localeCompare(sortKey(b.c.name), 'ru');
      });
      return copy;
    }
    copy.sort(function (a, b) {
      return sortKey(a.c.name).localeCompare(sortKey(b.c.name), 'ru');
    });
    return copy;
  }

  function rowHTML(row) {
    var c = row.c;
    var sleep = sleepInfo(row);
    var bd = bdWithin(c.birthday, BD_AHEAD);
    var sub = (c.phone || 'телефон не указан') + ' · ' + visitsText(row.count) +
      (row.last ? ' · последний визит ' + dateText(row.last.slice(0, 10)) : '');

    /* В фильтре «Спящие» подпись отвечает на вопрос «сколько уже не был(а)» —
       это единственное место, где она отличается от обычного списка. */
    if (listFilter === 'sleep' && sleep.days !== null) {
      sub = (c.phone || 'телефон не указан') + ' · не был(а) ' +
        sleep.days + ' ' + plural(sleep.days, 'день', 'дня', 'дней') +
        ' · последний визит ' + (row.last ? dateText(row.last.slice(0, 10)) : 'не было');
    }

    /* Метки: ЧС, «спящий», близкий день рождения. Все — <span>, а не <b>:
       в строку клиента не должен попадать жирный текст из данных. */
    var marks = '';
    if (c.blacklist) marks += '<span class="bl-mark">ЧС</span>';
    if (sleep.sleeping) marks += '<span class="sleep-mark">спящий</span>';
    if (bd) marks += '<span class="bd-mark">ДР ' + esc(inDays(bd.days)) + '</span>';
    /* «писали N дн. назад» — по дате последней рассылки (js/broadcast.js ставит
       broadcastAt). Свежая рассылка в метке не нуждается: «писали 0 дн. назад» — шум. */
    var wrote = daysSince(c.broadcastAt);
    if (wrote !== null && wrote > 0) {
      marks += '<span class="wrote-mark">писали ' + wrote + ' ' +
        plural(wrote, 'день', 'дня', 'дней') + ' назад</span>';
    }

    return '<button class="client" type="button" data-id="' + esc(c.id) + '">' +
      '<span class="avatar">' + esc(initials(c.name)) + '</span>' +
      '<span class="info"><span class="nm">' + esc(c.name || 'Без имени') + marks + '</span>' +
      '<span class="sub">' + esc(sub) + '</span></span>' +
      '<span class="sum">' + money(row.sum) + ' ' + esc(cur()) + '</span></button>' +
      /* «Напомнить» живёт ВНЕ кнопки-строки: вложенная кнопка ломает и разметку, и тап. */
      (listFilter === 'sleep' && sleep.sleeping
        ? '<div class="client-acts"><span class="muted small">' +
          (sleep.care === null ? 'напоминаний не было' : 'напоминали ' + sleep.care +
            ' ' + plural(sleep.care, 'день', 'дня', 'дней') + ' назад') +
          '</span><button class="mini-btn" type="button" data-remind="' + esc(c.id) +
          '">Напомнить</button></div>'
        : '');
  }

  /* Обёртка нужна только когда под строкой есть блок действий, — так обычный список
     остаётся той же лентой .list > .client, что и был. */
  function rowBlockHTML(row) {
    var html = rowHTML(row);
    if (html.indexOf('<div class="client-acts">') === -1) return html;
    return '<div class="client-wrap">' + html + '</div>';
  }

  function searchValue() {
    var input = $('#clientSearch');
    return input ? String(input.value || '') : '';
  }

  function renderClients() {
    var box = $('#clientList');
    if (!box) return;

    var all = buildRows();
    var shown = sortRows(filterRows(all, searchValue()), sortMode);
    if (listFilter === 'sleep') {
      shown = shown.filter(function (row) { return sleepInfo(row).sleeping; });
    }

    box.innerHTML = shown.map(rowBlockHTML).join('');
    $$('#clientList .client').forEach(function (b) {
      b.addEventListener('click', function () { openCard(b.dataset.id); });
    });
    $$('#clientList [data-remind]').forEach(function (b) {
      b.addEventListener('click', function (e) {
        if (e && typeof e.stopPropagation === 'function') e.stopPropagation();
        var client = findById(b.dataset.remind);
        if (client && typeof MZ.care === 'object' && MZ.care && typeof MZ.care.openRemind === 'function') {
          MZ.care.openRemind(client);
        }
      });
    });

    var empty = $('#clientEmpty');
    if (empty) {
      if (!all.length) {
        empty.hidden = false;
        empty.textContent = 'Клиентов пока нет. Добавьте первого кнопкой «+».';
      } else if (!shown.length && listFilter === 'sleep' && !asName(searchValue())) {
        empty.hidden = false;
        empty.textContent = 'Спящих клиентов нет: все были в салоне недавно.';
      } else if (!shown.length) {
        empty.hidden = false;
        empty.textContent = 'Никого не найдено по запросу «' + asName(searchValue()) + '».';
      } else {
        empty.hidden = true;
        empty.textContent = '';
      }
    }

    /* Точка расширения шага 7: по этой отрисовке js/care.js обновляет свои блоки. */
    if (typeof MZ.onClientsRendered === 'function') MZ.onClientsRendered();
  }

  function paintSort() {
    $$('#clientSort [data-sort]').forEach(function (b) {
      b.classList.toggle('is-on', b.dataset.sort === sortMode);
      b.setAttribute('aria-pressed', b.dataset.sort === sortMode ? 'true' : 'false');
    });
  }

  function paintCare() {
    $$('#clientCare [data-care]').forEach(function (b) {
      b.classList.toggle('is-on', b.dataset.care === listFilter);
      b.setAttribute('aria-pressed', b.dataset.care === listFilter ? 'true' : 'false');
    });
  }

  function setFilter(mode) {
    listFilter = mode === 'sleep' ? 'sleep' : 'all';
    paintCare();
    renderClients();
    return listFilter;
  }

  /* ---------- карточка клиента (шит) ---------- */

  var cardId = null;                   /* null — новый клиент, иначе id правимого */
  var cardScroll = 0;
  var cardLocked = false;

  /* Пока открыт шит карточки, содержимое .screens не прокручивается (как в шите записи). */
  function lockScreens(on) {
    var screens = $('#screens');
    if (!screens) return;
    if (on === cardLocked) return;
    if (on) {
      cardScroll = typeof screens.scrollTop === 'number' ? screens.scrollTop : 0;
      screens.classList.add('is-locked');
    } else {
      screens.classList.remove('is-locked');
      screens.scrollTop = cardScroll;
      cardScroll = 0;
    }
    cardLocked = on;
  }

  function showErr(text) {
    var el = $('#clErr');
    if (!el) return;
    if (text) { el.textContent = text; el.hidden = false; }
    else { el.textContent = ''; el.hidden = true; }
  }

  /* Поля дня рождения: «—» в первом пункте означает «не указан» и сохраняется как null.
     Год в контракте клиента не хранится (день рождения — строка «ММ-ДД»), поэтому он
     остаётся подсказкой для мастера и не влияет на поздравления. */
  function buildBd() {
    var day = $('#clBdDay'), mon = $('#clBdMon');
    if (day) {
      var opts = '<option value="">—</option>';
      for (var d = 1; d <= 31; d++) opts += '<option value="' + d + '">' + d + '</option>';
      day.innerHTML = opts;
    }
    if (mon) {
      var out = '<option value="">—</option>';
      for (var m = 0; m < MON.length; m++) {
        out += '<option value="' + (m + 1) + '">' + MON[m] + '</option>';
      }
      mon.innerHTML = out;
    }
  }

  function setBd(value) {
    var bd = parseBd(value);
    setVal('#clBdDay', bd ? String(Number(bd.slice(3))) : '');
    setVal('#clBdMon', bd ? String(Number(bd.slice(0, 2))) : '');
    setVal('#clBdYear', '');
  }

  /* Собираем «ММ-ДД» только когда выбраны и день, и месяц: половина даты — не дата. */
  function readBd() {
    var day = Number(val('#clBdDay'));
    var mon = Number(val('#clBdMon'));
    if (!(day >= 1 && day <= 31) || !(mon >= 1 && mon <= 12)) return null;
    return validBd(mon, day);
  }

  function blOn() {
    var el = $('#clBl');
    return !!el && el.getAttribute('aria-checked') === 'true';
  }

  /* Причина показывается только при включённом ЧС — как в макете. */
  function syncBl() {
    var wrap = $('#clBlReasonWrap');
    if (wrap) wrap.hidden = !blOn();
  }

  function setBl(client) {
    var el = $('#clBl');
    if (el) el.setAttribute('aria-checked', client && client.blacklist ? 'true' : 'false');
    setVal('#clBlReason', client && client.blacklist ? (client.blacklistReason || '') : '');
    syncBl();
  }

  function historyHTML(r) {
    var when = dateText(r.date) + (r.time ? ' · ' + r.time : '');
    return '<div class="svc"><span>' + esc(when) + ' · ' + esc(r.svcName || 'услуга не указана') +
      '</span><b>' + money(Number(r.price) || 0) + ' ' + esc(cur()) + '</b></div>';
  }

  function renderHistory(client) {
    var box = $('#clHistory');
    if (!box) return;
    var list = clientRecords(client).slice().sort(byFreshness);
    var sum = list.reduce(function (acc, r) { return acc + (Number(r.price) || 0); }, 0);

    var total = $('#clTotal');
    if (total) total.textContent = money(sum) + ' ' + cur();
    var meta = $('#clMeta');
    if (meta) {
      meta.textContent = (client.phone || 'телефон не указан') + ' · ' + visitsText(list.length);
    }

    box.innerHTML = list.length
      ? list.map(historyHTML).join('')
      : '<p class="empty">Записей пока нет</p>';
  }

  function openCard(id) {
    var sheet = $('#sheetClient');
    if (!sheet) return;

    var client = id ? findById(id) : null;
    cardId = client ? String(client.id) : null;

    /* Общая кнопка «+» сначала отработала в js/app.js и открыла шит записи —
       закрываем его честно, через API, чтобы снялась блокировка прокрутки. */
    if (typeof MZ.closeSheet === 'function') MZ.closeSheet();

    setVal('#clName', client ? client.name : '');
    setVal('#clPhone', client ? client.phone : '');
    setVal('#clNote', client ? client.note : '');
    setBd(client ? client.birthday : null);
    setBl(client);

    /* «Напомнить» показываем только у спящего клиента — в карточке это то же
       действие, что и в фильтре «Спящие», и ведёт в один лист (js/care.js). */
    var remind = $('#clRemind');
    if (remind) {
      var sleep = null;
      if (client) {
        var rows = buildRows();
        for (var i = 0; i < rows.length; i++) {
          if (String(rows[i].c.id) === String(client.id)) { sleep = sleepInfo(rows[i]); break; }
        }
      }
      remind.hidden = !(sleep && sleep.sleeping);
    }

    var title = $('#clTitle');
    if (title) title.textContent = client ? 'Клиент' : 'Новый клиент';
    var saveBtn = $('#clSave');
    if (saveBtn) saveBtn.textContent = client ? 'Сохранить' : 'Добавить клиента';
    var del = $('#clDelete');
    if (del) del.hidden = !client;
    var histCard = $('#clHistoryCard');
    if (histCard) histCard.hidden = !client;
    var meta = $('#clMeta');
    if (meta && !client) meta.textContent = '';

    if (client) renderHistory(client);
    showErr('');

    lockScreens(true);
    sheet.hidden = false;

    var nameEl = $('#clName');
    if (nameEl && typeof nameEl.focus === 'function') { try { nameEl.focus(); } catch (e) { /* не критично */ } }
  }

  function closeCard() {
    var sheet = $('#sheetClient');
    if (sheet) sheet.hidden = true;
    cardId = null;
    showErr('');
    lockScreens(false);
  }

  function saveCard(e) {
    if (e && typeof e.preventDefault === 'function') e.preventDefault();

    var name = asName(val('#clName'));
    if (!name) { showErr('Введите имя клиента.'); return; }

    var phone = normPhone(val('#clPhone'));
    var note = String(val('#clNote') || '').trim();
    var birthday = readBd();
    var blacklist = blOn();
    /* ЧС без причины — это ЧС с понятной подписью: предупреждение не должно быть пустым. */
    var blacklistReason = blacklist ? String(val('#clBlReason') || '').trim() : '';
    var key = nameKey(name);

    /* Дубликаты не создаём: ни по имени (регистр не важен), ни по цифрам телефона. */
    var sameName = clients().filter(function (c) {
      return String(c.id) !== String(cardId) && nameKey(c.name) === key;
    })[0];
    if (sameName) {
      showErr('Клиент с таким именем уже есть в базе. Откройте его карточку.');
      return;
    }

    var digits = digitsOf(phone);
    var samePhone = digits ? clients().filter(function (c) {
      return String(c.id) !== String(cardId) && digitsOf(c.phone) === digits;
    })[0] : null;
    if (samePhone) {
      showErr('Этот телефон уже записан у клиента «' + samePhone.name + '». Измените номер.');
      return;
    }

    if (cardId) {
      var client = findById(cardId);
      if (!client) { closeCard(); return; }
      client.name = name;
      client.phone = phone;
      client.note = note;
      client.birthday = birthday;
      client.blacklist = blacklist;
      client.blacklistReason = blacklistReason;
    } else {
      /* Создание — через помощник js/app.js: он же ведёт id и контракт полей. */
      var created = typeof MZ.upsertClient === 'function' ? MZ.upsertClient(name, phone) : null;
      if (created) {
        created.note = note;
        created.birthday = birthday;
        created.blacklist = blacklist;
        created.blacklistReason = blacklistReason;
      } else {
        clients().push({
          id: 'c' + (clients().length + 1), name: name, phone: phone, birthday: birthday, note: note,
          blacklist: blacklist, blacklistReason: blacklistReason, remindedAt: null
        });
      }
    }

    MZ.store.save(state());
    closeCard();
    renderClients();
    /* Карточка могла закрыть шит записи с открытым предупреждением — гасим его след. */
    if (typeof MZ.syncBlackWarn === 'function') MZ.syncBlackWarn();
    toast('Клиент сохранён: ' + name);
  }

  /* Удаление карточки. Записи в журнале остаются — об этом честно говорим в вопросе. */
  function deleteClient() {
    var client = cardId ? findById(cardId) : null;
    if (!client) { closeCard(); return; }

    var count = clientRecords(client).length;
    var question = 'Удалить клиента «' + client.name + '»? ' +
      (count
        ? 'Записи (' + count + ' ' + plural(count, 'штука', 'штуки', 'штук') +
          ') останутся в журнале — удалится только карточка.'
        : 'Записей у этого клиента нет.');

    var agreed = true;
    if (typeof confirm === 'function') agreed = confirm(question);
    if (!agreed) return;

    var s = state();
    s.clients = clients().filter(function (c) { return String(c.id) !== String(client.id); });
    MZ.store.save(s);

    closeCard();
    renderClients();
    toast('Клиент удалён: ' + client.name);
  }

  /* «Новая запись» из карточки: открываем штатный шит записи js/app.js
     и подставляем в него уже выбранного клиента. */
  function newRecordFor(client) {
    if (!client) return;
    closeCard();
    if (typeof MZ.openSheet === 'function') MZ.openSheet();
    setVal('#fClient', client.name);
    setVal('#fPhone', client.phone || '');
    var input = $('#fClient');
    fireInput(input);
    metaPicked = client;             /* клиент выбран осознанно — строку под полем не гасим */
    showMeta(client);
    hideHints();
  }

  /* ---------- подсказки клиентов в форме записи (В ПОТОКЕ) ---------- */

  var metaPicked = null;

  function fireInput(el) {
    if (!el || typeof el.dispatchEvent !== 'function') return;
    try {
      if (typeof Event === 'function') el.dispatchEvent(new Event('input', { bubbles: true }));
    } catch (e) { /* движок без конструктора Event — не критично */ }
  }

  function byName(a, b) {
    return String(a.name || '').localeCompare(String(b.name || ''), 'ru');
  }

  /* Подбор клиентов: сначала совпадения по НАЧАЛУ имени, затем по подстроке имени
     и по цифрам телефона. Пустое поле — первые клиенты базы (как в макете). */
  function matches(query, limit) {
    var max = Number(limit) > 0 ? Number(limit) : HINTS_LIMIT;
    var q = asName(query).toLowerCase();
    var list = clients();

    if (!q) return list.slice().sort(byName).slice(0, max);

    var digits = digitsOf(q);
    var start = [];
    var rest = [];
    list.forEach(function (c) {
      var name = String(c.name || '').toLowerCase();
      if (name.indexOf(q) === 0) { start.push(c); return; }
      if (name.indexOf(q) > 0) { rest.push(c); return; }
      if (digits && digitsOf(c.phone).indexOf(digits) >= 0) rest.push(c);
    });

    return start.sort(byName).concat(rest.sort(byName)).slice(0, max);
  }

  function hintHTML(client) {
    return '<button type="button" class="ac-hint" data-id="' + esc(client.id) + '">' +
      '<span class="ac-hint-name">' + esc(client.name || 'Без имени') + '</span>' +
      '<span class="ac-hint-sub">' + esc(client.phone || 'телефон не указан') + '</span></button>';
  }

  function showMeta(client) {
    var el = $('#fClientMeta');
    if (!el) return;
    if (!client) { el.hidden = true; el.textContent = ''; return; }
    var count = clientRecords(client).length;
    el.textContent = (client.phone || 'телефон не указан') + ' · ' + visitsText(count) +
      (client.note ? ' · ' + client.note : '');
    el.hidden = false;
  }

  function hideHints() {
    var box = $('#fClientHints');
    if (!box) return;
    box.hidden = true;
    box.innerHTML = '';
  }

  function renderHints() {
    var box = $('#fClientHints');
    var input = $('#fClient');
    if (!box || !input) return;

    var found = matches(input.value, HINTS_LIMIT);
    box.innerHTML = found.map(hintHTML).join('');
    box.hidden = found.length === 0;

    $$('#fClientHints .ac-hint').forEach(function (b) {
      b.addEventListener('click', function () { pickHint(b.dataset.id); });
    });
  }

  /* Выбор подсказки подставляет имя и телефон; различать клиентов с похожими
     именами помогает телефон во второй строке подсказки. */
  function pickHint(id) {
    var client = findById(id);
    if (!client) return;
    setVal('#fClient', client.name);
    setVal('#fPhone', client.phone || '');
    metaPicked = client;
    fireInput($('#fClient'));
    showMeta(client);
    hideHints();
  }

  /* ---------- контекстная кнопка «+» ---------- */

  var fab = $('#fabNew');

  function activeTab() {
    var b = $$('.tab').filter(function (x) { return x.classList.contains('is-active'); })[0];
    return b ? b.dataset.tab : null;
  }

  function syncFab() {
    if (!fab) return;
    var tab = activeTab();
    var label = tab === 'notes' ? 'Новая запись' : (tab === 'clients' ? 'Новый клиент' : null);
    fab.hidden = !label;
    fab.disabled = !label;
    fab.setAttribute('aria-label', label || 'Недоступно на этом экране');
  }

  /* ---------- обработчики ---------- */

  var search = $('#clientSearch');
  if (search) search.addEventListener('input', renderClients);

  var sortBox = $('#clientSort');
  if (sortBox) {
    $$('#clientSort [data-sort]').forEach(function (b) {
      b.addEventListener('click', function () {
        sortMode = b.dataset.sort === 'last' ? 'last' : 'name';
        paintSort();
        renderClients();
      });
    });
  }

  /* Чипы «Все» / «Спящие»: «Спящие» — не сортировка, а фильтр по последнему визиту. */
  var careBox = $('#clientCare');
  if (careBox) {
    $$('#clientCare [data-care]').forEach(function (b) {
      b.addEventListener('click', function () { setFilter(b.dataset.care); });
    });
  }

  /* Переключатель ЧС и причина: причина видна только при включённом тумблере. */
  var blSwitch = $('#clBl');
  if (blSwitch) {
    blSwitch.addEventListener('click', function () {
      blSwitch.setAttribute('aria-checked', blOn() ? 'false' : 'true');
      syncBl();
    });
  }

  var clRemind = $('#clRemind');
  if (clRemind) {
    clRemind.addEventListener('click', function () {
      var client = cardId ? findById(cardId) : null;
      if (client && MZ.care && typeof MZ.care.openRemind === 'function') MZ.care.openRemind(client);
    });
  }

  var formClient = $('#formClient');
  if (formClient) formClient.addEventListener('submit', saveCard);
  var clDelete = $('#clDelete');
  if (clDelete) clDelete.addEventListener('click', deleteClient);
  var clNewRecord = $('#clNewRecord');
  if (clNewRecord) clNewRecord.addEventListener('click', function () {
    var client = cardId ? findById(cardId) : null;
    if (client) newRecordFor(client);
  });
  var clCancel = $('#clCancel');
  if (clCancel) clCancel.addEventListener('click', closeCard);
  $$('[data-close="client"]').forEach(function (el) {
    el.addEventListener('click', closeCard);
  });

  var fClient = $('#fClient');
  if (fClient) {
    fClient.addEventListener('input', function () {
      metaPicked = null;
      renderHints();
    });
    fClient.addEventListener('focus', renderHints);
  }

  /* Клиент с таким же номером: сравниваем последние 10 цифр, чтобы «8…» и «+7…»
     считались одним человеком. */
  function byPhone(value) {
    var d = digitsOf(value);
    if (d.length < 10) return null;
    var tail = d.slice(-10);
    var found = null;
    clients().forEach(function (c) {
      if (found) return;
      var cd = digitsOf(c.phone);
      if (cd.length >= 10 && cd.slice(-10) === tail) found = c;
    });
    return found;
  }

  /* Телефон из контакта или из рукописи приводим к «+7 XXX XXX-XX-XX» при уходе из
     поля: iOS подставляет номер как записан в карточке, а «8…» и «…без +7» надо
     уравнять. Имя телефонной книги странице недоступно, но если номер уже есть среди
     клиентов — подставляем имя в пустое поле. */
  function bindPhone(phoneEl, nameEl) {
    if (!phoneEl) return;
    function tidy() {
      var v = normPhone(phoneEl.value);
      if (v && v !== phoneEl.value) {
        phoneEl.value = v;
        fireInput(phoneEl);
      }
      if (nameEl && !asName(nameEl.value)) {
        var known = byPhone(v);
        if (known && known.name) {
          nameEl.value = known.name;
          fireInput(nameEl);
        }
      }
    }
    phoneEl.addEventListener('blur', tidy);
    phoneEl.addEventListener('change', tidy);
  }
  bindPhone($('#fPhone'), $('#fClient'));
  bindPhone($('#clPhone'), $('#clName'));

  /* Кнопка «+»: на «Клиентах» открываем карточку нового клиента. На «Записях» шит
     записи уже открыл js/app.js (его обработчик зарегистрирован раньше), а на
     «Отчёте» и «Ещё» кнопка скрыта и недоступна. */
  if (fab) {
    fab.addEventListener('click', function () {
      if (activeTab() === 'clients') openCard(null);
    });
  }

  $$('.tab').forEach(function (b) {
    b.addEventListener('click', function () {
      syncFab();
      hideHints();
      showMeta(null);
    });
  });

  /* Переключение на «Клиенты» перерисовывает список: новый клиент мог появиться из
     формы записи, пока экран был скрыт (js/app.js, saveForm). */
  $$('.tab[data-tab="clients"]').forEach(function (b) {
    b.addEventListener('click', function () { renderClients(); });
  });

  if (document.body && document.body.addEventListener) {
    /* Тап мимо подсказок их убирает: список не висит поверх формы. */
    document.body.addEventListener('click', function (e) {
      var t = e && e.target;
      var inside = !!(t && t.closest && (t.closest('#fClientWrap') || t.closest('#fClientHints')));
      if (!inside) {
        hideHints();
        if (!metaPicked) showMeta(null);
      }
    });
    document.body.addEventListener('keydown', function (e) {
      if (e && e.key === 'Escape') hideHints();
    });
  }

  /* ---------- старт и API для следующих шагов ---------- */

  syncFab();
  paintSort();
  paintCare();
  buildBd();
  setBl(null);
  renderClients();

  MZ.clientsScreen = {
    render: renderClients,
    open: openCard,
    close: closeCard,
    save: saveCard,
    remove: deleteClient,
    newRecordFor: newRecordFor,
    renderHints: renderHints,
    hideHints: hideHints,
    matches: matches,
    buildRows: buildRows,
    clientRecords: clientRecords,
    normPhone: normPhone,
    sortMode: function () { return sortMode; },
    refreshFab: syncFab,
    /* Шаг 7: спящие и дни рождения. Логика одна на два файла — js/care.js берёт
       проверки отсюда, чтобы правила «спящего» и дат не разъехались. */
    filter: function () { return listFilter; },
    setFilter: setFilter,
    sleepingDays: sleepingDays,
    sleepInfo: sleepInfo,
    daysSince: daysSince,
    parseBd: parseBd,
    bdWithin: bdWithin,
    bdText: bdText,
    inDays: inDays,
    bdAhead: function () { return BD_AHEAD; },
    digits: digitsOf,
    findById: findById,
    byPhone: byPhone
  };
})();
