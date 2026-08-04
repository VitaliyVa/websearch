import type { Evidence, LangSignal, ReviewSignal } from '../types.js';
import type { NameSignal } from '../detect/name-signal.js';

export interface OwnerScore {
  score: number;
  lang: 'uk' | 'ru' | 'cyr' | null;
  evidence: Evidence[];
  exclusion: string | null;
  bucket: 'leads' | 'manual' | 'rejected';
}

export interface OwnerInput {
  site: LangSignal | null;
  reviews: ReviewSignal | null;
  name: NameSignal | null;
  /**
   * Докази наявності окремої /ru або /uk версії — hreflang, підтверджений
   * пробінг роутів, Accept-Language. Сигнал сильніший за кирилицю на головній.
   */
  declaredEvidence?: Evidence[];
  thresholds: { lead: number; manual: number };
}

/**
 * Зведений скор «власник говорить укр/рос».
 *
 * Ключова логіка: окрема /ru або /uk версія сайту — СИЛЬНІШИЙ сигнал, ніж
 * кирилиця на головній. Кирилиця може означати просто свіжий бізнес; окрема
 * мовна версія означає свідоме рішення обслуговувати слов'яномовних клієнтів,
 * тобто саме того, кому продажник подзвонить рідною мовою.
 *
 * Відгуки — єдиний сигнал, що бачить асимільований бізнес з англомовним сайтом.
 * Тому вони не замінюються сайтовими сигналами, а доповнюють їх.
 */
export function scoreOwner(input: OwnerInput): OwnerScore {
  const evidence: Evidence[] = [];

  // ── жорсткі виключення
  if (input.site?.hardExclusion) {
    return {
      score: 0, lang: null, exclusion: input.site.hardExclusion, bucket: 'rejected',
      evidence: input.site.evidence,
    };
  }
  if (input.name?.exclusion) {
    return {
      score: 0, lang: null, exclusion: input.name.exclusion, bucket: 'rejected',
      evidence: input.name.evidence,
    };
  }

  let score = 0;

  // Мовні версії сайту (декларовані / підтверджені пробінгом / Accept-Language).
  // Беремо НАЙСИЛЬНІШИЙ з трьох, а не суму — це один і той самий факт,
  // знайдений трьома способами.
  const versionEvidence = input.declaredEvidence ?? [];
  const strongestVersion = versionEvidence.reduce<Evidence | null>(
    (best, e) => (!best || e.weight > best.weight ? e : best),
    null,
  );
  if (strongestVersion) {
    score += strongestVersion.weight;
    evidence.push(strongestVersion);
    // Другорядні докази тієї ж природи додаємо з вагою 0 — щоб продажник бачив,
    // але щоб вони не роздували скор.
    for (const e of versionEvidence) {
      if (e !== strongestVersion) evidence.push({ ...e, weight: 0 });
    }
  }

  // Кирилиця / месенджери / телефони — незалежні сигнали, сумуються
  if (input.site) {
    for (const e of input.site.evidence) {
      score += e.weight;
      evidence.push(e);
    }
  }

  // Відгуки
  if (input.reviews) {
    for (const e of input.reviews.evidence) {
      score += e.weight;
      evidence.push(e);
    }
  }

  // Назва бізнесу
  if (input.name) {
    for (const e of input.name.evidence) {
      score += e.weight;
      evidence.push(e);
    }
  }

  score = Math.max(0, Math.min(100, Math.round(score)));

  const lang =
    input.site?.lang ??
    (input.reviews?.preferredLang as 'uk' | 'ru' | null) ??
    (strongestVersion?.detail?.includes('укр') ? 'uk' : strongestVersion ? 'ru' : null);

  const bucket: OwnerScore['bucket'] =
    score >= input.thresholds.lead ? 'leads'
    : score >= input.thresholds.manual ? 'manual'
    : 'rejected';

  return { score, lang, evidence, exclusion: null, bucket };
}

/** Короткий людський опис доказів для колонки в таблиці. */
export function formatEvidence(ev: Evidence[]): string {
  return ev
    .filter((e) => e.detail)
    .map((e) => (e.weight > 0 ? `${e.detail} (+${e.weight})` : `${e.detail}`))
    .join('; ');
}
