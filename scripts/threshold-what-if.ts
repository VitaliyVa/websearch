/**
 * Що буде, якщо змінити поріг ліда. Рахує по вже зібраних даних, без запитів.
 */
import { db } from '../src/db/index.js';

const rows = db()
  .prepare(
    `SELECT p.bucket, o.score, p.name, p.user_rating_count AS rev,
            (SELECT site_score FROM site_audits sa WHERE sa.place_id = p.place_id) AS site,
            (SELECT author_slavic_ratio FROM review_signals r WHERE r.place_id = p.place_id) AS ar,
            (SELECT author_cyrillic FROM review_signals r WHERE r.place_id = p.place_id) AS ac
     FROM places p JOIN owner_scores o ON o.place_id = p.place_id
     WHERE p.bucket IN ('leads','manual')`,
  )
  .all() as { bucket: string; score: number; name: string; rev: number; site: number; ar: number | null; ac: number | null }[];

console.log(`місць у Leads + Manual review: ${rows.length}\n`);

console.log('поріг   стало б лідів   приріст');
console.log('─'.repeat(40));
for (const t of [70, 65, 60, 55, 50, 45, 40]) {
  const n = rows.filter((r) => r.score >= t).length;
  const mark = t === 70 ? '  ← зараз' : '';
  console.log(`  ${String(t).padEnd(5)} ${String(n).padStart(9)} ${String(n - rows.filter((r) => r.score >= 70).length).padStart(10)}${mark}`);
}

console.log('\nхто саме додасться при порозі 55 (топ за відгуками):');
const added = rows
  .filter((r) => r.score >= 55 && r.score < 70)
  .sort((a, b) => (b.rev ?? 0) - (a.rev ?? 0))
  .slice(0, 12);
for (const r of added) {
  const authors = r.ar != null ? `${Math.round(r.ar * 100)}% слов. рецензентів${r.ac ? `, ${r.ac} кирилицею` : ''}` : 'відгуки не перевірялись';
  console.log(`  ${String(r.score).padStart(3)} бал | ${String(r.rev ?? 0).padStart(4)} відг | сайт ${r.site ?? '?'}/10 | ${r.name.slice(0, 38).padEnd(39)} ${authors}`);
}
