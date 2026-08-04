/**
 * Показує реальні ліди з бази для ручної перевірки якості.
 *   node scripts/show-leads.mjs [скільки]
 */
import { DatabaseSync } from 'node:sqlite';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const N = Number(process.argv[2] ?? 15);

const db = new DatabaseSync(resolve(ROOT, 'data', 'leads.db'), { readOnly: true });

const rows = db
  .prepare(
    `SELECT p.name, p.address, p.website, p.user_rating_count AS reviews, p.rating,
            p.metro_key, p.hood_name, p.niche_key, p.found_via,
            o.score AS lang, o.lang AS langCode, o.evidence_json,
            a.site_score, a.site_reasons, a.hours_min, a.hours_max
     FROM places p
     JOIN owner_scores o ON o.place_id = p.place_id
     LEFT JOIN site_audits a ON a.place_id = p.place_id
     WHERE p.bucket = 'leads'
     ORDER BY o.score DESC, p.user_rating_count DESC
     LIMIT ?`,
  )
  .all(N);

for (const r of rows) {
  const ev = JSON.parse(r.evidence_json ?? '[]')
    .filter((e) => e.detail)
    .map((e) => e.detail)
    .join('; ');
  console.log(`\n▸ ${r.name}`);
  console.log(`  ${r.address}`);
  console.log(`  ${r.website ?? '—'}`);
  console.log(
    `  мова ${r.lang} (${r.langCode ?? '?'}) | сайт ${r.site_score ?? '?'}/10 | ` +
      `${r.hours_min ?? '?'}-${r.hours_max ?? '?'} год | ${r.rating ?? '?'}★ ${r.reviews ?? 0} відгуків`,
  );
  console.log(`  знайдено: ${r.found_via} / ${r.niche_key ?? '—'} / ${r.hood_name ?? r.metro_key}`);
  console.log(`  докази: ${ev}`);
  if (r.site_reasons) console.log(`  чому такий сайт: ${r.site_reasons}`);
}

console.log(`\n(показано ${rows.length})`);
db.close();
