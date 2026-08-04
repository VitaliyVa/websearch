/** Чому місця з високим мовним скором не потрапили в ліди. */
import { DatabaseSync } from 'node:sqlite';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MIN = Number(process.argv[2] ?? 70);
const db = new DatabaseSync(resolve(ROOT, 'data', 'leads.db'), { readOnly: true });

console.log(`=== місця з мовним скором >= ${MIN}: куди потрапили ===`);
for (const r of db
  .prepare(
    `SELECT p.bucket, p.reject_reason, COUNT(*) c
     FROM places p JOIN owner_scores o ON o.place_id = p.place_id
     WHERE o.score >= ? GROUP BY p.bucket, p.reject_reason ORDER BY c DESC`,
  )
  .all(MIN)) {
  console.log(`${String(r.c).padStart(4)}  [${r.bucket}] ${r.reject_reason ?? ''}`);
}

console.log(`\n=== конкретні, відсіяні НЕ за мовою ===`);
for (const r of db
  .prepare(
    `SELECT p.name, p.primary_type, p.reject_reason, o.score, p.website,
            a.site_score, p.user_rating_count AS rev
     FROM places p
     JOIN owner_scores o ON o.place_id = p.place_id
     LEFT JOIN site_audits a ON a.place_id = p.place_id
     WHERE o.score >= ? AND p.bucket = 'rejected'
     ORDER BY p.user_rating_count DESC LIMIT 20`,
  )
  .all(MIN)) {
  console.log(`  ${r.score} бал | сайт ${r.site_score ?? '?'}/10 | ${r.rev ?? 0} відгуків | ${r.primary_type ?? '—'}`);
  console.log(`     ${r.name.slice(0, 60)}  ${r.website ?? ''}`);
  console.log(`     ПРИЧИНА: ${r.reject_reason}`);
}

console.log(`\n=== усі причини відсіву по базі ===`);
for (const r of db
  .prepare(
    `SELECT reject_reason r, COUNT(*) c FROM places
     WHERE bucket='rejected' AND reject_reason IS NOT NULL
     GROUP BY r ORDER BY c DESC LIMIT 12`,
  )
  .all()) {
  console.log(String(r.c).padStart(5), r.r);
}
db.close();
