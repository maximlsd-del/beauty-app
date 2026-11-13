/* store.js — слой данных PWA «Мои Записи» (v2).
 *
 * Обычный скрипт: без import/export. Работает и в браузере, и в Node.
 * В браузере сам подхватывает localStorage; в Node можно подставить
 * фейковое хранилище через MZ.store.setStorage(fake) или global.localStorage.
 *
 * Контракт данных — beauty-pwa-ПЛАН.md, раздел «Данные v2».
 * Правила:
 *   - единственный ключ состояния — beauty_app_state_v2;
 *   - миграция v1 → v2 идемпотентна и не удаляет старые ключи;
 *   - перед миграцией сырые старые ключи кладутся в beauty_app_backup_v1 (один раз);
 *   - даты — только локальные, toISOString() для дат не используется.
 */
(function (root) {
  'use strict';

  var SCHEMA_VERSION = 2;

  var KEYS = {
    state: 'beauty_app_state_v2',
    backupV1: 'beauty_app_backup_v1',
    backupImport: 'beauty_app_backup_before_import',
    records: 'beauty_app_records',
    clients: 'beauty_app_clients',
    theme: 'beauty_app_theme'
  };

  var THEMES = ['classic', 'dark', 'trend', 'lavender', 'graphite', 'auto'];
  var EXPENSE_CATEGORIES = ['rent', 'utility', 'materials', 'other'];
  var EXPENSE_ALIASES = {
    rent: 'rent',
    utility: 'utility',
    util: 'utility',
    materials: 'materials',
    mat: 'materials',
    other: 'other'
  };

  /* Базовый набор услуг — из макета (js/data.js). */
  var BASE_SERVICES = [
    { id: 's1', name: 'Маникюр с покрытием', price: 2500, minutes: 90 },
    { id: 's2', name: 'Наращивание ресниц', price: 3800, minutes: 120 },
    { id: 's3', name: 'Коррекция бровей', price: 1500, minutes: 45 },
    { id: 's4', name: 'Педикюр', price: 3200, minutes: 90 },
    { id: 's5', name: 'Стрижка', price: 2000, minutes: 60 },
    { id: 's6', name: 'Окрашивание', price: 4500, minutes: 180 }
  ];

  /* ---------- обёртка над хранилищем ---------- */

  var storageOverride = null;
  var memoryStore = null;

  function memoryBackend() {
    if (!memoryStore) {
      var data = {};
      var order = [];
      memoryStore = {
        getItem: function (key) {
          return Object.prototype.hasOwnProperty.call(data, key) ? data[key] : null;
        },
        setItem: function (key, value) {
          if (!Object.prototype.hasOwnProperty.call(data, key)) order.push(key);
          data[key] = String(value);
        },
        removeItem: function (key) {
          if (Object.prototype.hasOwnProperty.call(data, key)) {
            delete data[key];
            var i = order.indexOf(key);
            if (i !== -1) order.splice(i, 1);
          }
        },
        clear: function () {
          data = {};
          order.length = 0;
        },
        key: function (i) {
          return i >= 0 && i < order.length ? order[i] : null;
        }
      };
      Object.defineProperty(memoryStore, 'length', {
        get: function () { return order.length; }
      });
    }
    return memoryStore;
  }

  function backend() {
    if (storageOverride) return storageOverride;
    try {
      if (typeof localStorage !== 'undefined' && localStorage &&
          typeof localStorage.getItem === 'function' &&
          typeof localStorage.setItem === 'function') {
        return localStorage;
      }
    } catch (e) { /* приватный режим Safari и т.п. */ }
    return memoryBackend();
  }

  function rawGet(key) {
    var store = backend();
    try {
      var value = store.getItem(key);
      return value === undefined ? null : value;
    } catch (e) {
      return null;
    }
  }

  function rawSet(key, value) {
    var store = backend();
    try {
      store.setItem(key, String(value));
      return true;
    } catch (e) {
      return false;
    }
  }

  /* ---------- утилиты ---------- */

  function isObj(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }

  function asText(value) {
    return value === null || value === undefined ? '' : String(value);
  }

  function asName(value) {
    return asText(value).replace(/\s+/g, ' ').trim();
  }

  /* Терпимость к формату суммы: файл импорта человек может править руками,
     и тогда в цене окажется «2 500 ₽», «1 234,56 руб.» или «2500.50».
     Оставляем только цифры, точку, запятую и минус, затем определяем
     десятичный разделитель. Мусор вместо числа даёт 0, а не NaN. */
  function toNumber(value) {
    if (typeof value === 'number') return isFinite(value) ? value : 0;
    if (value === null || value === undefined) return 0;
    var text = String(value).trim();
    if (text === '') return 0;
    var cleaned = text.replace(/[^\d.,-]/g, '');
    if (cleaned === '') return 0;
    var dot = cleaned.lastIndexOf('.');
    var comma = cleaned.lastIndexOf(',');
    if (dot !== -1 && comma !== -1) {
      /* Оба разделителя: последний — десятичный, остальные отделяют разряды. */
      if (comma > dot) {
        cleaned = cleaned.replace(/\./g, '').replace(/,/g, '.');
      } else {
        cleaned = cleaned.replace(/,/g, '');
      }
    } else if (comma !== -1) {
      cleaned = cleaned.replace(/,/g, '.');
    }
    var number = Number(cleaned);
    return isFinite(number) ? number : 0;
  }

  function safeParse(raw, fallback) {
    if (raw === null || raw === undefined || raw === '') return fallback;
    try {
      var parsed = JSON.parse(raw);
      return parsed === null || parsed === undefined ? fallback : parsed;
    } catch (e) {
      return fallback;
    }
  }

  function deepClone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function pad2(number) {
    return number < 10 ? '0' + number : String(number);
  }

  /* Локальная метка времени: без toISOString(), без UTC-сдвигов. */
  function localStamp() {
    var d = new Date();
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) +
      ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes());
  }

  function normalizeTheme(raw) {
    var value = raw;
    if (typeof value === 'string' && value.charAt(0) === '"') {
      try { value = JSON.parse(value); } catch (e) { /* оставляем как есть */ }
    }
    value = asText(value).trim();
    if (value.indexOf('theme-') === 0) value = value.slice(6);
    return THEMES.indexOf(value) === -1 ? 'classic' : value;
  }

  function seedServices() {
    return BASE_SERVICES.map(function (service) {
      return {
        id: service.id,
        name: service.name,
        price: service.price,
        minutes: service.minutes
      };
    });
  }

  /* remindBefore — за сколько минут до записи напоминать (шаг 8).
     Значения, которые предлагает интерфейс: 60, 180, 1440, 2880.
     По умолчанию 1440 — «за день»: напоминать в день визита поздно, мастер
     может не успеть. digest — показывать ли сводку при открытии приложения. */
  function defaultSettings() {
    return {
      theme: 'classic',
      currency: '₽',
      sleepingDays: 60,
      remindBefore: 1440,
      digest: true
    };
  }

  /* Необязательные настройки сохранности данных (шаг 5):
     lastBackup — дата последней сохранённой копии «ГГГГ-ММ-ДД»;
     backupBannerHiddenOn — день, на который баннер напоминания закрыт;
     installCardSeenOn — день, когда онбординг «Установить» был показан.
     Ключ попадает в состояние ТОЛЬКО если он реально задан валидной локальной
     датой: иначе набор настроек по умолчанию остался бы другим, а «нет даты»
     и «дата не задана» — одно и то же состояние. */
  var OPTIONAL_DATE_SETTINGS = ['lastBackup', 'backupBannerHiddenOn', 'installCardSeenOn'];

  function localDateOrNull(value) {
    var text = asText(value).trim();
    return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
  }

  function defaultState() {
    return {
      schemaVersion: SCHEMA_VERSION,
      records: [],
      clients: [],
      services: seedServices(),
      expenses: [],
      settings: defaultSettings()
    };
  }

  /* ---------- построение каталога услуг из записей ---------- */

  /* Услуги записи списком: новая модель хранит services[], старая — одно название.
     Обе читаются одинаково, поэтому миграция v1 и импорт старых копий не теряют услуги. */
  function recordSvcItems(record) {
    if (Array.isArray(record.services) && record.services.length) return record.services;
    return [{
      serviceId: record.serviceId,
      svcName: record.svcName,
      minutes: record.minutes,
      base: record.base
    }];
  }

  function svcNamesOf(list) {
    return (list || []).map(function (item) { return asName(item && item.svcName); })
      .filter(function (name) { return !!name; })
      .join(' + ');
  }

  function buildServicesFromRecords(records) {
    var order = [];
    var map = {};

    records.forEach(function (record) {
      recordSvcItems(record).forEach(function (item) {
        var name = asName(item.svcName);
        if (!name) return;
        var key = name.toLowerCase();
        var entry = map[key];
        if (!entry) {
          entry = map[key] = { name: name, prices: [], counts: {} };
          order.push(key);
        }
        var price = toNumber(item.base);
        entry.prices.push(price);
        entry.counts[price] = (entry.counts[price] || 0) + 1;
      });
    });

    return order.map(function (key, index) {
      var entry = map[key];
      var bestPrice = entry.prices[0];
      var bestCount = -1;
      var seen = {};
      entry.prices.forEach(function (price) {
        if (Object.prototype.hasOwnProperty.call(seen, price)) return;
        seen[price] = true;
        var count = entry.counts[price];
        if (count > bestCount) {
          bestCount = count;
          bestPrice = price;
        }
      });
      return {
        id: 's' + (index + 1),
        name: entry.name,
        price: bestPrice,
        minutes: 60
      };
    });
  }

  function attachServices(records, services) {
    var byName = {};
    services.forEach(function (service) {
      var key = asName(service.name).toLowerCase();
      if (key && !byName[key]) byName[key] = service;
    });
    records.forEach(function (record) {
      if (Array.isArray(record.services) && record.services.length) {
        record.services.forEach(function (item) {
          var svc = byName[asName(item.svcName).toLowerCase()];
          if (svc) {
            item.serviceId = String(svc.id);
            var m = toNumber(svc.minutes);
            if (m > 0 && !item.minutes) item.minutes = m;
          }
        });
        record.serviceId = record.services[0].serviceId || null;
        return;
      }
      var key = asName(record.svcName).toLowerCase();
      var service = key ? byName[key] : null;
      record.serviceId = service ? service.id : null;
      var minutes = service ? toNumber(service.minutes) : 0;
      record.minutes = minutes > 0 ? minutes : 60;
    });
  }

  /* ---------- объединение клиентов ---------- */

  function buildClients(oldClients, records) {
    var order = [];
    var byKey = {};

    function remember(nameRaw, phoneRaw) {
      var name = asName(nameRaw);
      if (!name) return;
      var key = name.toLowerCase();
      var phone = asName(phoneRaw);
      var entry = byKey[key];
      if (!entry) {
        byKey[key] = { name: name, phone: phone };
        order.push(key);
        return;
      }
      /* Написание имени берём из записи, телефон — самый свежий непустой. */
      entry.name = name;
      if (phone) entry.phone = phone;
    }

    oldClients.forEach(function (client) {
      if (isObj(client)) remember(client.name, client.phone);
    });
    records.forEach(function (record) {
      remember(record.name, record.phone);
    });

    return order.map(function (key, index) {
      var entry = byKey[key];
      return {
        id: 'c' + (index + 1),
        name: entry.name,
        phone: entry.phone,
        birthday: null,
        note: '',
        blacklist: false,
        blacklistReason: '',
        remindedAt: null,
        broadcastAt: null
      };
    });
  }

  /* ---------- нормализация состояния v2 ---------- */

  /* Одна услуга внутри записи: снимок названия, цены и длительности.
     serviceId — ссылка на каталог, null — если услугу вписали руками или удалили. */
  function normalizeSvcItem(raw) {
    var s = isObj(raw) ? raw : {};
    var name = asName(s.svcName !== undefined && s.svcName !== null ? s.svcName : s.name);
    var minutes = toNumber(s.minutes);
    return {
      serviceId: s.serviceId !== undefined && s.serviceId !== null && String(s.serviceId) !== ''
        ? String(s.serviceId)
        : null,
      svcName: name,
      minutes: minutes > 0 ? minutes : 0,
      base: toNumber(s.base)
    };
  }

  function normalizeRecord(raw, index) {
    var r = isObj(raw) ? raw : {};
    var svcName = asName(r.svcName !== undefined && r.svcName !== null ? r.svcName : r.procedure);
    var base = toNumber(r.base !== undefined && r.base !== null ? r.base : r.price);
    var price = r.price === undefined || r.price === null || r.price === ''
      ? base
      : toNumber(r.price);
    var minutes = toNumber(r.minutes) > 0 ? toNumber(r.minutes) : 60;
    var serviceId = r.serviceId !== undefined && r.serviceId !== null && String(r.serviceId) !== ''
      ? String(r.serviceId)
      : null;

    /* Несколько услуг: новые записи несут services[], старые — одно svcName.
       Старую запись разворачиваем в список из одной услуги — дальше всё читается одинаково. */
    var services = Array.isArray(r.services)
      ? r.services.filter(isObj).map(normalizeSvcItem).filter(function (it) { return !!it.svcName || !!it.serviceId; })
      : [];
    if (!services.length && svcName) {
      services = [{ serviceId: serviceId, svcName: svcName, minutes: minutes, base: base }];
    }
    if (services.length) {
      var joined = svcNamesOf(services);
      if (joined) svcName = joined;
      if (!serviceId && services[0].serviceId) serviceId = String(services[0].serviceId);
    }

    return {
      id: r.id !== undefined && r.id !== null && String(r.id) !== '' ? String(r.id) : 'r' + (index + 1),
      name: asName(r.name),
      phone: asName(r.phone),
      svcName: svcName,
      serviceId: serviceId,
      services: services,
      date: asText(r.date).trim(),
      time: asText(r.time).trim(),
      minutes: minutes,
      base: base,
      discount: toNumber(r.discount),
      price: price,
      priceNote: asText(r.priceNote),
      comment: asText(r.comment),
      paid: !!r.paid,
      remindedAt: r.remindedAt === undefined ? null : r.remindedAt
    };
  }

  /* День рождения в контракте — строка «ММ-ДД» или null (шаг 7). Старый формат макета
     ({d, m, y}) тоже принимаем: данные пользователя не должны теряться при импорте,
     а мусор в поле не должен превращаться в «день рождения» при чтении. */
  function normalizeBirthday(value) {
    if (isObj(value)) return validMonthDay(toNumber(value.m), toNumber(value.d));
    var text = asText(value).trim();
    var found = /^(\d{1,2})-(\d{1,2})$/.exec(text);
    if (!found) return null;
    return validMonthDay(Number(found[1]), Number(found[2]));
  }

  /* Длина месяца: февраль 29 разрешён всегда — в невисокосный год поздравляем 28-го. */
  function validMonthDay(month, day) {
    var limits = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    if (!(month >= 1 && month <= 12)) return null;
    if (!(day >= 1 && day <= limits[month - 1])) return null;
    return pad2(month) + '-' + pad2(day);
  }

  function normalizeClient(raw, index) {
    var c = isObj(raw) ? raw : {};
    var blacklist = c.blacklist;
    var isBlack = false;
    var reason = asText(c.blacklistReason);
    if (blacklist !== null && typeof blacklist === 'object') {
      isBlack = true;
      reason = reason || asText(blacklist.reason);
    } else {
      isBlack = !!blacklist;
    }
    return {
      id: c.id !== undefined && c.id !== null && String(c.id) !== '' ? String(c.id) : 'c' + (index + 1),
      name: asName(c.name),
      phone: asName(c.phone),
      birthday: normalizeBirthday(c.birthday),
      note: asText(c.note),
      blacklist: isBlack,
      blacklistReason: reason,
      remindedAt: localDateOrNull(c.remindedAt),
      /* broadcastAt — дата последней рассылки клиенту (шаг 9). Правило то же, что у
         remindedAt: только настоящая локальная ГГГГ-ММ-ДД, иначе null. */
      broadcastAt: localDateOrNull(c.broadcastAt)
    };
  }

  function normalizeService(raw, index) {
    var s = isObj(raw) ? raw : {};
    var rawMinutes = s.minutes !== undefined && s.minutes !== null ? s.minutes : s.dur;
    var minutes = toNumber(rawMinutes);
    return {
      id: s.id !== undefined && s.id !== null && String(s.id) !== '' ? String(s.id) : 's' + (index + 1),
      name: asName(s.name),
      price: toNumber(s.price),
      minutes: minutes > 0 ? minutes : 60
    };
  }

  function normalizeExpense(raw, index) {
    var e = isObj(raw) ? raw : {};
    var rawCategory = asName(e.category !== undefined && e.category !== null ? e.category : e.cat);
    var category = EXPENSE_ALIASES[rawCategory] || 'other';
    return {
      id: e.id !== undefined && e.id !== null && String(e.id) !== '' ? String(e.id) : 'e' + (index + 1),
      date: asText(e.date).trim(),
      category: category,
      amount: toNumber(e.amount !== undefined && e.amount !== null ? e.amount : e.sum),
      comment: asText(e.comment !== undefined && e.comment !== null ? e.comment : e.note)
    };
  }

  function normalizeSettings(raw) {
    var s = isObj(raw) ? raw : {};
    var sleeping = s.sleepingDays === undefined || s.sleepingDays === null || s.sleepingDays === ''
      ? 60
      : toNumber(s.sleepingDays);
    var remind = s.remindBefore === undefined || s.remindBefore === null || s.remindBefore === ''
      ? 1440
      : toNumber(s.remindBefore);
    var out = {
      theme: normalizeTheme(s.theme),
      currency: asName(s.currency) || '₽',
      sleepingDays: sleeping,
      remindBefore: remind,
      digest: s.digest === undefined ? true : !!s.digest
    };
    OPTIONAL_DATE_SETTINGS.forEach(function (key) {
      var date = localDateOrNull(s[key]);
      if (date) out[key] = date;
    });
    return out;
  }

  function normalizeState(raw) {
    var source = isObj(raw) ? raw : {};
    var records = (Array.isArray(source.records) ? source.records : [])
      .filter(isObj)
      .map(normalizeRecord);
    var clients = (Array.isArray(source.clients) ? source.clients : [])
      .filter(isObj)
      .map(normalizeClient);
    var services = Array.isArray(source.services)
      ? source.services.filter(isObj).map(normalizeService)
      : seedServices();
    var expenses = (Array.isArray(source.expenses) ? source.expenses : [])
      .filter(isObj)
      .map(normalizeExpense);
    return {
      schemaVersion: SCHEMA_VERSION,
      records: records,
      clients: clients,
      services: services,
      expenses: expenses,
      settings: normalizeSettings(source.settings)
    };
  }

  /* ---------- миграция v1 → v2 ---------- */

  function buildStateFromV1() {
    var sourceRecords = safeParse(rawGet(KEYS.records), []);
    var sourceClients = safeParse(rawGet(KEYS.clients), []);
    if (!Array.isArray(sourceRecords)) sourceRecords = [];
    if (!Array.isArray(sourceClients)) sourceClients = [];

    var records = [];
    sourceRecords.forEach(function (raw, index) {
      if (!isObj(raw)) return;
      var svcName = asName(raw.svcName !== undefined && raw.svcName !== null ? raw.svcName : raw.procedure);
      var base = toNumber(raw.base !== undefined && raw.base !== null ? raw.base : raw.price);
      records.push({
        id: raw.id !== undefined && raw.id !== null && String(raw.id) !== '' ? String(raw.id) : 'm' + (index + 1),
        name: asName(raw.name),
        phone: asName(raw.phone),
        svcName: svcName,
        serviceId: null,
        date: asText(raw.date).trim(),
        time: asText(raw.time).trim(),
        minutes: 60,
        base: base,
        discount: 0,
        price: base,
        priceNote: '',
        comment: asText(raw.comment),
        paid: false,
        remindedAt: null
      });
    });

    var services = buildServicesFromRecords(records);
    if (!services.length) services = seedServices();
    attachServices(records, services);

    var clients = buildClients(sourceClients, records);
    var theme = normalizeTheme(rawGet(KEYS.theme));

    return {
      schemaVersion: SCHEMA_VERSION,
      records: records,
      clients: clients,
      services: services,
      expenses: [],
      settings: {
        theme: theme,
        currency: '₽',
        sleepingDays: 60,
        remindBefore: 1440,
        digest: true
      }
    };
  }

  function backupV1Keys() {
    var keys = [KEYS.records, KEYS.clients, KEYS.theme];
    var present = keys.some(function (key) { return rawGet(key) !== null; });
    if (!present) return false;
    /* Резервная копия создаётся один раз и никогда не перезаписывается. */
    if (rawGet(KEYS.backupV1) !== null) return false;
    var raw = {};
    keys.forEach(function (key) { raw[key] = rawGet(key); });
    return rawSet(KEYS.backupV1, JSON.stringify({
      savedAt: localStamp(),
      raw: raw
    }));
  }

  function migrate() {
    var existingRaw = rawGet(KEYS.state);
    if (existingRaw !== null) {
      var existing = safeParse(existingRaw, null);
      if (isObj(existing)) {
        /* Уже есть состояние — ничего не перезаписываем (идемпотентность). */
        return normalizeState(existing);
      }
      /* Битое состояние: сохраним сырую строку в резервной копии и пересоберём. */
      if (rawGet(KEYS.backupV1) === null) {
        rawSet(KEYS.backupV1, JSON.stringify({
          savedAt: localStamp(),
          raw: { beauty_app_state_v2: existingRaw },
          brokenState: true
        }));
      }
    } else {
      backupV1Keys();
    }

    var state = normalizeState(buildStateFromV1());
    rawSet(KEYS.state, JSON.stringify(state));
    return state;
  }

  /* ---------- чтение / запись / экспорт / импорт ---------- */

  function load() {
    var raw = rawGet(KEYS.state);
    if (raw !== null) {
      var parsed = safeParse(raw, null);
      if (isObj(parsed)) return normalizeState(parsed);
    }
    return migrate();
  }

  function save(state) {
    var normalized = normalizeState(state);
    rawSet(KEYS.state, JSON.stringify(normalized));
    return normalized;
  }

  function exportState() {
    var state = normalizeState(load());
    var copy = deepClone(state);
    copy.schemaVersion = SCHEMA_VERSION;
    return copy;
  }

  function importState(json) {
    var counts = { records: 0, clients: 0 };
    if (!isObj(json)) {
      return {
        ok: false,
        counts: counts,
        error: 'Не удалось прочитать файл: ожидался объект состояния «Мои Записи».'
      };
    }

    if (Array.isArray(json.records)) counts.records = json.records.filter(isObj).length;
    if (Array.isArray(json.clients)) counts.clients = json.clients.filter(isObj).length;

    if (json.schemaVersion === undefined || json.schemaVersion === null) {
      return {
        ok: false,
        counts: counts,
        error: 'В файле нет поля schemaVersion — это не экспорт «Мои Записи».'
      };
    }
    if (json.schemaVersion !== SCHEMA_VERSION) {
      return {
        ok: false,
        counts: counts,
        error: 'Несовместимая версия файла (schemaVersion ' + String(json.schemaVersion) +
          '), поддерживается только ' + SCHEMA_VERSION + '.'
      };
    }
    if (json.records !== undefined && json.records !== null && !Array.isArray(json.records)) {
      return {
        ok: false,
        counts: counts,
        error: 'Поле records повреждено: ожидался массив записей.'
      };
    }
    if (json.clients !== undefined && json.clients !== null && !Array.isArray(json.clients)) {
      return {
        ok: false,
        counts: counts,
        error: 'Поле clients повреждено: ожидался массив клиентов.'
      };
    }

    return { ok: true, counts: counts, error: null };
  }

  function applyImport(json) {
    var check = importState(json);
    if (!check.ok) return check;

    var previousRaw = rawGet(KEYS.state);
    rawSet(KEYS.backupImport, previousRaw === null ? 'null' : previousRaw);

    var state = normalizeState(json);
    if (!rawSet(KEYS.state, JSON.stringify(state))) {
      return {
        ok: false,
        counts: check.counts,
        error: 'Не удалось сохранить состояние в localStorage.'
      };
    }
    return { ok: true, counts: check.counts, error: null };
  }

  /* ---------- публичный API ---------- */

  var store = {
    SCHEMA_VERSION: SCHEMA_VERSION,
    VERSION: SCHEMA_VERSION,
    KEYS: KEYS,
    load: load,
    save: save,
    migrate: migrate,
    export: exportState,
    import: importState,
    applyImport: applyImport,
    seedServices: seedServices,
    defaultState: defaultState,
    createDefaultState: defaultState,
    normalize: normalizeState,
    setStorage: function (fakeStorage) {
      storageOverride = fakeStorage || null;
    },
    _backend: backend
  };

  root.MZ = root.MZ || {};
  root.MZ.store = store;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = root.MZ;
  }
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this));
