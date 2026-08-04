/** Профіль черги «Ручна перевірка»: з чого вона складається і що там можна перевірити безкоштовно. */
import { existsSync } from 'node:fs';
import { getPlaces, getAudit, getOwnerScore, getPsi, getReviewSignal, getScreenshots } from '../src/db/index.js';

const rows = getPlaces("WHERE bucket IN ('manual','pending')");

const b = {
  total: rows.length,
  withSite: 0,
  audited: 0,
  withScreenshot: 0,
  withCache: 0,
  withReviewSignal: 0,
  withPsi: 0,
};

const ownerBuckets: Record<string, number> = {};
const reviewBuckets: Record<string, number> = {};
const reasons: Record<string, number> = {};

for (const p of rows) {
  if (p.website) b.withSite++;
  const a = getAudit(p.place_id);
  if (a) b.audited++;
  if (getScreenshots(p.place_id)) b.withScreenshot++;
  if (existsSync(`cache/${p.place_id}.json`)) b.withCache++;
  if (getReviewSignal(p.place_id)) b.withReviewSignal++;
  if (getPsi(p.place_id)) b.withPsi++;

  const own = getOwnerScore(p.place_id);
  const s = own?.score ?? 0;
  const k = s >= 55 ? '55+ (поріг ліда)' : s >= 40 ? '40-54' : s >= 25 ? '25-39' : s >= 10 ? '10-24' : '0-9';
  ownerBuckets[k] = (ownerBuckets[k] ?? 0) + 1;

  const r = p.user_rating_count ?? 0;
  const rk = r >= 200 ? '200+' : r >= 100 ? '100-199' : r >= 50 ? '50-99' : r >= 20 ? '20-49' : '5-19';
  reviewBuckets[rk] = (reviewBuckets[rk] ?? 0) + 1;

  const reason = (p as unknown as { bucket_reason?: string }).bucket_reason ?? '(без причини)';
  reasons[reason] = (reasons[reason] ?? 0) + 1;
}

console.log('── обсяг ──');
for (const [k, v] of Object.entries(b)) console.log(`  ${k.padEnd(18)} ${v}`);

console.log('\n── мовний скор ──');
for (const [k, v] of Object.entries(ownerBuckets).sort()) console.log(`  ${k.padEnd(18)} ${v}`);

console.log('\n── відгуки ──');
for (const [k, v] of Object.entries(reviewBuckets).sort()) console.log(`  ${k.padEnd(18)} ${v}`);

console.log('\n── причини потрапляння (топ 10) ──');
for (const [k, v] of Object.entries(reasons).sort((x, y) => y[1] - x[1]).slice(0, 10)) {
  console.log(`  ${String(v).padStart(5)}  ${k.slice(0, 90)}`);
}
