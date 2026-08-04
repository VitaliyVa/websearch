/** Показує згенеровані брифи, щоб оцінити їх якість очима перед експортом. */
import { getPlaces, getAudit, getPsi, getOwnerScore } from '../src/db/index.js';
import { buildBrief } from '../src/score/brief.js';
import { scoreSite } from '../src/score/quality.js';
import { difficultyFromHours, formatStars } from '../src/score/difficulty.js';
import { cityOf, stateOf } from '../src/filters/address.js';

const limit = Number(process.argv[2] ?? 6);
const places = getPlaces(
  `WHERE bucket='leads' ORDER BY COALESCE((SELECT site_score FROM site_audits sa WHERE sa.place_id=places.place_id),5) ASC LIMIT ${limit}`,
);

for (const p of places) {
  const ar = getAudit(p.place_id);
  const a = ar ? JSON.parse(ar.audit_json) : null;
  const pr = getPsi(p.place_id);
  const psi = pr
    ? { mobileScore: pr.mobile_score, desktopScore: pr.desktop_score, lcpMs: pr.lcp_ms, cls: pr.cls, fetchedAt: pr.fetched_at }
    : null;
  const own = getOwnerScore(p.place_id);
  const lang = own?.lang === 'uk' ? 'українська' : own?.lang === 'ru' ? 'російська' : '—';
  const d = difficultyFromHours(ar?.hours_min ?? null, ar?.hours_max ?? null);
  const loc = [cityOf(p.address), stateOf(p.address)].filter(Boolean).join(', ');

  console.log('━'.repeat(78));
  console.log(`${p.name}  |  сайт ${ar?.site_score}/10  |  ${d ? formatStars(d) : '—'}`);
  console.log(
    buildBrief({
      name: p.name,
      typeLabel: p.primary_type_label ?? '',
      location: loc,
      rating: p.rating ?? null,
      reviews: p.user_rating_count ?? null,
      website: p.website ?? null,
      audit: a,
      psi,
      langLabel: lang,
      datedMarkers: scoreSite(a, psi, !!p.website).datedMarkers,
      difficultyLabel: d?.label ?? null,
    }),
  );
}
