/**
 * Рахує мовний скор для бакета NO_SITE.
 *
 * Ці записи ніколи не проходили оцінювання: `audit` бере лише місця з сайтом,
 * тож 906 з 909 не мали жодного балу — вкладка була неранжованою купою, хоча
 * назва бізнесу працює й без сайту.
 *
 * Жодного платного виклику: усе рахується з даних, які вже є в базі.
 * Без --apply нічого не пише.
 */
import { getPlaces, saveOwnerScore, setBucket } from '../src/db/index.js';
import { loadPreset } from '../src/config.js';
import { nameSignal } from '../src/detect/name-signal.js';
import { scoreOwner } from '../src/score/owner.js';
import { log } from '../src/util/log.js';

const APPLY = process.argv.includes('--apply');
const preset = loadPreset('us-diaspora-pilot');
const excluded = new Set(preset.filters.excludeTypes);

const safeTypes = (json: string | null | undefined): string[] => {
  if (!json) return [];
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
};

const places = getPlaces("WHERE bucket = 'no_site'");

let scored = 0;
let nonCommercial = 0;
const dist: Record<string, number> = {};

for (const p of places) {
  /*
   * Некомерційні заклади перевіряємо і тут. Вони не проходили жодного фільтра,
   * бо потрапляли в no_site ще до стадії аудиту — і «Ukrainian Cultural Center»
   * зі своїм ідеальним мовним сигналом опинився б на першому місці списку.
   */
  const bad = safeTypes(p.types_json).find((t) => excluded.has(t));
  if (bad) {
    nonCommercial++;
    if (APPLY) setBucket(p.place_id, 'rejected', `некомерційний заклад (${bad})`);
    continue;
  }

  const nm = nameSignal(p.name, '');
  const owner = scoreOwner({
    site: null,
    reviews: null,
    name: nm,
    declaredEvidence: [],
    thresholds: {
      lead: preset.thresholds.ownerScoreLead,
      manual: preset.thresholds.ownerScoreManual,
    },
  });

  if (APPLY) saveOwnerScore(p.place_id, owner.score, owner.lang, owner.evidence);
  scored++;

  const k =
    owner.score >= 30 ? 'a 30+ сильний' :
    owner.score >= 20 ? 'b 20-29 добрий' :
    owner.score >= 10 ? 'c 10-19 слабкий' :
    owner.score > 0 ? 'd 1-9 ледь' : 'e 0 нічого';
  dist[k] = (dist[k] ?? 0) + 1;
}

console.log(`NO_SITE: ${places.length} записів`);
console.log(`  некомерційних (у rejected): ${nonCommercial}`);
console.log(`  оцінено: ${scored}\n`);
for (const [k, v] of Object.entries(dist).sort()) console.log(`  ${String(v).padStart(4)} ${k}`);

console.log('');
if (APPLY) log.ok('скори записано — далі npm run export');
else log.info('попередній перегляд. Запусти з --apply');
