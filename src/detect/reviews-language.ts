import { fetchReviewMeta } from '../sources/places.js';
import { analyzeAuthorNames, scoreAuthorNames } from './author-names.js';
import type { Evidence, ReviewSignal } from '../types.js';

const EMPTY: ReviewSignal = {
  score: 0, ratio: null, sampleSize: 0, preferredLang: null, recentSlavic: 0,
  authorSlavicRatio: null, authorCyrillicCount: 0, evidence: [],
};

/** Стеля сумарного внеску відгуків — має збігатися з MAX_REVIEW_BOOST в audit.ts. */
const MAX_TOTAL = 70;

const THREE_YEARS_MS = 3 * 365 * 24 * 60 * 60 * 1000;

/**
 * Мовний сигнал з Google-відгуків.
 *
 * Це ЄДИНИЙ сигнал, який бачить асимільований діаспорний бізнес: українець,
 * що відкрив стоматологію в Чикаго 15 років тому, має англомовний сайт без
 * кирилиці й без Viber — але половина його відгуків російською/українською,
 * бо клієнтура своя.
 *
 * ⚠️ Places API віддає МАКСИМУМ 5 відгуків, тому ratio — це вибірка з 5.
 * Статистично шумно, тому сигнал зважений помірно і ніколи не є єдиним.
 */
export async function reviewLanguageSignal(
  placeId: string,
  quotaCap: number,
  allowPaid = false,
): Promise<ReviewSignal> {
  const reviews = await fetchReviewMeta(placeId, quotaCap, allowPaid);
  if (reviews.length === 0) return EMPTY;

  const langs = reviews.map((r) => r.languageCode?.toLowerCase() ?? 'und');
  const uk = langs.filter((l) => l === 'uk').length;
  const ru = langs.filter((l) => l === 'ru').length;
  const slavic = uk + ru;
  const ratio = slavic / langs.length;

  const cutoff = Date.now() - THREE_YEARS_MS;
  const recentSlavic = reviews.filter((r) => {
    const l = r.languageCode?.toLowerCase();
    if (l !== 'uk' && l !== 'ru') return false;
    const t = r.publishTime ? Date.parse(r.publishTime) : NaN;
    return Number.isFinite(t) && t > cutoff;
  }).length;

  // Одностайність важить більше, ніж просто «є слов'янські відгуки».
  // 5 з 5 відгуків українською для стоматології в Чикаго — доказ сильніший,
  // ніж тег hreflang: це означає, що вся клієнтура своя. Такий бізнес мусить
  // мати шанс стати лідом навіть з повністю англомовним сайтом і нейтральною
  // назвою — інакше найцінніший сегмент (асимільований, з грошима) недосяжний.
  /*
   * Ваги знижені після живого прогону на 44 місцях.
   *
   * Вихідна гіпотеза була: «в українського бізнесу в Чикаго відгуки українською».
   * Дані її спростували — languageCode повернувся `en` у 44 випадках із 44,
   * навіть там, де рецензентку звуть Марта Матвійчук. Діаспора в США пише
   * відгуки англійською.
   *
   * Сигнал лишаємо (він може спрацювати на свіжій хвилі після 2022), але
   * основну вагу віддано іменам рецензентів — єдиному, що реально працює.
   */
  let score = 0;
  if (ratio >= 0.8) score = 25;
  else if (ratio >= 0.6) score = 20;
  else if (ratio >= 0.4) score = 15;
  else if (ratio >= 0.25) score = 10;

  if (score > 0 && recentSlavic >= 2) score += 5;
  if (score > 0 && recentSlavic === 0) score = Math.round(score * 0.5);

  const evidence: Evidence[] = [];
  if (score > 0) {
    evidence.push({
      signal: 'review_language',
      weight: score,
      detail:
        `${slavic}/${langs.length} відгуків ${uk >= ru ? 'укр' : 'рос'}` +
        (recentSlavic ? `, ${recentSlavic} за 3 роки` : ', усі старі'),
    });
  }

  /*
   * Імена рецензентів — незалежний сигнал.
   * Ловить бізнес, де відгуки написані АНГЛІЙСЬКОЮ (тому мовний сигнал вище
   * мовчить), але автори звуться Oksana Kovalenko і Dmytro Shevchenko.
   * Це найтиповіший профіль асимільованого діаспорного бізнесу — того самого,
   * у якого найбільше грошей і найгірший сайт.
   *
   * Самі імена НЕ зберігаються — лише частка. Це і вимога ToS Google щодо
   * контенту відгуків, і елементарна гігієна щодо персональних даних.
   */
  const authors = analyzeAuthorNames(reviews.map((r) => r.authorName));
  const authorScore = scoreAuthorNames(authors);

  if (authorScore > 0) {
    evidence.push({
      signal: 'review_author_names',
      weight: authorScore,
      detail:
        `${authors.slavic}/${authors.total} рецензентів зі слов'янськими іменами` +
        (authors.cyrillic ? `, ${authors.cyrillic} кирилицею` : ''),
    });
  }

  const total = Math.min(score + authorScore, MAX_TOTAL);

  return {
    score: total,
    ratio,
    sampleSize: langs.length,
    preferredLang:
      slavic > 0 ? (uk >= ru ? 'uk' : 'ru') : authors.lang,
    recentSlavic,
    authorSlavicRatio: authors.total ? authors.ratio : null,
    authorCyrillicCount: authors.cyrillic,
    evidence,
  };
}
