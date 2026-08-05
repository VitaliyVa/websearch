/**
 * Виділяє з NO_SITE тих, у кого мова підтверджена, в окремий бакет
 * `no_site_lead` → вкладка «Ліди без сайту».
 *
 * Поріг 26 обраний за фактичним розподілом, а не круглим числом: саме з нього
 * доказом стає щось однозначне — етнонім у назві, кирилиця, побутове слово в
 * транслітерації або зв'язка імені з прізвищем. Нижче йдуть «European deli»
 * (22) і пострадянські неслов'янські громади (14-16) — це вже здогад, і їм
 * місце у загальній черзі, а не серед готових лідів.
 *
 * Без --apply нічого не пише.
 */
import { getPlaces, getOwnerScore, setBucket } from '../src/db/index.js';
import { log } from '../src/util/log.js';

const APPLY = process.argv.includes('--apply');
const THRESHOLD = 26;

/**
 * Не бізнеси, а організації та топоніми. Типи Google їх не ловить
 * (`corporate_office`, `educational_institution`), тому виключаю за назвою —
 * побачив під час ручного перегляду списку.
 */
const NOT_A_BUSINESS = [
  'Ukrainian National Home',
  'Ukrainian Village',
];

let promoted = 0;
let skipped = 0;

for (const p of getPlaces("WHERE bucket = 'no_site'")) {
  const score = getOwnerScore(p.place_id)?.score ?? 0;
  if (score < THRESHOLD) continue;

  if (NOT_A_BUSINESS.some((n) => p.name.trim().toLowerCase().startsWith(n.toLowerCase()))) {
    console.log(`  пропуск (не бізнес): ${p.name}`);
    if (APPLY) setBucket(p.place_id, 'rejected', 'організація або топонім, не комерційний бізнес');
    skipped++;
    continue;
  }

  console.log(`  ${String(score).padStart(2)} · ${String(p.user_rating_count ?? 0).padStart(4)} відг · ${p.name.slice(0, 46)}`);
  if (APPLY) setBucket(p.place_id, 'no_site_lead', `мова підтверджена за назвою (скор ${score})`);
  promoted++;
}

console.log('');
if (APPLY) log.ok(`у «Ліди без сайту»: ${promoted}, відсіяно як не бізнес: ${skipped}`);
else log.info(`перегляд: буде переміщено ${promoted}, відсіяно ${skipped}. Запусти з --apply`);
