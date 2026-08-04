/**
 * Що дав замір швидкості: як розподілились оцінки сайтів і скільки лідів
 * урятували маркери застарілості від відсіву за балом.
 */
import { getAudit, getPlaces, getPsi } from '../src/db/index.js';
import { loadPreset } from '../src/config.js';
import { scoreSite } from '../src/score/quality.js';
import type { SiteAudit } from '../src/types.js';

const preset = loadPreset('us-diaspora-pilot');
const MAX = preset.thresholds.siteScoreMaxForLead;

const places = getPlaces("WHERE bucket = 'leads' AND website IS NOT NULL");

let saved = 0;
let clean = 0;
const slow: { name: string; lcp: number; psi: number | null; score: number }[] = [];
const dist = new Map<number, number>();

for (const p of places) {
  const row = getAudit(p.place_id);
  const psiRow = getPsi(p.place_id);
  if (!row) continue;

  const audit: SiteAudit = JSON.parse(row.audit_json);
  const psi = psiRow
    ? {
        mobileScore: psiRow.mobile_score,
        desktopScore: psiRow.desktop_score,
        lcpMs: psiRow.lcp_ms,
        cls: psiRow.cls,
        fetchedAt: psiRow.fetched_at,
      }
    : null;

  const q = scoreSite(audit, psi, true);
  dist.set(q.score10, (dist.get(q.score10) ?? 0) + 1);

  // Лід із балом вище порогу лишився лідом тільки завдяки маркеру застарілості
  if (q.score10 > MAX && q.datedMarkers.length) saved++;
  if (q.score10 <= MAX) clean++;

  if (psi?.lcpMs && psi.lcpMs > 6000) {
    slow.push({
      name: p.name.slice(0, 40),
      lcp: Math.round(psi.lcpMs / 1000),
      psi: psi.mobileScore,
      score: q.score10,
    });
  }
}

console.log(`лідів із сайтами: ${places.length}\n`);

console.log('розподіл оцінки сайту:');
for (const s of [...dist.keys()].sort((a, b) => a - b)) {
  const n = dist.get(s)!;
  console.log(`  ${String(s).padStart(2)}/10  ${'█'.repeat(Math.max(1, Math.round(n / 2)))} ${n}`);
}

console.log(`\nпройшли поріг ≤${MAX}/10 самі:            ${clean}`);
console.log(`врятовані маркером застарілості:       ${saved}`);

if (slow.length) {
  console.log(`\nнайповільніші — найсильніший аргумент у продажу:`);
  for (const s of slow.sort((a, b) => b.lcp - a.lcp).slice(0, 12)) {
    console.log(`  LCP ${String(s.lcp).padStart(3)}с | PSI ${String(s.psi ?? '?').padStart(3)} | сайт ${s.score}/10 | ${s.name}`);
  }
}
