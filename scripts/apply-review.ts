/**
 * Застосовує рішення ручного розбору 47 кандидатів.
 *
 * БЕЗПЕКА. Нічого не видаляється. «Відхилити» означає перевести в бакет
 * `rejected`: рядок зникає з вкладки, але запис лишається в базі разом із
 * причиною, і будь-яке рішення відкочується одним UPDATE. Асиметрія тут
 * навмисна — помилково відкинутий лід не повертається сам, а помилково
 * залишений коштує продажнику одну хвилину.
 *
 * Рішення ухвалені за двома незалежними перевірками: чи справжній мовний
 * сигнал (докази в базі) і чи вартий сайт заміни (замір прийомів верстки,
 * звірений з візуальним оглядом 11 сайтів — збіг 9/11).
 *
 * Запуск без --apply лише друкує, що станеться.
 */
import { getPlaces, setBucket } from '../src/db/index.js';
import { log } from '../src/util/log.js';

const APPLY = process.argv.includes('--apply');

/**
 * placeId вказуємо там, де назва неоднозначна.
 *
 * Два різні бізнеси називаються CDEK: російський cdek.ru (вже відхилений) і
 * американський cdekus.com. Пошук за назвою знайшов би обидва, тому такі
 * випадки адресуємо ключем, а не текстом.
 */
type Move = { name: string; placeId?: string; to: 'leads' | 'rejected' | 'no_site'; why: string };

const MOVES: Move[] = [
  // ── У ЛІДИ: мова підтверджена + сайт зроблено застарілими прийомами
  {
    name: 'Ukrainian Village Veterinary Center',
    to: 'leads',
    why: 'ручний розбір: Bootstrap 3 + FontAwesome 4 + фікс. ширина + float-верстка; власник Danylo Butenko, 227 відгуків',
  },
  {
    name: 'Law Office of Aziz Juraev',
    to: 'leads',
    why: 'ручний розбір: FontAwesome 4 + float-верстка ×71 + фікс. ширина; сайт російськомовний, 103 відгуки',
  },
  {
    name: 'Irina Kiblitsky',
    to: 'leads',
    why: 'ручний розбір: jQuery 1.11.1 (2014 рік) + FontAwesome 4 + float ×109; прізвище власниці на сайті',
  },
  {
    name: 'A&M Carriers',
    to: 'leads',
    why: 'ручний розбір: сітка Bootstrap 3 + фікс. ширина + копірайт 2023',
  },

  // ── БЕЗ САЙТУ: «сайт» насправді профіль на чужій платформі → інший оффер
  {
    name: 'Damar Bakery',
    to: 'no_site',
    why: 'ручний розбір: «сайт» — профіль в Instagram, свого сайту немає (121 відгук)',
  },
  {
    name: 'Shirin International Market',
    to: 'no_site',
    why: 'ручний розбір: «сайт» — профіль в Instagram, свого сайту немає (115 відгуків)',
  },
  {
    name: 'Sebona Euro Deli',
    to: 'no_site',
    why: 'ручний розбір: «сайт» — профіль в Instagram, свого сайту немає (51 відгук)',
  },

  // ── ВІДХИЛЕНО: сайт сучасний, переробляти нема чого
  ...([
    ['Century Medical & Dental Center', 82],
    ['NovaMed Urgent Care', 76],
    ['Law Offices of Marina Shepelsky', 82],
    ['Davlatov Law Firm', 80],
    ['Alina Kats', 77],
    ['Law Offices of Farrukh Nuridinov', 80],
    ['Brooklyn Immigration Lawyer', 97],
    ['USKO Shipping', 84],
    ['Independent Repair Services', 93],
    ['Law Offices of Tzvetelina Boynovska', 86],
    ['Modern Law Group', 100],
    ['Kats Immigration Law', 77],
    ['Vroom Vroom Movers', 80],
    ['Immigration Law Office Meyerovich', 88],
    ['V&S Quality Construction', 100],
    ['Family Physician in Coney Island', 100],
    ['IDCC Health Services Family Medicine', 100],
    ['George Khazanovskiy', 100],
    ['Urologist Alexander Lipyansky', 77],
  ] as [string, number][]).map(([name, score]) => ({
    name,
    to: 'rejected' as const,
    why: `ручний розбір: сайт сучасний (${score}/100 за прийомами верстки) — переробляти нема чого`,
  })),

  // ── ВІДХИЛЕНО, адресовані ключем через збіг назв
  {
    name: 'CDEK US (cdekus.com)',
    placeId: 'ChIJ4xm2cHshm4AR-xRPVFgzLWs',
    to: 'rejected',
    why: 'ручний розбір: сайт сучасний (88/100), копірайт 2026 — переробляти нема чого',
  },
  {
    name: 'Health Brokers',
    placeId: 'ChIJ4SDp9-lFwokRcbxFfXs-z_s',
    to: 'rejected',
    why: 'ручний розбір: сайт сучасний (88/100), копірайт 2026 — переробляти нема чого',
  },

  // ── ВІДХИЛЕНО окремо: мовний сигнал хибний
  {
    name: 'Joong Boo Market',
    to: 'rejected',
    why: 'ручний розбір: корейський супермаркет (Asian grocery store). Робоча ?lang=ru означає, що вони ОБСЛУГОВУЮТЬ російськомовних, а не що власник російськомовний',
  },
];

let moved = 0;
let missing = 0;

for (const m of MOVES) {
  // За ключем, якщо назва неоднозначна; інакше LIKE з екрануванням
  const safe = m.name.replace(/'/g, "''");
  const found = m.placeId
    ? getPlaces(`WHERE place_id = '${m.placeId}'`)
    : getPlaces(`WHERE name LIKE '${safe}%'`);

  if (!found.length) {
    log.warn(`не знайдено: ${m.name}`);
    missing++;
    continue;
  }
  if (found.length > 1) {
    log.warn(`${m.name}: збігів ${found.length} — пропускаю, щоб не зачепити зайве`);
    missing++;
    continue;
  }

  const p = found[0]!;
  if (p.bucket === m.to) {
    log.dim(`${p.name.slice(0, 40)} вже в ${m.to}`);
    continue;
  }

  console.log(`  ${p.bucket} → ${m.to.padEnd(8)} ${p.name.slice(0, 46)}`);
  if (APPLY) setBucket(p.place_id, m.to, m.why);
  moved++;
}

console.log('');
if (APPLY) log.ok(`переміщено: ${moved}${missing ? `, не знайдено: ${missing}` : ''}`);
else log.info(`це попередній перегляд. Буде переміщено: ${moved}. Запусти з --apply`);
