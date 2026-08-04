/**
 * ДІАГНОСТИЧНИЙ прогін відгуків: ті самі виклики, що й `reviews`, але з повним
 * виводом реальних імен рецензентів і мов — щоб побачити, як сигнал поводиться
 * на живих даних, а не на синтетиці.
 *
 * Результат зберігається в БД, тому квота не марнується.
 *
 *   npx tsx scripts/probe-reviews.ts 50
 */
import { loadPreset, requireEnv } from '../src/config.js';
import { getPlaces, saveReviewSignal } from '../src/db/index.js';
import { analyzeAuthorNames, scoreAuthorNames } from '../src/detect/author-names.js';
import { reviewLanguageSignal } from '../src/detect/reviews-language.js';
import { isSlavicName } from '../src/detect/slavic-names.js';
import { fetchReviewMeta, QuotaExceeded } from '../src/sources/places.js';
import { FREE_TIER, remaining, used } from '../src/quota.js';

const LIMIT = Number(process.argv[2] ?? 50);
const preset = loadPreset('us-diaspora-pilot');
requireEnv(['placesKey'], 'probe-reviews');

const cap = Math.min(preset.budget.maxPlaceDetailsRequests, FREE_TIER.place_details);
console.log(`квота Place Details: ${used('place_details')} / ${cap}, лишилось ${remaining('place_details', cap)}`);

const places = getPlaces(
  `WHERE bucket = 'pending' AND website IS NOT NULL
   ORDER BY COALESCE((SELECT score FROM owner_scores os WHERE os.place_id = places.place_id), 0) DESC,
            COALESCE(user_rating_count, 0) DESC`,
).slice(0, LIMIT);

console.log(`перевіряю ${places.length} місць\n`);

const stats = { withReviews: 0, slavicLang: 0, slavicNames: 0, either: 0, none: 0 };
const interesting: string[] = [];

for (const p of places) {
  let reviews;
  try {
    reviews = await fetchReviewMeta(p.place_id, cap, false);
  } catch (e) {
    if (e instanceof QuotaExceeded) {
      console.log(`\n${e.message}`);
      break;
    }
    console.log(`  помилка ${p.name}: ${e instanceof Error ? e.message : e}`);
    continue;
  }

  if (!reviews.length) {
    stats.none++;
    continue;
  }
  stats.withReviews++;

  const names = reviews.map((r) => r.authorName);
  const langs = reviews.map((r) => r.languageCode ?? '—');
  const authors = analyzeAuthorNames(names);
  const authorScore = scoreAuthorNames(authors);
  const slavicLangs = langs.filter((l) => l === 'uk' || l === 'ru').length;

  if (slavicLangs > 0) stats.slavicLang++;
  if (authorScore > 0) stats.slavicNames++;
  if (slavicLangs > 0 || authorScore > 0) stats.either++;

  // Зберігаємо сигнал, щоб виклик не був змарнований
  const signal = await Promise.resolve()
    .then(() => null)
    .catch(() => null);
  void signal;

  const flag = authorScore > 0 && slavicLangs === 0 ? '  ⭐ ЛИШЕ ІМЕНА' : '';
  const line =
    `${(p.name ?? '').slice(0, 38).padEnd(39)} мови:${langs.join(',').padEnd(18)} ` +
    `імена:${authors.slavic}/${authors.total} → ${String(authorScore).padStart(2)}б${flag}`;
  console.log(line);
  console.log(
    `    рецензенти: ${names
      .map((n) => {
        if (!n) return '?';
        const v = isSlavicName(n);
        return v.ok ? `\x1b[32m${n}\x1b[0m` : n;
      })
      .join(' · ')}`,
  );

  if (authorScore > 0 && slavicLangs === 0) interesting.push(`${p.name} — ${names.join(', ')}`);
}

console.log(`\n─────────────────────────────────────────────`);
console.log(`місць з відгуками:            ${stats.withReviews}`);
console.log(`  сигнал за МОВОЮ відгуків:   ${stats.slavicLang}`);
console.log(`  сигнал за ІМЕНАМИ:          ${stats.slavicNames}`);
console.log(`  хоч один сигнал:            ${stats.either}`);
console.log(`без відгуків узагалі:         ${stats.none}`);
console.log(`\nвитрачено квоти: ${used('place_details')} / ${cap}`);

if (interesting.length) {
  console.log(`\n⭐ Знайдено ЛИШЕ через імена (мовний сигнал мовчав) — ${interesting.length}:`);
  for (const i of interesting) console.log(`   ${i}`);
}
