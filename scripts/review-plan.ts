/**
 * Зводить усе разом і пропонує рішення по кожному кандидату.
 *
 * Нічого не змінює — лише друкує таблицю для перевірки очима. Рішення
 * застосовує окремий скрипт, і тільки після того, як цю таблицю переглянули.
 */
import { readFileSync } from 'node:fs';
import { getPlaces, getOwnerScore, getAudit } from '../src/db/index.js';
import { modernityScore } from './score-modernity.js';

const probes = JSON.parse(readFileSync(process.argv[2]!, 'utf8'));
const cands = JSON.parse(readFileSync(process.argv[3]!, 'utf8'));

/** Сайт живе на чужій платформі — це не сайт, це профіль. Інший оффер. */
const SOCIAL_HOSTS = /instagram\.com|facebook\.com|ebay\.com|linktr\.ee/i;

type Decision = 'lead' | 'reject' | 'no_site' | 'keep';

const out: { n: number; name: string; decision: Decision; why: string; score: number; reviews: number }[] = [];

for (const [i, c] of cands.entries()) {
  const p = probes[i];
  const place = getPlaces(`WHERE place_id = '${c.placeId}'`)[0]!;
  const own = getOwnerScore(c.placeId);
  const ar = getAudit(c.placeId);
  const { score, why } = modernityScore(p);

  const blocked = !!p.error || /Challenge|Checking your browser|403|Forbidden/i.test(p.title ?? '');
  const social = SOCIAL_HOSTS.test(p.finalHost ?? '') || SOCIAL_HOSTS.test(c.website);

  let decision: Decision;
  let reason: string;

  if (social) {
    decision = 'no_site';
    reason = `«сайт» — профіль на ${p.finalHost ?? 'соцмережі'}, окремий оффер`;
  } else if (blocked) {
    decision = 'keep';
    reason = `сайт закритий захистом (${p.title ?? p.error}) — судити нема за чим`;
  } else if (score <= 45) {
    decision = 'lead';
    reason = `дизайн застарілий (${score}/100): ${why.filter((w) => w.startsWith('-')).join(', ')}`;
  } else if (score >= 76) {
    decision = 'reject';
    reason = `сайт сучасний (${score}/100) — переробляти нема чого`;
  } else {
    decision = 'keep';
    reason = `сіра зона (${score}/100) — рішення за людиною`;
  }

  out.push({
    n: i + 1,
    name: c.name,
    decision,
    why: reason,
    score,
    reviews: place.user_rating_count ?? 0,
  });
}

const order: Decision[] = ['lead', 'no_site', 'reject', 'keep'];
const label: Record<Decision, string> = {
  lead: '→ ЛІДИ',
  no_site: '→ БЕЗ САЙТУ',
  reject: '→ ВІДХИЛИТИ',
  keep: '= ЛИШИТИ В РУЧНІЙ',
};

for (const d of order) {
  const group = out.filter((x) => x.decision === d).sort((a, b) => b.reviews - a.reviews);
  console.log(`\n${label[d]}  (${group.length})`);
  for (const g of group) {
    console.log(`  ${String(g.n).padStart(2)} ${g.name.slice(0, 42).padEnd(44)} ${String(g.reviews).padStart(4)} відг`);
    console.log(`     ${g.why.slice(0, 130)}`);
  }
}

console.log(`\nразом: ${out.length}`);
