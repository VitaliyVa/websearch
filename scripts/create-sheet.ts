/**
 * Створює порожню таблицю від імені service account і видає доступ Editor
 * вказаному email. Одноразовий скрипт для первинного налаштування.
 *
 *   npx tsx scripts/create-sheet.ts <sa-key.json> <your@gmail.com>
 */
import { readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';

const [keyPath, shareWith] = process.argv.slice(2);
if (!keyPath || !shareWith) {
  console.error('Використання: npx tsx scripts/create-sheet.ts <sa-key.json> <email>');
  process.exit(1);
}

const sa = JSON.parse(readFileSync(keyPath, 'utf8')) as {
  client_email: string;
  private_key: string;
};

const auth = new JWT({
  email: sa.client_email,
  key: sa.private_key,
  scopes: [
    'https://www.googleapis.com/auth/spreadsheets',
    'https://www.googleapis.com/auth/drive',
  ],
});

const { token } = await auth.getAccessToken();
if (!token) throw new Error('не вдалось отримати access token для service account');

const headers = {
  Authorization: `Bearer ${token}`,
  'Content-Type': 'application/json',
};

// 1. Створюємо таблицю
const createRes = await fetch('https://sheets.googleapis.com/v4/spreadsheets', {
  method: 'POST',
  headers,
  body: JSON.stringify({
    properties: { title: 'Websearch — ліди (US diaspora)', locale: 'uk_UA' },
    sheets: [{ properties: { title: 'Leads' } }],
  }),
});

if (!createRes.ok) {
  throw new Error(`Sheets create ${createRes.status}: ${await createRes.text()}`);
}

const doc = (await createRes.json()) as { spreadsheetId: string; spreadsheetUrl: string };
console.log(`SHEET_ID=${doc.spreadsheetId}`);
console.log(`SHEET_URL=${doc.spreadsheetUrl}`);

// 2. Даємо доступ живій людині
const permRes = await fetch(
  `https://www.googleapis.com/drive/v3/files/${doc.spreadsheetId}/permissions?sendNotificationEmail=false`,
  {
    method: 'POST',
    headers,
    body: JSON.stringify({ role: 'writer', type: 'user', emailAddress: shareWith }),
  },
);

if (!permRes.ok) {
  console.error(`⚠ Не вдалось розшарити на ${shareWith}: ${permRes.status} ${await permRes.text()}`);
  console.error('  Таблиця створена, але доступ треба видати вручну.');
} else {
  console.log(`SHARED_WITH=${shareWith} (Editor)`);
}
