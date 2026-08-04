/**
 * Одноразова міграція розкладки: вставляє колонку «Опис для продажника»
 * перед людськими колонками.
 *
 * Чому не просто дописати заголовок: людські колонки (Статус / Хто веде /
 * Дата / Коментар) уже заповнені продажниками. Якби ми зсунули розкладку в
 * коді, не зсунувши даних, статус ліда опинився б у колонці опису й був би
 * затертий наступним же експортом.
 *
 * Тому вставку робить сам Google через insertDimension — він зсуває вміст
 * разом із колонками, зберігаючи і значення, і формати.
 *
 * Скрипт ідемпотентний: повторний запуск нічого не робить.
 */
import { openDoc } from '../src/export/sheets.js';
import { HUMAN_COLUMNS, MACHINE_COLUMNS, MACHINE_COL_COUNT, TABS } from '../src/export/columns.js';
import { log } from '../src/util/log.js';

const NEW_COL = 'Опис для продажника';
// 0-based індекс, куди вставляємо. Дорівнює кількості машинних колонок мінус
// сама нова колонка — тобто позиція, де зараз починаються людські.
const INSERT_AT = MACHINE_COL_COUNT - 1;

const tabs = [TABS.leads, TABS.manual, TABS.noSite, TABS.rejected];

const doc = await openDoc();
log.step(`Міграція розкладки: "${doc.title}"`);

for (const title of tabs) {
  const sheet = doc.sheetsByTitle[title];
  if (!sheet) {
    log.dim(`${title}: вкладки немає, пропускаю`);
    continue;
  }

  await sheet.loadCells({
    startRowIndex: 0, endRowIndex: 1,
    startColumnIndex: 0, endColumnIndex: Math.min(sheet.columnCount, MACHINE_COLUMNS.length + HUMAN_COLUMNS.length),
  });

  const at = String(sheet.getCell(0, INSERT_AT).value ?? '').trim();

  if (at === NEW_COL) {
    log.dim(`${title}: вже мігровано`);
    continue;
  }

  if (at !== HUMAN_COLUMNS[0]) {
    // Не та розкладка, яку ми очікували. Зупиняємось, а не вгадуємо:
    // помилковий зсув затре роботу продажників.
    log.warn(`${title}: у колонці ${INSERT_AT + 1} очікував "${HUMAN_COLUMNS[0]}", а там "${at}" — пропускаю`);
    continue;
  }

  // Місце під нову колонку має існувати фізично
  const need = MACHINE_COLUMNS.length + HUMAN_COLUMNS.length;
  if (sheet.columnCount < need) {
    await sheet.resize({ rowCount: sheet.rowCount, columnCount: need });
  }

  await sheet.insertDimension('COLUMNS', { startIndex: INSERT_AT, endIndex: INSERT_AT + 1 }, false);

  await sheet.loadCells({
    startRowIndex: 0, endRowIndex: 1,
    startColumnIndex: INSERT_AT, endColumnIndex: INSERT_AT + 1,
  });
  const header = sheet.getCell(0, INSERT_AT);
  header.value = NEW_COL;
  header.textFormat = { bold: true };
  await sheet.saveUpdatedCells();

  log.ok(`${title}: вставлено «${NEW_COL}», людські колонки зсунуто вправо`);
}

log.ok('Готово. Тепер онови Code.gs в редакторі Apps Script — він шукає колонки за назвою.');
