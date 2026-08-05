/**
 * Наскрізна перевірка: чи переживає нотатка продажника автоматичне відхилення.
 *
 * Сценарій, який раніше тихо губив роботу: менеджер ставить статус → rescore
 * переводить лід у `rejected` → рядок вичищається разом зі статусом.
 *
 * Тест справжній, не мок: пише в живу таблицю, змінює бакет, ганяє експорт і
 * перевіряє результат. Наприкінці відновлює все, що змінив.
 */
import { getPlaces, setBucket } from '../src/db/index.js';
import { openDoc } from '../src/export/sheets.js';
import { ALL_COLUMNS, MACHINE_COL_COUNT, TABS } from '../src/export/columns.js';
import { exportSheets } from '../src/commands/export.js';
import { log } from '../src/util/log.js';

const MARK = 'ТЕСТ-НОТАТКА';

// Беремо запис із NO_SITE — менеджери працюють переважно в Leads,
// тож тимчасовий тестовий рядок їм на очі не потрапить
const victim = getPlaces("WHERE bucket = 'no_site' ORDER BY COALESCE(user_rating_count,0) ASC LIMIT 1")[0];
if (!victim) throw new Error('нема на чому тестувати');

log.step(`Тест на: ${victim.name} (${victim.place_id})`);
const originalBucket = victim.bucket;
const originalReason = victim.reject_reason;

async function humanCells(tab: string, placeId: string) {
  const doc = await openDoc();
  const sheet = doc.sheetsByTitle[tab]!;
  await sheet.loadCells({
    startRowIndex: 0, endRowIndex: sheet.rowCount,
    startColumnIndex: 0, endColumnIndex: ALL_COLUMNS.length,
  });
  for (let r = 1; r < sheet.rowCount; r++) {
    if (String(sheet.getCell(r, 0).value ?? '').trim() !== placeId) continue;
    return { doc, sheet, row: r };
  }
  return null;
}

// 1. Продажник ставить статус
let found = await humanCells(TABS.noSite, victim.place_id);
if (!found) throw new Error('рядок не знайдено у вкладці');
found.sheet.getCell(found.row, MACHINE_COL_COUNT).value = MARK;
found.sheet.getCell(found.row, MACHINE_COL_COUNT + 1).value = 'тест-менеджер';
await found.sheet.saveUpdatedCells();
log.ok(`статус "${MARK}" записано в рядок ${found.row + 1}`);

// 2. Пайплайн відхиляє цей запис
setBucket(victim.place_id, 'rejected', 'тест: імітація автоматичного відхилення');
log.dim('бакет змінено на rejected');

// 3. Звичайний експорт
await exportSheets({ preset: 'us-diaspora-pilot', includeRejected: false });

// 4. Перевірка
found = await humanCells(TABS.noSite, victim.place_id);
const survived = found && String(found.sheet.getCell(found.row, MACHINE_COL_COUNT).value ?? '') === MARK;

console.log('');
if (survived) log.ok('НОТАТКА ВЦІЛІЛА — рядок лишився на місці разом зі статусом');
else log.err('НОТАТКУ ВТРАЧЕНО — рядок або статус зникли');

// 5. Прибираємо за собою
setBucket(victim.place_id, originalBucket, originalReason);
if (found) {
  for (let k = 0; k < 4; k++) found.sheet.getCell(found.row, MACHINE_COL_COUNT + k).value = '';
  await found.sheet.saveUpdatedCells();
}
log.dim('стан відновлено');

process.exit(survived ? 0 : 1);
