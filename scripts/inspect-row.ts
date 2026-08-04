/** Друкує сирі значення всіх колонок для одного ліда — для розбору зсувів. */
import { openDoc } from '../src/export/sheets.js';
import { ALL_COLUMNS, TABS } from '../src/export/columns.js';

const needle = process.argv[2] ?? 'Dolynka';

const doc = await openDoc();
const sheet = doc.sheetsByTitle[TABS.leads]!;

await sheet.loadCells({
  startRowIndex: 0, endRowIndex: sheet.rowCount,
  startColumnIndex: 0, endColumnIndex: ALL_COLUMNS.length,
});

for (let r = 1; r < sheet.rowCount; r++) {
  const name = String(sheet.getCell(r, 1).value ?? '');
  if (!name.toLowerCase().includes(needle.toLowerCase())) continue;

  console.log(`рядок ${r + 1}: ${name}\n`);
  for (let c = 0; c < ALL_COLUMNS.length; c++) {
    const cell = sheet.getCell(r, c);
    const v = cell.value;
    const shown = v === null || v === '' ? '∅' : String(v).slice(0, 90);
    console.log(`  ${String(c).padStart(2)} ${ALL_COLUMNS[c]!.padEnd(22)} ${shown}`);
  }
  break;
}
