/**
 * Чи справжній сигнал telegram_contact.
 * Порівнюємо: спрацював регекс vs чи є РЕАЛЬНЕ посилання t.me у socials.
 */
import { DatabaseSync } from 'node:sqlite';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const db = new DatabaseSync(resolve(ROOT, 'data', 'leads.db'), { readOnly: true });

const rows = db
  .prepare(
    `SELECT p.name, p.website, a.audit_json, a.lang_json
     FROM site_audits a JOIN places p ON p.place_id = a.place_id
     WHERE a.lang_json LIKE '%telegram_contact%'`,
  )
  .all();

let withRealLink = 0;
const fakes = [];

for (const r of rows) {
  const audit = JSON.parse(r.audit_json);
  const hasReal = !!audit.socials?.telegram;
  if (hasReal) withRealLink++;
  else if (fakes.length < 15) fakes.push({ name: r.name, site: r.website });
}

console.log(`Спрацював telegram_contact:        ${rows.length}`);
console.log(`З них РЕАЛЬНЕ посилання t.me:      ${withRealLink}`);
console.log(`Тільки слово "telegram" у коді:    ${rows.length - withRealLink}  <-- підозрілі`);
console.log(`Хибних:                            ${Math.round(((rows.length - withRealLink) / Math.max(rows.length, 1)) * 100)}%\n`);

console.log('=== приклади без реального посилання ===');
for (const f of fakes) console.log(`  ${f.name.slice(0, 45).padEnd(46)} ${f.site ?? ''}`);
db.close();
