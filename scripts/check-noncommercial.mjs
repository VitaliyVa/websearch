/** Чи не лишилось некомерційних закладів у лідах і черзі. */
import { DatabaseSync } from 'node:sqlite';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const db = new DatabaseSync(resolve(ROOT, 'data', 'leads.db'), { readOnly: true });

// Слова, що видають некомерційну природу навіть коли тип Places комерційний
const SUSPECT = new RegExp(
  [
    'church', 'cathedral', 'parish', 'orthodox', 'catholic', 'synagogue', 'temple', 'mosque',
    'consulate', 'embassy', 'ministry', 'foundation', 'association', 'society', 'scouting',
    'youth organization', 'community center', 'nonprofit', 'non-profit', 'charity',
    'museum', 'diocese', 'eparchy', 'shrine',
  ].join('|'),
  'i',
);

const rows = db
  .prepare(
    `SELECT name, primary_type, bucket FROM places
     WHERE bucket IN ('leads','pending','manual')`,
  )
  .all();

const hits = rows.filter((r) => SUSPECT.test(r.name));
console.log(`Всього в лідах/черзі: ${rows.length}`);
console.log(`Підозрілих за НАЗВОЮ (тип Places комерційний, тому фільтр не спіймав): ${hits.length}`);
for (const h of hits.slice(0, 25)) {
  console.log(`  [${h.bucket}] ${h.primary_type ?? '—'}  ${h.name.slice(0, 60)}`);
}

console.log('\n=== типи в поточних лідах ===');
for (const r of db
  .prepare(
    `SELECT primary_type t, COUNT(*) c FROM places WHERE bucket='leads' GROUP BY t ORDER BY c DESC`,
  )
  .all()) {
  console.log(String(r.c).padStart(4), r.t ?? '—');
}
db.close();
