/* care.js — забота о клиентах (шаг 7): чёрный список, спящие, дни рождения.
 * Подключается после js/clients.js и берёт из него проверки «спящего» клиента и дат
 * (MZ.clientsScreen), чтобы правила не разъехались между файлами.
 *
 * Что делает файл:
 *   - предупреждение в форме записи, если выбранный клиент в чёрном списке: причина
 *     видна сразу, но СОХРАНЕНИЕ НЕ БЛОКИРУЕТСЯ — мастер решает сама. Предупреждение
 *     появляется и при выборе клиента из подсказок, и при открытии существующей записи;
 *   - лист напоминания и поздравления: WhatsApp, Telegram, SMS и «Скопировать текст».
 *     Текст готов заранее и нейтрален, мастер может его поправить. Ссылки строятся из
 *     телефона, приведённого к цифрам; если ссылку открыть нельзя, копирование всё равно
 *     работает. После «Напомнила» у клиента проставляется remindedAt (локальная дата
 *     ГГГГ-ММ-ДД), и он уходит из списка спящих на settings.sleepingDays дней;
 *     ЭТОТ ЖЕ лист переиспользует шаг 8 (js/remind.js) для напоминания о записи —
 *     в этом случае remindedAt ставится записи, а не клиенту, и второго листа не появляется;
 *   - блок «Скоро день рождения»: сегодня и в ближайшие 7 дней, с кнопкой «Поздравить».
 *
 * Правила контракта (beauty-pwa-ПЛАН.md):
 *   - даты только локальные: toISOString() и Date.parse по ISO здесь не используются,
 *     день рождения сравнивается строками «ММ-ДД»;
 *   - никаких данных в inline-onclick: только addEventListener, data-id и textContent;
 *   - ни одного внешнего файла и ни одной библиотеки: только схемы ссылок и буфер обмена.
 */
(function () {
  'use strict';

  var MZ = window.MZ;
  if (!MZ || !MZ.store) return;

  /* Проверки «спящего» и работы с днём рождения живут в js/clients.js. */
  var CS = MZ.clientsScreen;
  if (!CS) return;

  var $ = function (sel) { return document.querySelector(sel); };
  var $$ = function (sel) { return Array.prototype.slice.call(document.querySelectorAll(sel)); };

  var MSG = { whatsapp: 'WhatsApp', telegram: 'Telegram', sms: 'SMS' };

  /* ---------- состояние и мелкие помощники ---------- */

  /* MZ.state — живой объект состояния из js/app.js; store.load() нужен только если
     care.js подключён без него (например, в отдельной проверке). */
  function state() { return MZ.state || MZ.store.load(); }

  function asName(value) {
    return String(value === null || value === undefined ? '' : value).replace(/\s+/g, ' ').trim();
  }

  function esc(value) {
    if (typeof MZ.esc === 'function') return MZ.esc(value);
    return String(value === null || value === undefined ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
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
  function isoToday() {
    if (typeof MZ.isoLocal === 'function') return MZ.isoLocal(new Date());
    var d = new Date();
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }

  function plural(n, one, few, many) {
    var abs = Math.abs(Number(n) || 0) % 100;
    var last = abs % 10;
    if (abs >= 11 && abs <= 14) return many;
    if (last === 1) return one;
    if (last >= 2 && last <= 4) return few;
    return many;
  }

  /* ---------- телефон и ссылки ---------- */

  /* Телефон → только цифры. Восьмёрка в начале приводится к семёрке, десятизначный
     номер с девятки получает код страны — так «+7 912 345-67-89» и «89123456789»
     дают один и тот же номер и одну и ту же ссылку. */
  function phoneDigits(phone) {
    var d = String(phone === null || phone === undefined ? '' : phone).replace(/\D/g, '');
    if (d.length === 11 && d.charAt(0) === '8') d = '7' + d.slice(1);
    if (d.length === 10 && d.charAt(0) === '9') d = '7' + d;
    return d;
  }

  function linkFor(kind, phone, text) {
    var d = phoneDigits(phone);
    if (!d) return '';
    var body = encodeURIComponent(String(text === null || text === undefined ? '' : text));
    /* Telegram по номеру текст не принимает вовсе — там только открываем чат,
       а текст кладём в буфер обмена (см. sendIn). */
    if (kind === 'telegram') return 'https://t.me/+' + d;
    /* SMS: iOS понимает «&body=», Android — «?body=»; «?&body=» работает и там, и там. */
    if (kind === 'sms') return 'sms:' + d + '?&body=' + body;
    return 'https://wa.me/' + d + (body ? '?text=' + body : '');
  }

  /* Открыть ссылку. Возвращает false, если приложение ссылку открыть не смогло:
     в этом случае мастер всё равно скопирует текст и отправит его вручную. */
  function openLink(url) {
    if (!url) return false;
    try {
      if (typeof window !== 'undefined' && typeof window.open === 'function') {
        window.open(url, '_blank');
        return true;
      }
    } catch (e) { /* ссылку открыть не удалось — не беда */ }
    return false;
  }

  /* ---------- тексты ---------- */

  function remindText(name) {
    return 'Здравствуйте, ' + (asName(name) || 'клиент') +
      '! Давно вас не было — хотите записаться?';
  }

  function greetText(name) {
    return 'Здравствуйте, ' + (asName(name) || 'клиент') +
      '! Поздравляю вас с днём рождения! Желаю здоровья, тепла и хорошего настроения. ' +
      'Буду рада видеть вас снова.';
  }

  /* ---------- буфер обмена ---------- */

  /* Копирование работает и там, где Clipboard API нет или он отказал:
     сначала navigator.clipboard, затем скрытая textarea + execCommand. */
  function copyText(text, done) {
    var body = String(text === null || text === undefined ? '' : text);
    var finish = typeof done === 'function' ? done : function () {};

    function fallback() {
      try {
        if (typeof document.createElement !== 'function' || !document.body ||
            typeof document.body.appendChild !== 'function') return false;
        var area = document.createElement('textarea');
        area.value = body;
        document.body.appendChild(area);
        if (typeof area.select === 'function') area.select();
        var ok = typeof document.execCommand === 'function' ? !!document.execCommand('copy') : false;
        if (typeof document.body.removeChild === 'function') document.body.removeChild(area);
        return ok;
      } catch (e) {
        return false;
      }
    }

    try {
      var nav = typeof navigator !== 'undefined' ? navigator : null;
      if (nav && nav.clipboard && typeof nav.clipboard.writeText === 'function') {
        var result = nav.clipboard.writeText(body);
        if (result && typeof result.then === 'function') {
          result.then(function () { finish(true); }, function () { finish(fallback()); });
          return;
        }
        finish(true);
        return;
      }
    } catch (e) { /* ниже — запасной путь через execCommand */ }
    finish(fallback());
  }

  /* ---------- лист напоминания и поздравления ---------- */

  var msgCtx = null;

  function showHint(text) {
    var el = $('#msgHint');
    if (!el) return;
    if (!text) { el.hidden = true; el.textContent = ''; return; }
    el.textContent = text;
    el.hidden = false;
  }

  function openMsg(title, text, ctx) {
    var sheet = $('#sheetMsg');
    if (!sheet) return;
    msgCtx = {
      kind: ctx && ctx.kind ? ctx.kind : 'remind',
      client: ctx ? ctx.client : null,
      /* Запись (шаг 8): «Напомнила» ставит remindedAt самой записи, а не только клиенту.
         Лист один на всех — второго листа сообщения в приложении нет. */
      record: ctx && ctx.record ? ctx.record : null,
      phone: ctx ? ctx.phone : '',
      text: text
    };

    var digits = phoneDigits(msgCtx.phone);
    setText('#msgTitle', title);
    setMsgText(text);
    setText('#msgWho', (msgCtx.client && msgCtx.client.name ? msgCtx.client.name : 'Клиент') +
      ' · ' + (asName(msgCtx.phone) || 'телефон не указан'));

    var done = $('#msgDone');
    if (done) done.hidden = msgCtx.kind !== 'remind';
    showHint(digits ? '' : 'Телефон не указан — скопируйте текст и отправьте вручную.');

    ['#msgWhatsapp', '#msgTelegram', '#msgSms'].forEach(function (sel) {
      var b = $(sel);
      if (b) b.disabled = !digits;
    });

    sheet.hidden = false;
  }

  /* Текст сообщения — поле ввода: мастер может дописать что угодно перед отправкой. */
  function setMsgText(text) {
    var el = $('#msgText');
    if (!el) return;
    var body = text === null || text === undefined ? '' : String(text);
    if (typeof el.value === 'string') { el.value = body; return; }
    el.textContent = body;
  }

  function currentText() {
    var el = $('#msgText');
    if (!el) return msgCtx ? msgCtx.text : '';
    if (typeof el.value === 'string') return el.value;
    return String(el.textContent === null || el.textContent === undefined ? '' : el.textContent);
  }

  function closeMsg() {
    var sheet = $('#sheetMsg');
    if (sheet) sheet.hidden = true;
    msgCtx = null;
  }

  function openRemind(client) {
    if (!client) return;
    openMsg('Напомнить клиенту', remindText(client.name),
      { kind: 'remind', client: client, phone: client.phone });
  }

  function openGreet(client) {
    if (!client) return;
    openMsg('Поздравить с днём рождения', greetText(client.name),
      { kind: 'greet', client: client, phone: client.phone });
  }

  function sendIn(kind) {
    if (!msgCtx) return;
    var text = currentText();
    msgCtx.text = text;
    var url = linkFor(kind, msgCtx.phone, text);
    if (!url) {
      showHint('У клиента нет телефона — скопируйте текст и отправьте вручную.');
      return;
    }
    /* Telegram по номеру готовый текст не принимает: кладём его в буфер и открываем чат. */
    if (kind === 'telegram') {
      copyText(text, function () {});
      if (!openLink(url)) {
        showHint('Открыть Telegram не удалось — текст уже скопирован, вставьте его в чат.');
        return;
      }
      showHint('Telegram открыт: текст скопирован — вставьте его в чат и отправьте.');
      toast('Telegram: текст скопирован, вставьте в чат.');
      return;
    }
    if (!openLink(url)) {
      showHint('Открыть ' + MSG[kind] + ' не удалось — скопируйте текст и отправьте вручную.');
      return;
    }
    /* Подсказка остаётся на экране: если приложение ушло в мессенджер и вернулось,
       мастер видит, что текст уже подготовлен и его осталось отправить. */
    showHint(kind === 'sms'
      ? 'SMS открыто: текст уже вставлен — осталось отправить.'
      : MSG[kind] + ' открыт: текст уже вписан в сообщение — осталось отправить.');
    toast(MSG[kind] + ': текст готов, отправьте его клиенту.');
  }

  /* «Напомнила»: дата ставится локально, клиент уходит из списка спящих на
     settings.sleepingDays дней — правило живёт в js/clients.js (sleepInfo).
     Для напоминания о ЗАПИСИ (шаг 8) дата ставится самой записи: по ней в карточке
     появляется метка «напомнила», а «пора напомнить» снимается. */
  function markReminded() {
    var ctx = msgCtx;
    if (!ctx || ctx.kind !== 'remind') { closeMsg(); return; }

    if (ctx.record) {
      ctx.record.remindedAt = isoToday();
      MZ.store.save(state());
      closeMsg();
      /* Точка расширения js/remind.js: перерисовать карточки дня и сводку. */
      if (typeof MZ.onReminded === 'function') MZ.onReminded(ctx.record);
      toast('Отмечено: напомнили — ' + (asName(ctx.record.name) || 'клиенту'));
      return;
    }

    if (!ctx.client) { closeMsg(); return; }
    ctx.client.remindedAt = isoToday();
    MZ.store.save(state());
    closeMsg();
    if (typeof CS.render === 'function') CS.render();
    toast('Отмечено: напомнили — ' + (ctx.client.name || 'клиенту'));
  }

  function copyCurrent() {
    if (!msgCtx) return;
    var text = currentText();
    msgCtx.text = text;
    copyText(text, function (ok) {
      showHint(ok
        ? 'Текст скопирован — вставьте его в мессенджер и поправьте, если нужно.'
        : 'Скопировать не получилось: выделите текст и скопируйте вручную.');
    });
  }

  /* ---------- блок «Скоро день рождения» ---------- */

  function bdList() {
    var ahead = typeof CS.bdAhead === 'function' ? CS.bdAhead() : 7;
    var rows = typeof CS.buildRows === 'function' ? CS.buildRows() : [];
    var out = [];
    rows.forEach(function (row) {
      var info = CS.bdWithin(row.c.birthday, ahead);
      if (info) out.push({ c: row.c, info: info });
    });
    out.sort(function (a, b) {
      if (a.info.days !== b.info.days) return a.info.days - b.info.days;
      return String(a.c.name || '').localeCompare(String(b.c.name || ''), 'ru');
    });
    return out;
  }

  function renderBd() {
    var box = $('#clientBdCard');
    if (!box) return;

    var list = bdList();
    if (!list.length) {
      box.hidden = true;
      box.innerHTML = '';
      return;
    }

    var rows = list.map(function (item) {
      return '<div class="bd-row' + (item.info.days === 0 ? ' is-today' : '') +
        '" data-id="' + esc(item.c.id) + '">' +
        '<span class="bd-who"><span class="bd-nm">' + esc(item.c.name || 'Без имени') + '</span>' +
        '<span class="bd-when">' + esc(CS.inDays(item.info.days)) + ' · ' +
        esc(CS.bdText(item.info)) + '</span></span>' +
        '<button class="mini-btn" type="button" data-greet="' + esc(item.c.id) +
        '">Поздравить</button></div>';
    }).join('');

    box.innerHTML = '<div class="row-between"><h3 class="h3">Скоро день рождения</h3>' +
      '<span class="muted small">' + list.length + ' ' +
      plural(list.length, 'клиент', 'клиента', 'клиентов') + '</span></div>' + rows;
    box.hidden = false;

    $$('#clientBdCard [data-greet]').forEach(function (b) {
      b.addEventListener('click', function () {
        var client = typeof CS.findById === 'function' ? CS.findById(b.dataset.greet) : null;
        if (client) openGreet(client);
      });
    });
  }

  /* ---------- предупреждение о чёрном списке ---------- */

  /* Показывает причину ЧС для клиента, вписанного в поле «Клиент». Сохранение при этом
     не блокируется: никаких запретов и «всё равно продолжить» — мастер решает сама. */
  function syncBlackWarn() {
    var el = $('#fBlWarn');
    if (!el) return false;

    var sheet = $('#sheetNew');
    var name = asName(val('#fClient'));
    var client = name && typeof MZ.findClientByName === 'function' ? MZ.findClientByName(name) : null;
    var on = !!(client && client.blacklist) && (!sheet || sheet.hidden === false);

    if (!on) {
      el.hidden = true;
      el.textContent = '';
      return false;
    }

    var reason = asName(client.blacklistReason) || 'причина не указана';
    el.textContent = 'Клиент в чёрном списке: ' + reason + '. Запись сохранить можно — решайте сами.';
    el.hidden = false;
    return true;
  }

  /* Программные открытия шита записи (js/app.js и js/clients.js) тоже должны
     пересчитать предупреждение: подписка на клик ловит только тапы по карточкам. */
  function wrapSheet(name) {
    var base = MZ[name];
    if (typeof base !== 'function') return;
    MZ[name] = function () {
      var result = base.apply(this, arguments);
      syncBlackWarn();
      return result;
    };
  }

  /* ---------- обработчики ---------- */

  var msgButtons = [
    ['#msgWhatsapp', 'whatsapp'],
    ['#msgTelegram', 'telegram'],
    ['#msgSms', 'sms']
  ];
  msgButtons.forEach(function (pair) {
    var b = $(pair[0]);
    if (b) b.addEventListener('click', function () { sendIn(pair[1]); });
  });

  var copyBtn = $('#msgCopy');
  if (copyBtn) copyBtn.addEventListener('click', copyCurrent);
  var doneBtn = $('#msgDone');
  if (doneBtn) doneBtn.addEventListener('click', markReminded);
  var cancelBtn = $('#msgCancel');
  if (cancelBtn) cancelBtn.addEventListener('click', closeMsg);
  $$('[data-close="msg"]').forEach(function (el) {
    el.addEventListener('click', closeMsg);
  });

  var clientField = $('#fClient');
  if (clientField) clientField.addEventListener('input', syncBlackWarn);

  /* js/app.js закрывает шит своим внутренним closeSheet() — обёртка MZ.closeSheet
     этот путь не видит. Подписка на submit срабатывает ПОСЛЕ сохранения (обработчик
     app.js добавлен раньше), когда шит уже скрыт: предупреждение гаснет вместе с ним. */
  var formNew = $('#formNew');
  if (formNew) formNew.addEventListener('submit', function () { syncBlackWarn(); });

  if (document.body && document.body.addEventListener) {
    /* Тап по карточке записи и по кнопке «+» уже обработан в js/app.js, а здесь мы
       видим тот же клик последним: к этому моменту поле клиента заполнено. */
    document.body.addEventListener('click', function () { syncBlackWarn(); });
    document.body.addEventListener('keydown', function (e) {
      if (e && e.key === 'Escape') closeMsg();
    });
  }

  wrapSheet('openSheet');
  wrapSheet('openEdit');
  wrapSheet('closeSheet');

  /* Точка расширения js/clients.js: любая отрисовка списка обновляет блок ДР. */
  MZ.onClientsRendered = function () { renderBd(); };

  MZ.syncBlackWarn = syncBlackWarn;

  MZ.care = {
    openRemind: openRemind,
    openGreet: openGreet,
    links: linkFor,
    phoneDigits: phoneDigits,
    remindText: remindText,
    greetText: greetText,
    bdList: bdList,
    renderBd: renderBd,
    syncBlackWarn: syncBlackWarn,
    sheet: {
      open: openMsg,
      close: closeMsg,
      ctx: function () { return msgCtx; },
      /* Текущий (возможно, поправленный) текст поля — для проверок и тестов. */
      text: currentText,
      setText: setMsgText,
      linkFor: linkFor
    }
  };

  renderBd();
})();
