/**
 * Знаходить сторінку, на якій rescore зависає, і показує, який саме детектор
 * її не тягне. Кожен крок обмежений таймером — якщо не вклався, це винний.
 */
import { readCache } from '../src/audit/site.js';
import { getAudit, getPlaces } from '../src/db/index.js';
import { detectOwnerName } from '../src/detect/owner-name.js';
import { detectSiteLanguage } from '../src/detect/site-language.js';
import { detectTech, footerYear } from '../src/detect/tech.js';
import { extractEmails, extractSocials } from '../src/detect/contacts.js';
import { htmlToText } from '../src/util/text.js';

const STALE_MS = 10 * 60 * 1000;

const places = getPlaces("WHERE website IS NOT NULL AND stage != 'discovered'");

// rescore іде в тому ж порядку; шукаємо перший, який давно не оновлювався
let start = -1;
for (let i = 0; i < places.length; i++) {
  const row = getAudit(places[i]!.place_id);
  if (row && Date.now() - Date.parse(row.audited_at) > STALE_MS) {
    start = i;
    break;
  }
}

console.log(`перший необроблений: індекс ${start} з ${places.length}\n`);
if (start < 0) {
  console.log('усі оброблені — зависання не відтворюється');
  process.exit(0);
}

const time = (label: string, fn: () => unknown) => {
  const t = Date.now();
  try {
    fn();
  } catch (e) {
    console.log(`      ${label.padEnd(20)} ПОМИЛКА: ${e instanceof Error ? e.message : e}`);
    return;
  }
  const ms = Date.now() - t;
  const mark = ms > 1000 ? '  ← ПОВІЛЬНО' : '';
  console.log(`      ${label.padEnd(20)} ${String(ms).padStart(6)} мс${mark}`);
};

for (let i = start; i < Math.min(start + 5, places.length); i++) {
  const p = places[i]!;
  const cached = readCache(p.place_id);
  if (!cached?.html) {
    console.log(`${i}  ${p.name.slice(0, 40)} — кешу немає, пропуск`);
    continue;
  }

  const html = cached.html;
  console.log(`${i}  ${p.name.slice(0, 44)}   ${(html.length / 1024).toFixed(0)} КБ`);

  let text = '';
  time('htmlToText', () => (text = htmlToText(html)));
  time('detectTech', () => detectTech(html));
  time('footerYear', () => footerYear(html));
  time('detectSiteLanguage', () => detectSiteLanguage({ html, text, host: 'example.com' }));
  time('extractSocials', () => extractSocials(html));
  let emails: string[] = [];
  time('extractEmails', () => (emails = extractEmails(html)));
  time('detectOwnerName', () => detectOwnerName(html, emails));
  console.log('');
}
