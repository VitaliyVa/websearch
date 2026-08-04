/**
 * Відбирає кандидатів з «Ручної перевірки» для ручного розбору.
 *
 * Сортування — за очікуваною користю: спершу ті, де мовний сигнал уже сильний
 * (лишилось вирішити долю сайту), потім ті, де сигнал межовий.
 */
import { existsSync } from 'node:fs';
import { getPlaces, getAudit, getOwnerScore, getPsi, getReviewSignal, getScreenshots } from '../src/db/index.js';

const limit = Number(process.argv[2] ?? 50);
const minScore = Number(process.argv[3] ?? 40);

interface Cand {
  placeId: string;
  name: string;
  type: string;
  city: string;
  website: string;
  reviews: number;
  rating: number | null;
  ownerScore: number;
  evidence: string;
  siteScore: number | null;
  reasons: string;
  builder: string;
  dated: boolean;
  psi: string;
  shot: boolean;
  cache: boolean;
  bucket: string;
}

const out: Cand[] = [];

for (const p of getPlaces("WHERE bucket IN ('manual','pending')")) {
  const own = getOwnerScore(p.place_id);
  const score = own?.score ?? 0;
  if (score < minScore) continue;

  const ar = getAudit(p.place_id);
  const a = ar ? JSON.parse(ar.audit_json) : null;
  const psi = getPsi(p.place_id);
  type Ev = { signal?: string; weight?: number; detail?: string };
  const ev: Ev[] = own?.evidence_json ? JSON.parse(own.evidence_json) : [];
  const rev = getReviewSignal(p.place_id);
  const revEv: Ev[] = rev?.evidence_json ? JSON.parse(rev.evidence_json) : [];

  out.push({
    placeId: p.place_id,
    name: p.name,
    type: p.primary_type_label ?? p.primary_type ?? '?',
    city: (p.address ?? '').replace(/,\s*(USA|United States)$/i, ''),
    website: p.website ?? '',
    reviews: p.user_rating_count ?? 0,
    rating: p.rating ?? null,
    ownerScore: score,
    evidence: [...ev, ...revEv]
      .map((e) => `${e.signal ?? '?'}+${e.weight ?? 0}: ${e.detail ?? ''}`)
      .join(' | '),
    siteScore: ar?.site_score ?? null,
    reasons: ar?.site_reasons ?? '',
    builder: [a?.builder, a?.cms, a?.modernFramework].filter(Boolean).join('/') || '—',
    dated: !!(a && (!a.hasViewportMeta || a.tableLayout || a.hasFlash || (a.footerYear && a.footerYear < 2021))),
    psi: psi ? `${psi.mobile_score ?? '?'}/${psi.desktop_score ?? '?'}` : '—',
    shot: !!getScreenshots(p.place_id),
    cache: existsSync(`cache/${p.place_id}.json`),
    bucket: p.bucket,
  });
}

out.sort((x, y) => y.ownerScore - x.ownerScore || y.reviews - x.reviews);

console.log(`кандидатів зі скором ≥${minScore}: ${out.length}, показую ${Math.min(limit, out.length)}\n`);

for (const [i, c] of out.slice(0, limit).entries()) {
  console.log(
    `${String(i + 1).padStart(3)}. ${c.name.slice(0, 46).padEnd(48)} скор ${String(c.ownerScore).padStart(3)} · ${String(c.reviews).padStart(4)} відг · сайт ${String(c.siteScore ?? '—').padStart(2)}/10 · ${c.dated ? 'застарілий' : 'сучасний  '} · ${c.builder.slice(0, 18).padEnd(19)} ${c.shot ? '📷' : '  '}${c.cache ? '💾' : '  '}`,
  );
  console.log(`     ${c.type} · ${c.city.slice(0, 60)}`);
  console.log(`     ${c.website}`);
  console.log(`     докази: ${c.evidence.slice(0, 150) || '—'}`);
  console.log('');
}

// Машиночитний зріз для наступних кроків
if (process.env.JSON_OUT) {
  const { writeFileSync } = await import('node:fs');
  writeFileSync(process.env.JSON_OUT, JSON.stringify(out.slice(0, limit), null, 2));
}
