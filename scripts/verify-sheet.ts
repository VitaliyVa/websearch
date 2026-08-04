/** Читає перші рядки вкладки Leads прямо з таблиці — перевірка розкладки після міграції. */
import { openDoc } from '../src/export/sheets.js';
import { ALL_COLUMNS, TABS } from '../src/export/columns.js';

const doc = await openDoc();
const sheet = doc.sheetsByTitle[TABS.leads]!;

await sheet.loadCells({
  startRowIndex: 0, endRowIndex: 4,
  startColumnIndex: 0, endColumnIndex: ALL_COLUMNS.length,
});

const letter = (i: number) => String.fromCharCode(65 + i) + (i >= 26 ? '' : '');

console.log('── заголовки ──');
for (let c = 0; c < ALL_COLUMNS.length; c++) {
  const got = String(sheet.getCell(0, c).value ?? '');
  const want = ALL_COLUMNS[c];
  const mark = got === want ? '✓' : '✗';
  console.log(` ${mark} ${letter(c).padEnd(3)} ${got.padEnd(24)} ${got === want ? '' : `(очікував "${want}")`}`);
}

console.log('\n── зразок рядка ──');
const idx = ALL_COLUMNS.indexOf('Складність розробки');
const brief = ALL_COLUMNS.indexOf('Опис для продажника');
for (let r = 1; r <= 2; r++) {
  console.log(`\n${sheet.getCell(r, 1).value}`);
  console.log(`  складність: ${sheet.getCell(r, idx).value}`);
  console.log(`  опис: ${String(sheet.getCell(r, brief).value ?? '').slice(0, 160)}…`);
}
