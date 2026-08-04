/**
 * Скільки лідів захищено маркерами застарілості від відсіву за швидкістю.
 * Показує, чи не вилетить більшість після PSI.
 */
import { getPlaces, getAudit, getPsi } from '../src/db/index.js';
import { scoreSite } from '../src/score/quality.js';
import type { SiteAudit } from '../src/types.js';

const places = getPlaces("WHERE bucket IN ('leads','manual') AND website IS NOT NULL");

let withMarkers = 0;
let without = 0;
const markerFreq = new Map<string, number>();
const unprotected: string[] = [];

for (const p of places) {
  const row = getAudit(p.place_id);
  if (!row) continue;
  const audit: SiteAudit = JSON.parse(row.audit_json);
  const psiRow = getPsi(p.place_id);
  const q = scoreSite(
    audit,
    psiRow
      ? {
          mobileScore: psiRow.mobile_score,
          desktopScore: psiRow.desktop_score,
          lcpMs: psiRow.lcp_ms,
          cls: psiRow.cls,
          fetchedAt: psiRow.fetched_at,
        }
      : null,
    true,
  );

  if (q.datedMarkers.length) {
    withMarkers++;
    for (const m of q.datedMarkers) markerFreq.set(m, (markerFreq.get(m) ?? 0) + 1);
  } else {
    without++;
    if (unprotected.length < 10) {
      unprotected.push(`${String(q.score10).padStart(2)}/10  ${p.name.slice(0, 44)}`);
    }
  }
}

console.log(`ліди + ручна черга з сайтами: ${places.length}\n`);
console.log(`захищені маркером застарілості: ${withMarkers}  (${Math.round((withMarkers / places.length) * 100)}%)`);
console.log(`  → їх НЕ можна відсіяти за швидкістю чи балом`);
console.log(`\nбез маркерів: ${without}  — тільки вони ризикують вилетіти після PSI\n`);

console.log('які маркери спрацьовують:');
for (const [m, c] of [...markerFreq.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(c).padStart(4)}  ${m}`);
}

if (unprotected.length) {
  console.log('\nприклади без маркерів (справді сучасні сайти):');
  for (const u of unprotected) console.log(`  ${u}`);
}
