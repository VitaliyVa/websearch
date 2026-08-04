/** Які типи Places мають конкретні місця — щоб точно розширити список виключень. */
import { DatabaseSync } from 'node:sqlite';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const db = new DatabaseSync(resolve(ROOT, 'data', 'leads.db'), { readOnly: true });

console.log('=== типи поточних лідів ===');
for (const r of db
  .prepare(
    `SELECT p.name, p.address, p.primary_type, p.types_json
     FROM places p JOIN owner_scores o ON o.place_id = p.place_id
     WHERE p.bucket='leads' ORDER BY o.score DESC LIMIT 25`,
  )
  .all()) {
  console.log(`${r.primary_type ?? '—'}  |  ${r.name.slice(0, 45)}`);
  console.log(`     types: ${JSON.parse(r.types_json ?? '[]').join(', ')}`);
}

console.log('\n=== найчастіші primary_type серед усіх pending/leads ===');
for (const r of db
  .prepare(
    `SELECT primary_type t, COUNT(*) c FROM places
     WHERE bucket IN ('leads','pending') AND primary_type IS NOT NULL
     GROUP BY t ORDER BY c DESC LIMIT 25`,
  )
  .all()) {
  console.log(String(r.c).padStart(5), r.t);
}

console.log('\n=== розкид по штатах (locationBias — м\'яка підказка, не обмеження) ===');
for (const r of db
  .prepare(
    `SELECT metro_key, COUNT(*) c FROM places WHERE bucket IN ('leads','pending') GROUP BY metro_key`,
  )
  .all()) {
  console.log(String(r.c).padStart(5), r.metro_key);
}
db.close();
