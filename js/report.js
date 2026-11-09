/* report.js — Фаза 2, шаг 6: экран «Расходы» и настоящий экран «Отчёт» (PWA «Мои Записи»).
 *
 * Что делает файл:
 *   - экран «Расходы» (#s-expenses, открывается из «Ещё» → карточка «Деньги» — путь макета
 *     макет/index.html #btnExpenses → #s-expenses, назад кнопкой «Ещё»): список расходов
 *     (дата, категория, сумма, комментарий), действия «Изменить» и «Удалить» по data-id,
 *     кнопка «Добавить расход», фильтр периода (текущий месяц по умолчанию), итог
 *     и разбивка по категориям, пустое состояние;
 *   - шит расхода #sheetExp (разметка из макета, макет/index.html #sheetExp): дата,
 *     категория чипами (приём скидки из формы записи — .chips + data-cat), сумма, комментарий;
 *   - экран «Отчёт» (#s-report): период неделя / месяц / свой (две даты), доход за период
 *     по записям, отдельно «начислено» (все записи) и «получено» (только paid: true) с явной
 *     строкой про долг, количество записей, средний чек, расходы за период с разбивкой
 *     по категориям, ПРИБЫЛЬ = доход − расходы (крупно; при убытке — знак минус и подпись),
 *     разбивка по услугам из svcName (топ по выручке) и пустое состояние.
 *
 * Расход — контракт v2 (beauty-pwa-ПЛАН.md): {id, date, category, amount, comment}.
 * Категории строго: rent (Аренда), utility (Коммуналка), materials (Материалы), other (Прочее).
 * Данные живут в state.expenses и читаются/пишутся ТОЛЬКО через MZ.store.
 *
 * Правила контракта:
 *   - даты только локальные, перевод дат в UTC не используется нигде и ни в каком виде;
 *   - границы периодов считаются по локальному календарю, неделя — с понедельника (как в журнале);
 *   - сравнение дат — строковое по YYYY-MM-DD: сутки не сдвигаются ни в 00:30, ни в 23:30;
 *   - никаких данных в inline-обработчиках: только addEventListener, data-id и esc()/textContent;
 *   - никакого absolute-позиционирования: списки и подсказки идут В ПОТОКЕ;
 *   - суммы округляются до целых рублей и печатаются через toLocaleString('ru-RU') (MZ.money).
 */
(function () {
  'use strict';

  var MZ = window.MZ;
  if (!MZ || !MZ.store) return;

  var $ = function (sel) { return document.querySelector(sel); };
  var $$ = function (sel) { return Array.prototype.slice.call(document.querySelectorAll(sel)); };

  var MON = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
    'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];

  /* ---------- состояние и мелкие помощники ---------- */

  function state() { return MZ.state || MZ.store.load(); }

  function expenseList() {
    var s = state();
    if (!Array.isArray(s.expenses)) s.expenses = [];
    return s.expenses;
  }

  function records() {
    var s = state();
    return Array.isArray(s.records) ? s.records : [];
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

  /* Суммы — целые рубли, формат русской локали (неразрывные пробелы в разрядах). */
  function money(value) {
    var n = Math.round(Number(value) || 0);
    if (typeof MZ.money === 'function') return MZ.money(n);
    return n.toLocaleString('ru-RU');
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

  function setText(sel, text) {
    var el = $(sel);
    if (el) el.textContent = String(text);
  }

  function plural(n, one, few, many) {
    var abs = Math.abs(Number(n) || 0) % 100;
    var last = abs % 10;
    if (abs > 10 && abs < 20) return many;
    if (last === 1) return one;
    if (last >= 2 && last <= 4) return few;
    return many;
  }

  /* ---------- локальные даты ---------- */

  var pad2 = function (n) { return n < 10 ? '0' + n : String(n); };

  /* Локальная метка YYYY-MM-DD. Перевод даты в UTC здесь запрещён: он сдвигает день. */
  function isoLocal(d) {
    if (typeof MZ.isoLocal === 'function') return MZ.isoLocal(d);
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }

  /* Полдень: перевод часов не перекидывает дату на соседний день. */
  function parseISO(s) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ''));
    if (!m) return null;
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0, 0);
  }

  function addDays(d, n) {
    var x = new Date(d.getTime());
    x.setDate(x.getDate() + n);
    return x;
  }

  function mondayOf(d) {
    if (typeof MZ.mondayOf === 'function') return MZ.mondayOf(d);
    return addDays(d, -((d.getDay() + 6) % 7));
  }

  function todayNoon() {
    var t = new Date();
    t.setHours(12, 0, 0, 0);
    return t;
  }

  function monthBounds(d) {
    return {
      from: isoLocal(new Date(d.getFullYear(), d.getMonth(), 1, 12, 0, 0, 0)),
      to: isoLocal(new Date(d.getFullYear(), d.getMonth() + 1, 0, 12, 0, 0, 0))
    };
  }

  function human(iso, withYear) {
    var d = parseISO(iso);
    if (!d) return String(iso || '');
    var text = d.getDate() + ' ' + MON[d.getMonth()];
    if (withYear || d.getFullYear() !== new Date().getFullYear()) text += ' ' + d.getFullYear();
    return text;
  }

  /* ---------- категории расходов (контракт) ---------- */

  var CATEGORIES = [
    { id: 'rent', name: 'Аренда', hint: '' },
    { id: 'utility', name: 'Коммуналка', hint: 'свет, вода, интернет' },
    { id: 'materials', name: 'Материалы', hint: '' },
    { id: 'other', name: 'Прочее', hint: 'если не входит в аренду' }
  ];

  function catById(id) {
    for (var i = 0; i < CATEGORIES.length; i++) {
      if (CATEGORIES[i].id === id) return CATEGORIES[i];
    }
    return null;
  }

  function catName(id) {
    var c = catById(id);
    return c ? c.name : 'Прочее';
  }

  /* ---------- выборки ---------- */

  function inRange(date, from, to) {
    var d = String(date || '');
    return d >= String(from === null || from === undefined ? '' : from) &&
      d <= String(to === null || to === undefined ? '' : to);
  }

  function recordsIn(from, to) {
    return records().filter(function (r) { return inRange(r.date, from, to); });
  }

  /* Доход за период. total — «начислено» (все записи), paid — «получено» (только paid: true),
     unpaid — долг мастера. Средний чек не делится на ноль. */
  function incomeOf(from, to) {
    var list = recordsIn(from, to);
    var total = 0, paid = 0, paidCount = 0;
    list.forEach(function (r) {
      var price = Math.round(Number(r.price) || 0);
      total += price;
      if (r.paid) { paid += price; paidCount += 1; }
    });
    return {
      count: list.length,
      paidCount: paidCount,
      unpaidCount: list.length - paidCount,
      total: total,
      paid: paid,
      unpaid: total - paid,
      avg: list.length ? Math.round(total / list.length) : 0,
      records: list
    };
  }

  function expensesIn(from, to) {
    return expenseList().filter(function (e) { return inRange(e.date, from, to); });
  }

  /* Разбивка по категориям: строки идут в порядке контракта и в сумме дают итог по списку. */
  function expenseCategoriesOf(from, to) {
    var rows = CATEGORIES.map(function (c) { return { id: c.id, name: c.name, sum: 0 }; });
    var byId = {};
    rows.forEach(function (r) { byId[r.id] = r; });
    expensesIn(from, to).forEach(function (e) {
      var row = byId[e.category] || byId.other;
      row.sum += Math.round(Number(e.amount) || 0);
    });
    return rows;
  }

  function expensesOf(from, to) {
    var rows = expenseCategoriesOf(from, to);
    var total = rows.reduce(function (acc, r) { return acc + r.sum; }, 0);
    return { total: total, byCategory: rows, list: expensesIn(from, to) };
  }

  function profitOf(from, to) {
    return incomeOf(from, to).total - expensesOf(from, to).total;
  }

  /* Разбивка по услугам: группируем по снимку названия svcName, сортируем по выручке. */
  function servicesOf(from, to) {
    var map = {}, order = [];
    recordsIn(from, to).forEach(function (r) {
      var name = asName(r.svcName) || 'Услуга не указана';
      var key = name.toLowerCase();
      if (!map[key]) {
        map[key] = { name: name, sum: 0, count: 0 };
        order.push(key);
      }
      map[key].sum += Math.round(Number(r.price) || 0);
      map[key].count += 1;
    });
    return order.map(function (key) { return map[key]; })
      .sort(function (a, b) { return b.sum - a.sum; });
  }

  /* ---------- периоды отчёта ---------- */

  var repMode = 'week';                 /* week | month | custom */
  var repCustom = { from: null, to: null };

  function reportRange() {
    var t = todayNoon();

    if (repMode === 'month') {
      var m = monthBounds(t);
      return {
        mode: 'month', from: m.from, to: m.to, label: 'Доход за месяц',
        text: 'Месяц: ' + human(m.from, true) + ' — ' + human(m.to, true)
      };
    }

    if (repMode === 'custom') {
      var first = new Date(t.getFullYear(), t.getMonth(), 1, 12, 0, 0, 0);
      var from = repCustom.from || isoLocal(first);
      var to = repCustom.to || isoLocal(t);
      if (from > to) { var swap = from; from = to; to = swap; }
      return {
        mode: 'custom', from: from, to: to, label: 'Доход за период',
        text: 'Период: ' + human(from, true) + ' — ' + human(to, true)
      };
    }

    var mon = mondayOf(t);
    var fromW = isoLocal(mon), toW = isoLocal(addDays(mon, 6));
    return {
      mode: 'week', from: fromW, to: toW, label: 'Доход за неделю',
      text: 'Неделя: ' + human(fromW, true) + ' — ' + human(toW, true)
    };
  }

  /* ---------- экран «Отчёт» ---------- */

  function metaText(inc) {
    if (!inc.count) return 'записей за период нет';
    return inc.paidCount + ' ' + plural(inc.paidCount, 'оплачено', 'оплачено', 'оплачено') +
      ' · ' + inc.unpaidCount + ' в ожидании';
  }

  function catRowHTML(row) {
    return '<div class="svc"><span>' + esc(row.name) + '</span><b>' +
      money(row.sum) + ' ' + esc(cur()) + '</b></div>';
  }

  function servicesHTML(list) {
    var top = list.slice(0, 5);
    if (!top.length) return '<p class="empty">За период записей нет</p>';
    var max = top[0].sum > 0 ? top[0].sum : 1;
    return top.map(function (row) {
      var width = Math.max(4, Math.round((row.sum / max) * 100));
      return '<div class="bar-row">' +
        '<div class="bar-top"><span>' + esc(row.name) + '</span><b>' + money(row.sum) +
        ' ' + esc(cur()) + '</b></div>' +
        '<div class="bar"><i data-w="' + width + '%"></i></div></div>';
    }).join('');
  }

  function renderReport() {
    var range = reportRange();
    var inc = incomeOf(range.from, range.to);
    var exp = expensesOf(range.from, range.to);
    var profit = inc.total - exp.total;

    setText('#repLabel', range.label);
    setText('#repRange', range.text);
    setText('#repTotal', money(inc.total));
    setText('#repMeta', metaText(inc));
    setText('#repAccrued', money(inc.total));
    setText('#repPaid', money(inc.paid));
    setText('#repVisits', String(inc.count));
    setText('#repAvg', money(inc.avg));
    setText('#repExp', money(exp.total) + ' ' + cur());

    var debt = $('#repDebt');
    if (debt) {
      if (inc.unpaid > 0) {
        debt.textContent = 'Не оплачено клиентами: ' + money(inc.unpaid) + ' ' + cur() +
          ' (' + inc.unpaidCount + ' ' +
          plural(inc.unpaidCount, 'запись', 'записи', 'записей') + ').';
        debt.hidden = false;
      } else {
        debt.textContent = '';
        debt.hidden = true;
      }
    }

    /* Прибыль: отрицательное значение — это минус и ПОДПИСЬ про убыток, а не только цвет. */
    var profitEl = $('#repProfit');
    if (profitEl) {
      profitEl.textContent = (profit < 0 ? '−' : '') + money(Math.abs(profit));
      profitEl.classList.toggle('neg', profit < 0);
    }
    var card = $('#repProfitCard');
    if (card) card.classList.toggle('is-loss', profit < 0);
    var note = $('#repProfitNote');
    if (note) {
      if (profit < 0) {
        note.textContent = 'Убыток: расходы больше дохода на ' + money(-profit) + ' ' + cur() + '.';
        note.classList.add('is-loss');
      } else {
        note.textContent = 'Прибыль = доход − расходы.';
        note.classList.remove('is-loss');
      }
    }

    var cats = $('#repExpCats');
    if (cats) cats.innerHTML = exp.byCategory.map(catRowHTML).join('');

    var top = $('#repTop');
    if (top) {
      top.innerHTML = servicesHTML(servicesOf(range.from, range.to));
      $$('#repTop .bar i').forEach(function (bar) {
        if (bar.dataset && bar.dataset.w) bar.style.width = bar.dataset.w;
      });
    }

    /* Пустой период: показываем пустое состояние, а не пустые карточки. */
    var empty = inc.count === 0 && exp.total === 0;
    var data = $('#repData');
    if (data) data.hidden = empty;
    var placeholder = $('#repEmpty');
    if (placeholder) placeholder.hidden = !empty;

    paintSegments('#repSeg', repMode);
    var custom = $('#repCustom');
    if (custom) custom.hidden = repMode !== 'custom';
    var fromEl = $('#repFrom'), toEl = $('#repTo');
    if (fromEl && repMode === 'custom' && !fromEl.value) fromEl.value = range.from;
    if (toEl && repMode === 'custom' && !toEl.value) toEl.value = range.to;

    return { range: range, income: inc, expenses: exp, profit: profit };
  }

  function paintSegments(sel, mode) {
    $$(sel + ' .seg').forEach(function (b) {
      var on = b.dataset.range === mode;
      b.classList.toggle('is-active', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }

  /* ---------- экран «Расходы» ---------- */

  var expMode = 'month';                /* month | prev | all */

  function expensesRange() {
    var t = todayNoon();
    if (expMode === 'all') {
      return {
        mode: 'all', from: '', to: '9999-12-31',
        label: 'Расходы за всё время', text: 'Показаны все расходы'
      };
    }
    var base = expMode === 'prev' ? new Date(t.getFullYear(), t.getMonth() - 1, 1, 12, 0, 0, 0) : t;
    var m = monthBounds(base);
    return {
      mode: expMode, from: m.from, to: m.to,
      label: expMode === 'prev' ? 'Расходы за прошлый месяц' : 'Расходы за текущий месяц',
      text: (expMode === 'prev' ? 'Прошлый месяц: ' : 'Текущий месяц: ') +
        human(m.from, true) + ' — ' + human(m.to, true)
    };
  }

  function findExpense(id) {
    var key = String(id);
    var list = expenseList();
    for (var i = 0; i < list.length; i++) {
      if (String(list[i].id) === key) return list[i];
    }
    return null;
  }

  /* Строка расхода: категория и комментарий слева, сумма справа, действия — второй строкой.
     Сетка с minmax(0,1fr) не даёт длинному комментарию распереть карточку. */
  function expenseRowHTML(e) {
    return '<div class="svc-row exp-row">' +
      '<span class="svc-info"><b>' + esc(catName(e.category)) + '</b>' +
      '<span class="muted">' + esc(human(e.date, true)) + ' · ' +
      esc(e.comment || 'без комментария') + '</span></span>' +
      '<b class="exp-sum">' + money(e.amount) + ' ' + esc(cur()) + '</b>' +
      '<span class="svc-acts">' +
      '<button class="mini-btn" type="button" data-act="edit" data-id="' + esc(e.id) + '">Изменить</button>' +
      '<button class="mini-btn is-danger" type="button" data-act="del" data-id="' + esc(e.id) + '">Удалить</button>' +
      '</span></div>';
  }

  function renderExpenses() {
    var range = expensesRange();
    var rows = expenseCategoriesOf(range.from, range.to);
    var total = rows.reduce(function (acc, r) { return acc + r.sum; }, 0);
    var list = expensesIn(range.from, range.to).slice().sort(function (a, b) {
      return String(b.date).localeCompare(String(a.date));
    });

    setText('#expLabel', range.label);
    setText('#expRange', range.text);
    setText('#expTotal', money(total));
    setText('#expMeta', list.length
      ? list.length + ' ' + plural(list.length, 'расход', 'расхода', 'расходов') + ' за период'
      : 'расходов нет');

    var cats = $('#expCats');
    if (cats) cats.innerHTML = rows.map(catRowHTML).join('');

    var box = $('#expList');
    if (box) {
      box.innerHTML = list.map(expenseRowHTML).join('');
      $$('#expList [data-act="edit"]').forEach(function (b) {
        b.addEventListener('click', function () { openExpSheet(b.dataset.id); });
      });
      $$('#expList [data-act="del"]').forEach(function (b) {
        b.addEventListener('click', function () { removeExpense(b.dataset.id); });
      });
    }

    var empty = $('#expEmpty');
    if (empty) {
      empty.hidden = list.length > 0;
      empty.textContent = 'За этот период расходов нет.';
    }

    paintSegments('#expSeg', expMode);
    return { range: range, total: total, byCategory: rows, list: list };
  }

  /* ---------- шит расхода ---------- */

  var editExpenseId = null;
  var expCategory = 'rent';

  function showExpErr(text) {
    var el = $('#eErr');
    if (!el) return;
    if (text) { el.textContent = text; el.hidden = false; }
    else { el.textContent = ''; el.hidden = true; }
  }

  function renderCatChips() {
    var box = $('#eCats');
    if (!box) return;
    box.innerHTML = CATEGORIES.map(function (c) {
      return '<button type="button" class="chip' + (expCategory === c.id ? ' is-on' : '') +
        '" data-cat="' + esc(c.id) + '" aria-pressed="' +
        (expCategory === c.id ? 'true' : 'false') + '">' + esc(c.name) + '</button>';
    }).join('');
    $$('#eCats [data-cat]').forEach(function (b) {
      b.addEventListener('click', function () {
        expCategory = catById(b.dataset.cat) ? b.dataset.cat : 'rent';
        renderCatChips();
      });
    });
    var cat = catById(expCategory);
    var hint = $('#eCatHint');
    if (hint) {
      if (cat && cat.hint) { hint.textContent = cat.hint; hint.hidden = false; }
      else { hint.textContent = ''; hint.hidden = true; }
    }
  }

  function syncLock() {
    if (typeof MZ.syncScrollLock === 'function') MZ.syncScrollLock();
  }

  /* Свободный id вида e1, e2… — без таймера в качестве источника id. */
  function newExpenseId() {
    var used = {};
    expenseList().forEach(function (e) { used[String(e.id)] = true; });
    var n = 1;
    while (used['e' + n]) n++;
    return 'e' + n;
  }

  function openExpSheet(id) {
    var sheet = $('#sheetExp');
    if (!sheet) return;

    var e = id ? findExpense(id) : null;
    editExpenseId = e ? String(e.id) : null;
    expCategory = e && catById(e.category) ? e.category : 'rent';

    setText('#expSheetTitle', e ? 'Расход' : 'Новый расход');
    setVal('#eDate', e ? e.date : isoLocal(todayNoon()));
    setVal('#eSum', e ? e.amount : '');
    setVal('#eNote', e ? e.comment : '');

    var del = $('#eDelete');
    if (del) del.hidden = !e;

    showExpErr('');
    renderCatChips();
    sheet.hidden = false;
    syncLock();
  }

  function closeExpSheet() {
    var sheet = $('#sheetExp');
    if (sheet) sheet.hidden = true;
    editExpenseId = null;
    showExpErr('');
    syncLock();
  }

  function saveExpense(e) {
    if (e && typeof e.preventDefault === 'function') e.preventDefault();

    var amount = Math.round(Number(val('#eSum')) || 0);
    if (!(amount > 0)) { showExpErr('Введите сумму больше нуля.'); return; }

    var date = val('#eDate');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { showExpErr('Укажите дату расхода.'); return; }

    var comment = String(val('#eNote') || '').trim();
    var s = state();
    var created = false;

    if (editExpenseId) {
      var target = findExpense(editExpenseId);
      if (target) {
        target.date = date;
        target.category = expCategory;
        target.amount = amount;
        target.comment = comment;
      }
    } else {
      expenseList().push({
        id: newExpenseId(),
        date: date,
        category: expCategory,
        amount: amount,
        comment: comment
      });
      created = true;
    }

    MZ.store.save(s);
    closeExpSheet();
    renderExpenses();
    renderReport();
    toast(created ? 'Расход добавлен: ' + catName(expCategory) + ', ' + money(amount) + ' ' + cur()
      : 'Расход сохранён: ' + catName(expCategory) + ', ' + money(amount) + ' ' + cur());
  }

  function removeExpense(id) {
    var e = findExpense(id);
    if (!e) return;

    var question = 'Удалить расход «' + catName(e.category) + '» на ' + money(e.amount) + ' ' +
      cur() + (e.comment ? ' (' + e.comment + ')' : '') + '?';
    var agreed = true;
    if (typeof confirm === 'function') agreed = confirm(question);
    if (!agreed) return;

    var s = state();
    s.expenses = expenseList().filter(function (x) { return String(x.id) !== String(e.id); });
    MZ.store.save(s);

    if (editExpenseId === String(e.id)) closeExpSheet();
    renderExpenses();
    renderReport();
    toast('Расход удалён: ' + catName(e.category));
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

  /* ---------- переходы ---------- */

  function openExpensesScreen() {
    renderExpenses();
    if (typeof MZ.go === 'function') MZ.go('expenses');
  }

  var btnExpenses = $('#btnExpenses');
  if (btnExpenses) btnExpenses.addEventListener('click', openExpensesScreen);

  var repToExpenses = $('#repToExpenses');
  if (repToExpenses) repToExpenses.addEventListener('click', openExpensesScreen);

  var expBack = $('#expBack');
  if (expBack) expBack.addEventListener('click', function () {
    if (typeof MZ.go === 'function') MZ.go('more');
  });

  /* Вкладка «Отчёт»: app.js уже переключил экран (его обработчик зарегистрирован раньше),
     здесь только пересчитываем цифры — отчёт не показывает устаревшие суммы. */
  $$('#tabbar [data-tab="report"]').forEach(function (b) {
    b.addEventListener('click', function () { renderReport(); });
  });

  /* Программный переход MZ.go('report') тоже обязан показать свежие цифры. */
  if (typeof MZ.go === 'function') {
    var baseGo = MZ.go;
    MZ.go = function (target) {
      var result = baseGo.apply(this, arguments);
      if (target === 'report') renderReport();
      if (target === 'expenses') renderExpenses();
      return result;
    };
  }

  /* ---------- сегменты и даты ---------- */

  var repSeg = $('#repSeg');
  if (repSeg) {
    $$('#repSeg .seg').forEach(function (b) {
      b.addEventListener('click', function () {
        repMode = b.dataset.range === 'month' ? 'month'
          : (b.dataset.range === 'custom' ? 'custom' : 'week');
        if (repMode === 'custom') {
          var range = reportRange();
          setVal('#repFrom', repCustom.from || range.from);
          setVal('#repTo', repCustom.to || range.to);
        }
        renderReport();
      });
    });
  }

  var expSeg = $('#expSeg');
  if (expSeg) {
    $$('#expSeg .seg').forEach(function (b) {
      b.addEventListener('click', function () {
        expMode = b.dataset.range === 'prev' ? 'prev'
          : (b.dataset.range === 'all' ? 'all' : 'month');
        renderExpenses();
      });
    });
  }

  ['#repFrom', '#repTo'].forEach(function (sel) {
    var el = $(sel);
    if (!el) return;
    el.addEventListener('change', function () {
      repMode = 'custom';
      repCustom.from = val('#repFrom') || repCustom.from;
      repCustom.to = val('#repTo') || repCustom.to;
      renderReport();
    });
  });

  /* ---------- шит: обработчики ---------- */

  var expAdd = $('#expAdd');
  if (expAdd) expAdd.addEventListener('click', function () { openExpSheet(null); });

  var formExp = $('#formExp');
  if (formExp) formExp.addEventListener('submit', saveExpense);

  var eDelete = $('#eDelete');
  if (eDelete) eDelete.addEventListener('click', function () {
    if (editExpenseId) removeExpense(editExpenseId);
  });

  var eCancel = $('#eCancel');
  if (eCancel) eCancel.addEventListener('click', closeExpSheet);
  $$('[data-close="exp"]').forEach(function (el) {
    el.addEventListener('click', closeExpSheet);
  });

  /* ---------- старт и API для следующих шагов ---------- */

  renderReport();
  renderExpenses();

  MZ.refreshReport = renderReport;

  MZ.reportScreen = {
    render: renderReport,
    renderExpenses: renderExpenses,
    range: reportRange,
    income: incomeOf,
    expenses: expensesOf,
    profit: profitOf,
    services: servicesOf,
    expenseCategories: expenseCategoryRowsForShow,
    expensesRange: expensesRange,
    categories: function () { return CATEGORIES.slice(); },
    catName: catName,
    expenseList: expenseList,
    findExpense: findExpense,
    openExpenseSheet: openExpSheet,
    closeExpenseSheet: closeExpSheet,
    saveExpense: saveExpense,
    removeExpense: removeExpense,
    money: money
  };

  function expenseCategoryRowsForShow(from, to) { return expenseCategoriesOf(from, to); }
})();
