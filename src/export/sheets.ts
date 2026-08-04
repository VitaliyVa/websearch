import { GoogleSpreadsheet, type GoogleSpreadsheetWorksheet } from 'google-spreadsheet';
import { JWT } from 'google-auth-library';
import { env } from '../config.js';
import { log } from '../util/log.js';
import { ALL_COLUMNS, MACHINE_COL_COUNT, MACHINE_COLUMNS, TABS, type TabKey } from './columns.js';

export type SheetRow = (string | number)[];

const SCOPES = [
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/drive.file',
];

export async function openDoc(): Promise<GoogleSpreadsheet> {
  const jwt = new JWT({ email: env.saEmail, key: env.saPrivateKey, scopes: SCOPES });
  const doc = new GoogleSpreadsheet(env.sheetId, jwt);
  await doc.loadInfo();
  return doc;
}

async function ensureTab(doc: GoogleSpreadsheet, title: string): Promise<GoogleSpreadsheetWorksheet> {
  let sheet = doc.sheetsByTitle[title];
  if (!sheet) {
    sheet = await doc.addSheet({
      title,
      headerValues: [...ALL_COLUMNS],
      gridProperties: { rowCount: 2000, columnCount: ALL_COLUMNS.length, frozenRowCount: 1 },
    });
    log.ok(`Створено вкладку "${title}"`);
    return sheet;
  }

  // Заголовки могли поїхати — вирівнюємо ТІЛЬКИ машинну частину A..V,
  // людські заголовки не чіпаємо, раптом продажники їх перейменували.
  await sheet.loadCells({
    startRowIndex: 0, endRowIndex: 1,
    startColumnIndex: 0, endColumnIndex: MACHINE_COL_COUNT,
  });
  let changed = false;
  for (let c = 0; c < MACHINE_COL_COUNT; c++) {
    const cell = sheet.getCell(0, c);
    if (cell.value !== MACHINE_COLUMNS[c]) {
      cell.value = MACHINE_COLUMNS[c]!;
      cell.textFormat = { bold: true };
      changed = true;
    }
  }
  if (changed) await sheet.saveUpdatedCells();
  return sheet;
}

/** Мапа place_id -> індекс рядка (0-based, без шапки). Читаємо тільки колонку A. */
async function readKeyColumn(sheet: GoogleSpreadsheetWorksheet): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  const lastRow = sheet.rowCount;
  await sheet.loadCells({
    startRowIndex: 0, endRowIndex: lastRow,
    startColumnIndex: 0, endColumnIndex: 1,
  });
  for (let r = 1; r < lastRow; r++) {
    const v = sheet.getCell(r, 0).value;
    if (typeof v === 'string' && v.trim()) map.set(v.trim(), r);
  }
  return map;
}

/** Зелений = поганий сайт = гарячий лід. Сірий = сучасний сайт. */
function scoreColor(score: number): { red: number; green: number; blue: number } | undefined {
  if (score <= 3) return { red: 0.78, green: 0.94, blue: 0.78 };
  if (score <= 6) return { red: 1, green: 0.96, blue: 0.8 };
  if (score >= 8) return { red: 0.9, green: 0.9, blue: 0.9 };
  return undefined;
}

export interface SyncResult {
  inserted: number;
  updated: number;
  tab: string;
  /** place_id -> номер рядка (0-based), щоб запам'ятати розміщення в БД */
  rows: Map<string, number>;
}

/**
 * Ідемпотентний запис. Ключ — place_id у колонці A.
 * Пише виключно в A..V; усе, що правіше, лишається як є.
 */
export async function syncTab(
  doc: GoogleSpreadsheet,
  tabKey: TabKey,
  rows: SheetRow[],
  scoreColumnIndex = 10, // K — «Оцінка сайту 1-10»
): Promise<SyncResult> {
  const title = TABS[tabKey];
  const sheet = await ensureTab(doc, title);
  const existing = await readKeyColumn(sheet);

  let nextFree = 1;
  for (const rowIdx of existing.values()) nextFree = Math.max(nextFree, rowIdx + 1);

  const needRows = nextFree + rows.length + 10;
  if (needRows > sheet.rowCount) {
    await sheet.resize({ rowCount: needRows, columnCount: Math.max(sheet.columnCount, ALL_COLUMNS.length) });
  }

  // Один loadCells на весь машинний діапазон — далі тільки локальні присвоєння
  await sheet.loadCells({
    startRowIndex: 0, endRowIndex: needRows,
    startColumnIndex: 0, endColumnIndex: MACHINE_COL_COUNT,
  });

  let inserted = 0;
  let updated = 0;

  for (const row of rows) {
    const placeId = String(row[0] ?? '');
    if (!placeId) continue;

    let rowIdx = existing.get(placeId);
    if (rowIdx === undefined) {
      rowIdx = nextFree++;
      existing.set(placeId, rowIdx);
      inserted++;
    } else {
      updated++;
    }

    for (let c = 0; c < MACHINE_COL_COUNT; c++) {
      const cell = sheet.getCell(rowIdx, c);
      const value = row[c] ?? '';
      // Формули (=IMAGE / =HYPERLINK) треба класти саме як формулу
      if (typeof value === 'string' && value.startsWith('=')) {
        if (cell.formula !== value) cell.formula = value;
      } else if (cell.value !== value) {
        cell.value = value as string | number;
      }
    }

    const score = Number(row[scoreColumnIndex]);
    if (Number.isFinite(score)) {
      const color = scoreColor(score);
      if (color) sheet.getCell(rowIdx, scoreColumnIndex).backgroundColor = color;
    }
  }

  await sheet.saveUpdatedCells();
  return { inserted, updated, tab: title, rows: existing };
}

/**
 * Помічає рядки, що покинули вкладку: лід переїхав у Rejected після PSI,
 * або мовний сигнал переоцінено. Без цього продажник продовжував би дзвонити
 * по картці, яку система вже забракувала.
 *
 * Машинні колонки B..V гасяться, у B ставиться причина. Колонки W.. (нотатки
 * продажників) не чіпаються — історія роботи по ліду має пережити переоцінку.
 */
export async function markStaleRows(
  doc: GoogleSpreadsheet,
  tabKey: TabKey,
  staleRowIndexes: { rowIndex: number; movedTo: string }[],
): Promise<number> {
  if (!staleRowIndexes.length) return 0;

  const title = TABS[tabKey];
  const sheet = doc.sheetsByTitle[title];
  if (!sheet) return 0;

  const maxRow = Math.max(...staleRowIndexes.map((s) => s.rowIndex)) + 1;
  await sheet.loadCells({
    startRowIndex: 0, endRowIndex: maxRow,
    startColumnIndex: 0, endColumnIndex: MACHINE_COL_COUNT,
  });

  for (const { rowIndex, movedTo } of staleRowIndexes) {
    for (let c = 1; c < MACHINE_COL_COUNT; c++) {
      const cell = sheet.getCell(rowIndex, c);
      cell.value = c === 1 ? `⚠ більше не лід — переміщено до "${movedTo}"` : '';
      cell.backgroundColor = { red: 0.95, green: 0.9, blue: 0.9 };
    }
  }

  await sheet.saveUpdatedCells();
  return staleRowIndexes.length;
}

/** Службова вкладка: коли прогін, скільки знайдено, скільки квоти витрачено. */
export async function writeMeta(doc: GoogleSpreadsheet, lines: [string, string | number][]) {
  const title = TABS.meta;
  let sheet = doc.sheetsByTitle[title];
  if (!sheet) {
    sheet = await doc.addSheet({
      title,
      headerValues: ['Показник', 'Значення'],
      gridProperties: { rowCount: 100, columnCount: 2, frozenRowCount: 1 },
    });
  }
  await sheet.resize({ rowCount: Math.max(lines.length + 5, 20), columnCount: 2 });
  await sheet.loadCells({ startRowIndex: 0, endRowIndex: lines.length + 2, startColumnIndex: 0, endColumnIndex: 2 });

  sheet.getCell(0, 0).value = 'Показник';
  sheet.getCell(0, 1).value = 'Значення';
  sheet.getCell(0, 0).textFormat = { bold: true };
  sheet.getCell(0, 1).textFormat = { bold: true };

  lines.forEach(([k, v], i) => {
    sheet!.getCell(i + 1, 0).value = k;
    sheet!.getCell(i + 1, 1).value = v;
  });

  await sheet.saveUpdatedCells();
}
