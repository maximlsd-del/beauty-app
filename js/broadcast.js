/* broadcast.js — экран «Рассылка»: очередь сообщений по одному получателю.
 *
 * ЧЕСТНОЕ ОГРАНИЧЕНИЕ, на котором держится весь экран: сервера и бота нет, поэтому
 * массовой автоматической отправки не бывает. Мастер выбирает получателей, пишет текст,
 * а дальше идёт по очереди: на каждого человека — один тап «WhatsApp / Telegram / SMS»,
 * и сообщение открывается в её мессенджере. Отсюда и текст предупреждения на экране:
 * «по одному», а не «всем сразу».
 *
 * Что делает файл:
 *   - группы-чипы: «Спящие», «День рождения в этом месяце», «Все клиенты», «Без визитов»;
 *   - список получателей с галочками (любую можно снять) и счётчик «Выбрано: N»;
 *   - текст с подстановкой %имя% и три заготовки: напоминание, приглашение, поздравление;
 *   - очередь: карточка текущего получателя (имя, телефон, текст с подставленным именем),
 *     кнопки мессенджеров, «Скопировать текст», «Пропустить», «Завершить», прогресс
 *     «3 из 12» и итог: скольким отправила и кого пропустила;
 *   - «Отправила» ставит клиенту broadcastAt — локальную дату ГГГГ-ММ-ДД. По ней
 *     js/clients.js показывает в списке метку «писали N дн. назад».
 *
 * Правила контракта (beauty-pwa-ПЛАН.md):
 *   - даты только локальные: toISOString() не используется нигде;
 *   - никаких данных в inline-onclick: addEventListener, data-id, esc()/textContent;
 *   - ссылки и нормализация телефона берутся из js/care.js — второй копии правил нет;
 *   - ни одной внешней библиотеки: только схемы ссылок и буфер обмена.
 *
 * Клиент — контракт v2: {id, name, phone, birthday, note, blacklist, blacklistReason,
 * remindedAt, broadcastAt}. Подключается последним, после js/remind.js.
 */
(function () {
  'use strict';

  var MZ = window.MZ;
  if (!MZ || !MZ.store) return;

  /* Проверки «спящего», день рождения и визиты живут в js/clients.js. */
  var CS = MZ.clientsScreen;
  if (!CS) return;

  var $ = function (sel) { return document.querySelector(sel); };
  var $$ = function (sel) { return Array.prototype.slice.call(document.querySelectorAll(sel)); };

  var MSG = { whatsapp: 'WhatsApp', telegram: 'Telegram', sms: 'SMS' };

  /* ---------- состояние и мелкие помощники ---------- */

  function state() { return MZ.state || MZ.store.load(); }

  function clients() {
    var s = state();
    if (!Array.isArray(s.clients)) s.clients = [];
    return s.clients;
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

  function setText(sel, text) {
    var el = $(sel);
    if (el) el.textContent = text === null || text === undefined ? '' : String(text);
  }

  function toast(message) {
    if (typeof MZ.toast === 'function') MZ.toast(message);
  }

  /* ---------- заготовки текста ---------- */

  /* %имя% — единственная подстановка: её видно в подсказке под полем. */
  var NAME_TOKEN = '%имя%';

  var TEMPLATES = {
    remind: 'Здравствуйте, ' + NAME_TOKEN + '! Давно вас не было — хотите записаться? ' +
      'Подскажите удобный день, подберу время.',
    invite: 'Здравствуйте, ' + NAME_TOKEN + '! Открыла запись на этой неделе. ' +
      'Напишите, какой день и время вам удобны — подберу окошко.',
    greet: 'Здравствуйте, ' + NAME_TOKEN + '! Поздравляю вас с днём рождения! ' +
      'Желаю здоровья, тепла и хорошего настроения. Буду рада видеть вас снова.'
  };

  function textFor(name) {
    var el = $('#bcastText');
    var base = el ? String(el.value || '') : '';
    var who = asName(name) || 'клиент';
    return base.split(NAME_TOKEN).join(who);
  }

  /* ---------- группы получателей ---------- */

  var GROUP = 'all';                   /* 'all' | 'sleep' | 'birthday' | 'none' */
  var selected = {};                   /* id -> true; снятая галочка = false */

  function allRows() {
    var rows = typeof CS.buildRows === 'function' ? CS.buildRows() : [];
    return rows.slice().sort(function (a, b) {
      return String(a.c.name || '').localeCompare(String(b.c.name || ''), 'ru');
    });
  }

  function bdMonth(client) {
    var bd = typeof CS.parseBd === 'function' ? CS.parseBd(client.birthday) : null;
    return bd ? Number(bd.slice(0, 2)) : 0;
  }

  /* День рождения «в этом месяце» — сравнение по месяцу, год в контракте не хранится. */
  function groupRows(group) {
    var rows = allRows();
    var month = new Date().getMonth() + 1;
    if (group === 'sleep') {
      return rows.filter(function (row) { return CS.sleepInfo(row).sleeping; });
    }
    if (group === 'birthday') {
      return rows.filter(function (row) { return bdMonth(row.c) === month; });
    }
    if (group === 'none') {
      return rows.filter(function (row) { return !row.count; });
    }
    return rows;
  }

  function selectedIds() {
    return clients()
      .filter(function (c) { return selected[String(c.id)] === true; })
      .map(function (c) { return String(c.id); });
  }

  function rowSub(row) {
    var c = row.c;
    var visits = Number(row.count) || 0;
    return (c.phone || 'телефон не указан') + ' · ' +
      (visits ? visits + ' ' + plural(visits, 'визит', 'визита', 'визитов') : 'визитов нет');
  }

  /* Строка списка — <label> с галочкой: тап по всей строке (≥ 44 px) включает и снимает
     выбор. Имя и телефон проходят через esc(), id — только значением data-id. */
  function rowHTML(row) {
    var c = row.c;
    return '<label class="bcast-row">' +
      '<input type="checkbox" data-id="' + esc(c.id) + '"' +
      (selected[String(c.id)] === true ? ' checked' : '') + '>' +
      '<span class="bcast-info"><span class="bcast-nm">' + esc(c.name || 'Без имени') + '</span>' +
      '<span class="bcast-sub">' + esc(rowSub(row)) + '</span></span></label>';
  }

  function paintGroups() {
    $$('#bcastGroups [data-group]').forEach(function (b) {
      var on = b.dataset.group === GROUP;
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }

  function renderCount() {
    var ids = selectedIds();
    setText('#bcastCount', String(ids.length));
    var start = $('#bcastStart');
    if (start) start.disabled = !ids.length;
  }

  function renderList() {
    var box = $('#bcastList');
    if (!box) return;

    var rows = groupRows(GROUP);
    box.innerHTML = rows.map(rowHTML).join('');

    $$('#bcastList [data-id]').forEach(function (input) {
      input.addEventListener('change', function () {
        var id = String(input.dataset.id);
        selected[id] = !!input.checked;
        renderCount();
      });
    });

    var empty = $('#bcastEmpty');
    if (empty) {
      if (!clients().length) {
        empty.hidden = false;
        empty.textContent = 'Клиентов пока нет: сначала добавьте их на экране «Клиенты».';
      } else if (!rows.length) {
        empty.hidden = false;
        empty.textContent = GROUP === 'sleep'
          ? 'Спящих клиентов нет: все были в салоне недавно.'
          : (GROUP === 'birthday'
            ? 'В этом месяце дней рождения нет.'
            : (GROUP === 'none' ? 'Клиентов без визитов нет.' : 'Никого не найдено.'));
      } else {
        empty.hidden = true;
        empty.textContent = '';
      }
    }

    var hint = $('#bcastGroupHint');
    if (hint) {
      hint.textContent = rows.length
        ? 'в группе ' + rows.length + ' ' + plural(rows.length, 'человек', 'человека', 'человек')
        : '';
    }

    renderCount();
  }

  /* Смена группы пересобирает выбор: в новой группе отмечены все её участники,
     дальше любую галочку можно снять. */
  function setGroup(group) {
    GROUP = ['sleep', 'birthday', 'none', 'all'].indexOf(group) === -1 ? 'all' : group;
    selected = {};
    groupRows(GROUP).forEach(function (row) { selected[String(row.c.id)] = true; });
    paintGroups();
    renderList();
  }

  /* ---------- буфер обмена (запас за Clipboard API стоит того: iOS иногда отказывает) ---------- */

  function copyText(text, done) {
    var body = String(text === null || text === undefined ? '' : text);
    var finish = typeof done === 'function' ? done : function () {};

    function fallback() {
      try {
        if (typeof document.createElement !== 'function' || !document.body) return false;
        var area = document.createElement('textarea');
        area.value = body;
        document.body.appendChild(area);
        if (typeof area.select === 'function') area.select();
        var ok = typeof document.execCommand === 'function' ? !!document.execCommand('copy') : false;
        document.body.removeChild(area);
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

  /* ---------- очередь отправки ---------- */

  /* queue: {ids: [...], index: 0, sent: [...], skipped: [...]} — порядок как в списке. */
  var queue = null;

  function currentItem() {
    if (!queue) return null;
    var id = queue.ids[queue.index];
    if (id === undefined) return null;
    for (var i = 0; i < clients().length; i++) {
      if (String(clients()[i].id) === String(id)) return clients()[i];
    }
    return null;
  }

  function showHint(text) {
    var el = $('#bcastHint');
    if (!el) return;
    if (!text) { el.hidden = true; el.textContent = ''; return; }
    el.textContent = text;
    el.hidden = false;
  }

  function paintQueue() {
    var setup = $('#bcastSetup');
    var card = $('#bcastQueue');
    var done = $('#bcastDone');
    if (setup) setup.hidden = !!queue;
    if (card) card.hidden = !queue;
    if (done) done.hidden = true;
    if (!queue) return;

    var total = queue.ids.length;
    var num = Math.min(queue.index + 1, total);
    setText('#bcastProgress', num + ' из ' + total);

    var bar = $('#bcastBar');
    if (bar) bar.style.width = Math.round((queue.index / Math.max(total, 1)) * 100) + '%';

    var client = currentItem();
    if (!client) return;

    setText('#bcastName', client.name || 'Без имени');
    setText('#bcastPhone', asName(client.phone) || 'телефон не указан');
    setText('#bcastPreview', textFor(client.name));

    var digits = typeof MZ.care === 'object' && MZ.care && typeof MZ.care.phoneDigits === 'function'
      ? MZ.care.phoneDigits(client.phone) : '';
    ['#bcastWhatsapp', '#bcastTelegram', '#bcastSms'].forEach(function (sel) {
      var b = $(sel);
      if (b) b.disabled = !digits;
    });
    showHint(digits ? '' : 'Телефона нет — скопируйте текст и отправьте вручную.');
  }

  /* Старт: выбранные получатели выстраиваются в очередь. Никакой «пакетной» отправки —
     дальше на каждого человека свой тап. */
  function startQueue() {
    var ids = selectedIds();
    if (!ids.length) { toast('Сначала выберите хотя бы одного получателя.'); return; }
    if (!asName($('#bcastText') ? $('#bcastText').value : '')) {
      toast('Впишите текст сообщения или выберите заготовку.');
      return;
    }
    queue = { ids: ids, index: 0, sent: [], skipped: [] };
    showHint('');
    paintQueue();
  }

  /* «Отправила»: дата ставится клиенту, очередь идёт дальше. Отметка появляется
     сразу после тапа — подтверждения от мессенджера без сервера не получить. */
  function markSent(client) {
    if (!client) return;
    client.broadcastAt = isoToday();
    MZ.store.save(state());
    queue.sent.push(String(client.id));
  }

  function advance() {
    if (!queue) return;
    queue.index += 1;
    if (queue.index >= queue.ids.length) { finish(); return; }
    showHint('');
    paintQueue();
  }

  /* Мессенджер только ОТКРЫВАЕТСЯ: подтверждения об отправке без сервера не получить,
     поэтому «отправлено» мастер отмечает сама кнопкой «Отправила». Иначе приложение
     врало бы про доставку, которой не видит. */
  function sendIn(kind) {
    if (!queue) return;
    var client = currentItem();
    if (!client) { finish(); return; }

    var links = MZ.care && typeof MZ.care.links === 'function' ? MZ.care.links : null;
    var url = links ? links(kind, client.phone) : '';
    if (!url) {
      showHint('У клиента нет телефона — скопируйте текст и отправьте вручную.');
      return;
    }

    try {
      if (typeof window.open === 'function') window.open(url, '_blank');
    } catch (e) { /* ссылку открыть не удалось — текст всё равно можно скопировать */ }

    showHint(MSG[kind] + ' открыт: отправьте текст и нажмите «Отправила».');
  }

  /* «Отправила» — единственное действие, которое ставит дату: без него клиент
     остаётся неотмеченным, и метка «писали N дн. назад» не появится. */
  function confirmSent() {
    if (!queue) return;
    var client = currentItem();
    if (!client) { finish(); return; }
    markSent(client);
    toast('Отмечено: написали — ' + (asName(client.name) || 'клиенту') + '.');
    advance();
  }

  function copyCurrent() {
    if (!queue) return;
    var client = currentItem();
    if (!client) return;
    copyText(textFor(client.name), function (ok) {
      showHint(ok
        ? 'Текст скопирован — вставьте его в мессенджер и поправьте, если нужно.'
        : 'Скопировать не получилось: выделите текст и скопируйте вручную.');
    });
  }

  function skip() {
    if (!queue) return;
    var client = currentItem();
    if (client) queue.skipped.push(String(client.id));
    advance();
  }

  /* Итог: сколько отправила и кого пропустила. Остаток при досрочном «Завершить»
     назван отдельно — это честнее, чем молча записать всех в «отправленные». */
  function finish() {
    var sentNames = [];
    var skippedNames = [];
    var leftNames = [];

    if (queue) {
      queue.ids.forEach(function (id, i) {
        var client = null;
        for (var k = 0; k < clients().length; k++) {
          if (String(clients()[k].id) === String(id)) { client = clients()[k]; break; }
        }
        var name = client ? (client.name || 'Без имени') : 'Клиент удалён';
        if (queue.sent.indexOf(String(id)) !== -1) sentNames.push(name);
        else if (queue.skipped.indexOf(String(id)) !== -1) skippedNames.push(name);
        else if (i >= queue.index) leftNames.push(name);
      });
    }

    var sent = sentNames.length;
    var skipped = skippedNames.length;

    setText('#bcastSentCount', sent + ' ' + plural(sent, 'человек', 'человека', 'человек'));
    setText('#bcastSkippedCount', skipped + ' ' + plural(skipped, 'человек', 'человека', 'человек'));

    var skippedEl = $('#bcastSkippedNames');
    if (skippedEl) {
      skippedEl.textContent = skippedNames.length ? 'Пропущены: ' + skippedNames.join(', ') : '';
      skippedEl.hidden = !skippedNames.length;
    }

    var leftEl = $('#bcastLeftNames');
    if (leftEl) {
      leftEl.textContent = leftNames.length
        ? 'Осталось без сообщения: ' + leftNames.length + ' — ' + leftNames.join(', ')
        : '';
      leftEl.hidden = !leftNames.length;
    }

    var setup = $('#bcastSetup');
    var card = $('#bcastQueue');
    var done = $('#bcastDone');
    if (setup) setup.hidden = true;
    if (card) card.hidden = true;
    if (done) done.hidden = false;

    queue = null;
    /* Список клиентов перерисовываем один раз в конце: метки «писали N дн. назад»
       появляются без мигания списка на каждом получателе. */
    if (typeof CS.render === 'function') CS.render();
  }

  function reset() {
    queue = null;
    showHint('');
    var done = $('#bcastDone');
    if (done) done.hidden = true;
    var setup = $('#bcastSetup');
    if (setup) setup.hidden = false;
    setGroup(GROUP);
  }

  /* ---------- обработчики ---------- */

  $$('#bcastGroups [data-group]').forEach(function (b) {
    b.addEventListener('click', function () { setGroup(b.dataset.group); });
  });

  $$('#bcastTemplates [data-tpl]').forEach(function (b) {
    b.addEventListener('click', function () {
      var text = TEMPLATES[b.dataset.tpl];
      if (!text) return;
      var area = $('#bcastText');
      if (area) area.value = text;
      $$('#bcastTemplates [data-tpl]').forEach(function (x) {
        x.classList.toggle('is-on', x === b);
      });
    });
  });

  var start = $('#bcastStart');
  if (start) start.addEventListener('click', startQueue);

  [['#bcastWhatsapp', 'whatsapp'], ['#bcastTelegram', 'telegram'], ['#bcastSms', 'sms']]
    .forEach(function (pair) {
      var b = $(pair[0]);
      if (b) b.addEventListener('click', function () { sendIn(pair[1]); });
    });

  var copyBtn = $('#bcastCopy');
  if (copyBtn) copyBtn.addEventListener('click', copyCurrent);

  var sentBtn = $('#bcastSent');
  if (sentBtn) sentBtn.addEventListener('click', confirmSent);

  var skipBtn = $('#bcastSkip');
  if (skipBtn) skipBtn.addEventListener('click', skip);

  var stopBtn = $('#bcastStop');
  if (stopBtn) stopBtn.addEventListener('click', finish);

  var againBtn = $('#bcastAgain');
  if (againBtn) againBtn.addEventListener('click', reset);

  var backBtn = $('#bcastBack');
  if (backBtn) backBtn.addEventListener('click', function () {
    if (typeof MZ.go === 'function') MZ.go('more');
  });

  var enterBtn = $('#btnBroadcast');
  if (enterBtn) enterBtn.addEventListener('click', function () {
    reset();
    if (typeof MZ.go === 'function') MZ.go('broadcast');
  });

  /* ---------- старт и API для следующих шагов ---------- */

  paintGroups();

  MZ.broadcast = {
    group: function () { return GROUP; },
    setGroup: setGroup,
    rows: function () { return groupRows(GROUP); },
    selected: selectedIds,
    textFor: textFor,
    templates: function () { return TEMPLATES; },
    start: startQueue,
    finish: finish,
    reset: reset,
    queue: function () { return queue; },
    current: currentItem,
    send: sendIn,
    sent: confirmSent,
    skip: skip
  };
})();
