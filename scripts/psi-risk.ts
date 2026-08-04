/**
 * Скільки поточних лідів ризикують вилетіти після заміру швидкості.
 *
 * Поріг оцінки сайту застосовується ТІЛЬКИ коли PSI вже заміряний. Зараз
 * більшість лідів має 9-10/10 саме тому, що швидкість не міряна — після PSI
 * оцінка може як впасти (сайт повільний → лишається лідом), так і підтвердитись
 * (сайт справді нормальний → вилітає у Rejected).
 */
import { loadPreset } from '../src/config.js';
import { db } from '../src/db/index.js';

const preset = loadPreset('us-diaspora-pilot');
const MAX = preset.thresholds.siteScoreMaxForLead;

const rows = db()
  .prepare(
    `SELECT sa.site_score AS s, COUNT(*) AS c
     FROM places p JOIN site_audits sa ON sa.place_id = p.place_id
     WHERE p.bucket = 'leads' GROUP BY s ORDER BY s`,
  )
  .all() as { s: number; c: number }[];

console.log(`оцінки сайтів у поточних лідах (поріг для ліда: ≤${MAX}/10)\n`);
let safe = 0;
let risk = 0;
for (const x of rows) {
  const flag = x.s > MAX ? '  ← вилетить, якщо PSI підтвердить' : '  ← лишається';
  console.log(`  ${x.s}/10 : ${String(x.c).padStart(3)}${flag}`);
  if (x.s > MAX) risk += x.c;
  else safe += x.c;
}
console.log(`\n  гарантовано лишаються: ${safe}`);
console.log(`  під ризиком:           ${risk}`);
console.log(`\n  PSI знижує оцінку до −30 балів, тож частина з ${risk} впаде нижче порогу й лишиться лідами.`);
