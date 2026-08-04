import { setBucket } from '../db/index.js';
import type { Preset } from '../config.js';
import { hostOf } from '../util/text.js';
import { isUsAddress } from './address.js';

/** Мінімум, потрібний для дешевих фільтрів — підходить і RawPlace, і рядок з БД. */
export interface FilterInput {
  placeId: string;
  address: string | null;
  website: string | null;
  phone: string | null;
  userRatingCount: number | null;
  businessStatus: string | null;
  /** Типи закладу з Places (primaryType + types) */
  types: string[];
}

export type FilterVerdict =
  | { bucket: 'rejected'; reason: string }
  | { bucket: 'no_site'; reason: null }
  | { bucket: 'pending'; reason: null };

/**
 * L1 — дешеві фільтри, 0 API-викликів.
 * Виконуються одразу при вставці, щоб такі місця не потрапили у дорогі стадії.
 */
export function cheapFilter(p: FilterInput, preset: Preset): FilterVerdict {
  const f = preset.filters;

  if (p.businessStatus && p.businessStatus !== 'OPERATIONAL') {
    return { bucket: 'rejected', reason: `бізнес не працює (${p.businessStatus})` };
  }

  // Некомерційні заклади мають ідеальний мовний скор (двомовний сайт, кирилиця,
  // hreflang) і забивали б собою верх списку — але сайти вони не купують.
  const excluded = p.types.find((t) => f.excludeTypes.includes(t));
  if (excluded) {
    return { bucket: 'rejected', reason: `некомерційний заклад (${excluded})` };
  }

  const ratings = p.userRatingCount ?? 0;
  if (ratings < f.minUserRatingCount) {
    return { bucket: 'rejected', reason: `мало відгуків (${ratings} < ${f.minUserRatingCount})` };
  }

  if (f.requireUsAddress && !isUsAddress(p.address)) {
    return { bucket: 'rejected', reason: 'адреса не в США' };
  }

  const host = p.website ? hostOf(p.website) : '';
  if (host && f.excludeCountryTlds.some((tld) => host.endsWith(tld))) {
    return { bucket: 'rejected', reason: `домен ${host} — виключена країна` };
  }

  if (p.phone && f.excludePhonePrefixes.some((pref) => p.phone!.replace(/\s/g, '').startsWith(pref))) {
    return { bucket: 'rejected', reason: 'телефон виключеної країни' };
  }

  // Сайту нема — окремий сегмент, інший оффер, інша ціна
  if (!p.website) return { bucket: 'no_site', reason: null };

  return { bucket: 'pending', reason: null };
}

export function applyCheapFilter(p: FilterInput, preset: Preset): FilterVerdict {
  const v = cheapFilter(p, preset);
  setBucket(p.placeId, v.bucket, v.reason);
  return v;
}
