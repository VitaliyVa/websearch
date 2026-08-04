/**
 * Чистить людські колонки (Статус / Хто веде / Дата контакту / Коментар)
 * у всіх вкладках з лідами.
 *
 * Потрібно після тестових прогонів: у колонках лишились значення, яких ніхто
 * свідомо не ставив — частину записала панель сама (Selector викликав onChange
 * на монтуванні), частину зсунув старий Apps Script.
 *
 * Без --apply лише показує, що буде стерто.
 */
import { openDoc } from '../src/export/sheets.js';
import { ALL_COLUMNS, HUMAN_COLUMNS, MACHINE_COL_COUNT, TABS } from '../src/export/columns.js';
import { log } from '../src/util/log.js';

const APPLY = process.argv.includes('--apply');

const doc = await openDoc();
log.step(`Очищення статусів: "${doc.title}"${APPLY ? '' : ' (попередній перегляд)'}`);

let total = 0;

for (const title of [TABS.leads, TABS.manual, TABS.noSite, TABS.rejected]) {
  const sheet = doc.sheetsByTitle[title];
  if (!sheet || sheet.rowCount < 2) continue;
  if (sheet.columnCount < ALL_COLUMNS.length) continue;

  await sheet.loadCells({
    startRowIndex: 0, endRowIndex: sheet.rowCount,
    startColumnIndex: 0, endColumnIndex: ALL_COLUMNS.length,
  });

  let touched = 0;

  for (let r = 1; r < sheet.rowCount; r++) {
    const id = String(sheet.getCell(r, 0).value ?? '').trim();
    if (!id) continue;

    const vals = HUMAN_COLUMNS.map((_, k) => sheet.getCell(r, MACHINE_COL_COUNT + k));
    const filled = vals.filter((c) => c.value !== null && c.value !== '');
    if (!filled.length) continue;

    if (!APPLY) {
      const name = String(sheet.getCell(r, 1).value ?? '').slice(0, 34);
      const shown = HUMAN_COLUMNS.map((h, k) => {
        const v = vals[k]!.value;
        return v === null || v === '' ? null : `${h}="${String(v).slice(0, 26)}"`;
      }).filter(Boolean).join(', ');
      console.log(`  ${title} р.${r + 1} ${name.padEnd(36)} ${shown}`);
    } else {
      for (const c of filled) c.value = '';
    }
    touched++;
  }

  if (APPLY && touched) await sheet.saveUpdatedCells();
  if (touched) log.dim(`${title}: ${touched} рядків`);
  total += touched;
}

console.log('');
if (APPLY) log.ok(`очищено рядків: ${total}`);
else log.info(`буде очищено: ${total}. Запусти з --apply`);
