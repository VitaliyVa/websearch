/**
 * Бекенд для сайту продажників. Живе ВСЕРЕДИНІ Google-таблиці.
 *
 * ЧОМУ САМЕ ТАК.
 * Статичний сайт на GitHub Pages не має сервера, тому будь-який ключ у ньому
 * публічний: DevTools → Network → і чужа людина має приватний ключ service
 * account з доступом до всієї таблиці. А «пароль» у статиці, де дані вже
 * лежать у бандлі, лише малює форму й нічого не захищає.
 *
 * Apps Script знімає обидві проблеми: код виконується на боці Google, ключів
 * у браузері нема взагалі, а пароль перевіряється тут — по-справжньому.
 *
 * МЕЖА ЗАХИСТУ, чесно: URL цього застосунку публічний. Хто знає URL і код —
 * зайде. Це рівень «замок від чесних людей», якого достатньо для списку
 * комерційних лідів. Для персональних даних клієнтів потрібен був би OAuth.
 *
 * ЯК РОЗГОРНУТИ
 *   1. Відкрий таблицю → Розширення → Apps Script
 *   2. Встав цей файл замість вмісту Code.gs
 *   3. Заміни коди в ACCESS_CODES на свої
 *   4. Розгорнути → Новий розгорток → тип «Веб-застосунок»
 *        Виконувати від імені: Я
 *        Хто має доступ: Усі
 *   5. Скопіюй URL — його треба вписати у web/.env як VITE_API_URL
 */

/* ─────────────────────────  НАЛАШТУВАННЯ  ───────────────────────── */

/**
 * Код доступу на КОЖНОГО продажника, а не один спільний.
 *
 * Так видно, хто саме змінив статус (скрипт сам проставляє «Хто веде»),
 * і можна відкликати доступ одній людині, не міняючи пароль решті.
 */
var ACCESS_CODES = {
  'zmina-2026-oleh': 'Олег',
  'zmina-2026-iryna': 'Ірина',
  'zmina-2026-admin': 'Адмін',
};

var TAB_LEADS = 'Leads';
var TAB_MANUAL = 'Manual review';
var TAB_NO_SITE = 'NO_SITE';

/** Колонки A..V пише пайплайн, W..Z — продажники. Скрипт торкається лише W..Z. */
var COL_PLACE_ID = 1; // A
var COL_STATUS = 23; // W
var COL_OWNER = 24; // X
var COL_DATE = 25; // Y
var COL_NOTE = 26; // Z

var STATUSES = [
  'Новий',
  'В роботі',
  'Дзвонив, не відповів',
  'Зацікавлений',
  'Відправив пропозицію',
  'Угода',
  'Відмова',
  'Не наш профіль',
];

var CACHE_SECONDS = 60;

/* ─────────────────────────  ТОЧКИ ВХОДУ  ───────────────────────── */

function doGet(e) {
  try {
    var action = (e.parameter.action || 'leads').toString();
    var who = authenticate(e.parameter.code);
    if (!who) return json({ok: false, error: 'Невірний код доступу'});

    if (action === 'leads') return json({ok: true, user: who, data: readAll()});
    if (action === 'meta') return json({ok: true, user: who, statuses: STATUSES});
    return json({ok: false, error: 'Невідома дія: ' + action});
  } catch (err) {
    return json({ok: false, error: String(err)});
  }
}

/**
 * POST приходить із Content-Type: text/plain — навмисно.
 *
 * Apps Script не обробляє CORS-preflight, а браузер шле OPTIONS для будь-якого
 * application/json. text/plain вважається «простим» запитом і preflight не
 * викликає, тому запит проходить. Тіло однаково парситься як JSON.
 */
function doPost(e) {
  try {
    var body = JSON.parse(e.postData.contents || '{}');
    var who = authenticate(body.code);
    if (!who) return json({ok: false, error: 'Невірний код доступу'});

    if (body.action === 'update') return json(updateLead(body, who));
    return json({ok: false, error: 'Невідома дія'});
  } catch (err) {
    return json({ok: false, error: String(err)});
  }
}

function authenticate(code) {
  if (!code) return null;
  return ACCESS_CODES[String(code).trim()] || null;
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(
    ContentService.MimeType.JSON,
  );
}

/* ─────────────────────────  ЧИТАННЯ  ───────────────────────── */

function readAll() {
  var cache = CacheService.getScriptCache();
  var hit = cache.get('leads_payload');
  if (hit) return JSON.parse(hit);

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var out = {leads: [], manual: [], noSite: [], statuses: STATUSES};

  out.leads = readTab(ss, TAB_LEADS);
  out.manual = readTab(ss, TAB_MANUAL);
  out.noSite = readTab(ss, TAB_NO_SITE);

  // Кеш на хвилину: при кількох продажниках прибирає більшість звернень
  // до Sheets і тримає застосунок швидким.
  try {
    cache.put('leads_payload', JSON.stringify(out), CACHE_SECONDS);
  } catch (e) {
    // payload завеликий для кешу — не біда, віддамо без кешу
  }
  return out;
}

function readTab(ss, name) {
  var sheet = ss.getSheetByName(name);
  if (!sheet) return [];

  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  var values = sheet.getRange(1, 1, lastRow, 26).getValues();
  var headers = values[0];
  var rows = [];

  for (var r = 1; r < values.length; r++) {
    var v = values[r];
    if (!v[0]) continue; // рядок без place_id — порожній або службовий

    var row = {};
    for (var c = 0; c < headers.length; c++) {
      var key = String(headers[c] || ('col' + c)).trim();
      if (!key) continue;
      var cell = v[c];
      row[key] = cell instanceof Date ? Utilities.formatDate(cell, 'GMT', 'yyyy-MM-dd') : cell;
    }
    row.__tab = name;
    row.__row = r + 1;
    rows.push(row);
  }
  return rows;
}

/* ─────────────────────────  ЗАПИС  ───────────────────────── */

/**
 * Пише ТІЛЬКИ в колонки W..Z і шукає рядок за place_id, а не за номером.
 *
 * Номер рядка змінюється щоразу, коли пайплайн перевантажує таблицю з іншим
 * сортуванням — писали б не туди. place_id стабільний назавжди.
 */
function updateLead(body, who) {
  var placeId = String(body.placeId || '').trim();
  if (!placeId) return {ok: false, error: 'placeId відсутній'};

  // Блокування: двоє продажників можуть тиснути одночасно, і без нього
  // читання-запис двох запитів наклалися б.
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return {ok: false, error: 'Таблиця зайнята, спробуй ще раз'};

  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var tabs = [TAB_LEADS, TAB_MANUAL, TAB_NO_SITE];

    for (var t = 0; t < tabs.length; t++) {
      var sheet = ss.getSheetByName(tabs[t]);
      if (!sheet) continue;

      var lastRow = sheet.getLastRow();
      if (lastRow < 2) continue;

      var ids = sheet.getRange(2, COL_PLACE_ID, lastRow - 1, 1).getValues();
      for (var i = 0; i < ids.length; i++) {
        if (String(ids[i][0]).trim() !== placeId) continue;

        var rowNum = i + 2;
        if (body.status !== undefined) sheet.getRange(rowNum, COL_STATUS).setValue(body.status);
        // «Хто веде» проставляє скрипт за кодом доступу — продажник не може
        // випадково записати чуже ім'я
        sheet.getRange(rowNum, COL_OWNER).setValue(who);
        sheet.getRange(rowNum, COL_DATE).setValue(new Date());
        if (body.note !== undefined) sheet.getRange(rowNum, COL_NOTE).setValue(body.note);

        CacheService.getScriptCache().remove('leads_payload');
        return {ok: true, tab: tabs[t], row: rowNum, owner: who};
      }
    }
    return {ok: false, error: 'Лід не знайдено: ' + placeId};
  } finally {
    lock.releaseLock();
  }
}
