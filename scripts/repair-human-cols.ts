/**
 * Лагодить рядки, де людські колонки з'їхали на одну вліво.
 *
 * Як це сталось: після міграції розкладки старий Code.gs (ще з зашитими
 * номерами колонок) записав ім'я продажника в «Статус», а дату — в «Хто веде».
 * Розпізнаємо саме цей відбиток: у «Хто веде» лежить серійне число дати, а в
 * «Статусі» — значення, якого немає серед статусів.
 *
 * Статус при цьому втрачено безповоротно (його затерло ім'ям), тому ставимо
 * порожній — вигадувати не будемо. Ім'я й дату відновлюємо.
 */
import { openDoc } from '../src/export/sheets.js';
import { ALL_COLUMNS, MACHINE_COL_COUNT, TABS } from '../src/export/columns.js';
import { log } from '../src/util/log.js';

const STATUSES = new Set([
  'Новий', 'В роботі', 'Дзвонив, не відповів', 'Зацікавлений',
  'Відправив пропозицію', 'Угода', 'Відмова', 'Не наш профіль',
]);

const C_STATUS = MACHINE_COL_COUNT;      // X
const C_OWNER = MACHINE_COL_COUNT + 1;   // Y
const C_DATE = MACHINE_COL_COUNT + 2;    // Z

const isSerialDate = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 20_000 && n < 100_000;
};

const doc = await openDoc();
let fixed = 0;

for (const title of [TABS.leads, TABS.manual, TABS.noSite]) {
  const sheet = doc.sheetsByTitle[title];
  if (!sheet || sheet.rowCount < 2) continue;

  await sheet.loadCells({
    startRowIndex: 0, endRowIndex: sheet.rowCount,
    startColumnIndex: 0, endColumnIndex: ALL_COLUMNS.length,
  });

  let touched = false;

  for (let r = 1; r < sheet.rowCount; r++) {
    if (!String(sheet.getCell(r, 0).value ?? '').trim()) continue;

    const status = String(sheet.getCell(r, C_STATUS).value ?? '').trim();
    const owner = sheet.getCell(r, C_OWNER).value;

    // Відбиток зсуву: у «Хто веде» число-дата, а «Статус» не зі списку
    if (!status || STATUSES.has(status) || !isSerialDate(owner)) continue;

    log.warn(`${title} рядок ${r + 1}: зсув — «${status}» у Статусі, дата у «Хто веде»`);

    sheet.getCell(r, C_OWNER).value = status; // ім'я повертаємо на місце
    sheet.getCell(r, C_STATUS).value = '';    // статус втрачено — не вигадуємо
    // Дата контакту (C_DATE) вже тримає справжню позначку часу — не чіпаємо
    touched = true;
    fixed++;
  }

  if (touched) await sheet.saveUpdatedCells();
}

log.ok(fixed ? `виправлено рядків: ${fixed}` : 'зсувів не знайдено');
