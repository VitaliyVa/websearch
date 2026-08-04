/**
 * Збирає .env із JSON-ключа service account + переданих ключів API.
 * Приватний ключ ніде не друкується — читається з файлу і одразу пишеться в .env.
 *
 *   npx tsx scripts/write-env.ts <sa-key.json> [--places KEY] [--psi KEY] [--sheet ID]
 *
 * Викликається повторно: наявні значення зберігаються, передані — перезаписуються.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { resolve } from 'node:path';

const { values, positionals } = parseArgs({
  args: process.argv.slice(2),
  allowPositionals: true,
  options: {
    places: { type: 'string' },
    psi: { type: 'string' },
    sheet: { type: 'string' },
  },
});

const keyPath = positionals[0];
if (!keyPath) {
  console.error('Використання: npx tsx scripts/write-env.ts <sa-key.json> [--places K] [--psi K] [--sheet ID]');
  process.exit(1);
}

const sa = JSON.parse(readFileSync(keyPath, 'utf8')) as {
  client_email: string;
  private_key: string;
};

const envPath = resolve(process.cwd(), '.env');

// Читаємо існуючий .env, щоб не втратити вже заповнене
const current = new Map<string, string>();
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq === -1) continue;
    current.set(t.slice(0, eq).trim(), t.slice(eq + 1).trim());
  }
}

const set = (k: string, v: string | undefined) => {
  if (v !== undefined && v !== '') current.set(k, v);
  else if (!current.has(k)) current.set(k, '');
};

set('GOOGLE_PLACES_KEY', values.places as string | undefined);
set('GOOGLE_PSI_KEY', values.psi as string | undefined);
set('GOOGLE_SA_EMAIL', sa.client_email);
// Переводи рядка в приватному ключі екрануємо — config.ts їх розгортає назад
set('GOOGLE_SA_PRIVATE_KEY', `"${sa.private_key.replace(/\n/g, '\\n')}"`);
set('GOOGLE_SHEET_ID', values.sheet as string | undefined);
set('MAX_PLACES_REQUESTS', current.get('MAX_PLACES_REQUESTS') || '980');
set('MAX_DETAILS_REQUESTS', current.get('MAX_DETAILS_REQUESTS') || '950');
set('FETCH_CONCURRENCY', current.get('FETCH_CONCURRENCY') || '8');
set('CRAWLER_CONTACT', current.get('CRAWLER_CONTACT') || 'vistet1428@gmail.com');

const order = [
  'GOOGLE_PLACES_KEY',
  'GOOGLE_PSI_KEY',
  'GOOGLE_SA_EMAIL',
  'GOOGLE_SA_PRIVATE_KEY',
  'GOOGLE_SHEET_ID',
  'MAX_PLACES_REQUESTS',
  'MAX_DETAILS_REQUESTS',
  'FETCH_CONCURRENCY',
  'CRAWLER_CONTACT',
];

const out = [
  '# Згенеровано scripts/write-env.ts — не комітити',
  ...order.map((k) => `${k}=${current.get(k) ?? ''}`),
  '',
].join('\n');

writeFileSync(envPath, out, 'utf8');

console.log('.env оновлено:');
for (const k of order) {
  const v = current.get(k) ?? '';
  const shown =
    k.includes('PRIVATE_KEY') ? (v ? '<приватний ключ записано>' : '(порожньо)')
    : k.includes('KEY') && v ? `${v.slice(0, 10)}…${v.slice(-4)}`
    : v || '(порожньо)';
  console.log(`  ${k.padEnd(24)} ${shown}`);
}
