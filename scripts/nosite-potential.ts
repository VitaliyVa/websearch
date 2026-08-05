/**
 * Скільки сигналу можна витягти з NO_SITE без жодного платного виклику.
 *
 * Тільки читання: нічого не пише в базу і не чіпає квоту. Потрібно, щоб
 * відповісти на питання «чи можна відсортувати цю вкладку за ймовірністю»
 * числами, а не припущенням.
 */
import { getPlaces } from '../src/db/index.js';
import { nameSignal } from '../src/detect/name-signal.js';

const places = getPlaces("WHERE bucket = 'no_site'");

/**
 * Райони з високою щільністю громади. Це апріорна ймовірність, а не доказ:
 * бізнес на Брайтон-Біч частіше слов'янський, але сам по собі район нічого
 * не доводить, тому вага навмисно мала.
 */
const HOODS = /brighton|bensonhurst|sheepshead|gravesend|midwood|ukrainian village|avondale|niles|des plaines|west sacramento|citrus heights|rancho cordova|north highlands/i;

let withName = 0;
let withHood = 0;
const buckets: Record<string, number> = {};
const top: { name: string; score: number; reviews: number; why: string }[] = [];

for (const p of places) {
  const nm = nameSignal(p.name, '');
  const nameScore = nm?.score ?? 0;
  const hoodHit = HOODS.test(`${p.hood_name ?? ''} ${p.address ?? ''}`);

  if (nameScore > 0) withName++;
  if (hoodHit) withHood++;

  const combined = nameScore + (hoodHit ? 10 : 0);
  const k =
    combined >= 30 ? 'a 30+ сильний' :
    combined >= 15 ? 'b 15-29 середній' :
    combined > 0 ? 'c 1-14 слабкий' : 'd 0 нічого';
  buckets[k] = (buckets[k] ?? 0) + 1;

  if (combined >= 15) {
    top.push({
      name: p.name,
      score: combined,
      reviews: p.user_rating_count ?? 0,
      why: [nm?.evidence?.map((e) => e.detail).join('; '), hoodHit ? `район: ${p.hood_name ?? '—'}` : '']
        .filter(Boolean).join(' | '),
    });
  }
}

console.log(`NO_SITE: ${places.length} записів\n`);
console.log('── що дає безкоштовний сигнал ──');
for (const [k, v] of Object.entries(buckets).sort()) console.log(`  ${String(v).padStart(4)} ${k}`);
console.log('');
console.log(`  сигнал з назви:  ${withName}`);
console.log(`  сигнал з району: ${withHood}`);

console.log('\n── топ-20 за відгуками серед тих, хто отримав би сигнал ──');
for (const t of top.sort((a, b) => b.reviews - a.reviews).slice(0, 20)) {
  console.log(`  ${String(t.reviews).padStart(4)} відг · ${String(t.score).padStart(2)} балів · ${t.name.slice(0, 42).padEnd(44)}`);
  if (t.why) console.log(`       ${t.why.slice(0, 110)}`);
}
