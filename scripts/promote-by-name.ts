/**
 * Ручний перегляд черги: назви, які я впізнав особисто.
 *
 * Це те, чого детектор не досягає. «Veselka» — не слово зі словника, а
 * легендарний український ресторан у Нью-Йорку; «NetCost Market» взагалі не
 * має слов'янських ознак у назві, але це мережа російських супермаркетів
 * у Брукліні. Такі речі впізнаються знанням ринку, а не регексом.
 *
 * КРИТЕРІЙ подвійний, як і для решти лідів:
 *   1) власник майже напевно україно- або російськомовний;
 *   2) сайт вартий заміни — оцінка ≤6 або сайт нечитаний.
 * Бізнес із сучасним сайтом сюди не потрапляє, навіть якщо власник свій.
 *
 * Вердикти закріплюються через setManualVerdict, тож переоцінка їх не скасує.
 * Без --apply лише друкує.
 */
import { getPlaces, getAudit, setManualVerdict } from '../src/db/index.js';
import { log } from '../src/util/log.js';

const APPLY = process.argv.includes('--apply');

interface Pick {
  q: string;
  why: string;
  /** Для пострадянських, але неслов'янських громад — мітка чесна, вага нижча */
  softer?: boolean;
}

const PICKS: Pick[] = [
  { q: 'Veselka', why: 'легендарний український ресторан у Нью-Йорку (Веселка), працює з 1954' },
  { q: 'NetCost Market', why: 'мережа російських/східноєвропейських супермаркетів у Брукліні' },
  { q: 'Tatiana Restaurant', why: 'ресторан на Брайтон-Біч, класика російськомовної громади' },
  { q: 'Tryzub Ukrainian Kitchen', why: 'Тризуб — український ресторан в Українському селі, Чикаго' },
  { q: 'Old Lviv Restaurant', why: 'український ресторан «Старий Львів», Chicago Ave — Українське село' },
  { q: 'European Delicatessen', why: 'східноєвропейська гастрономія — типове брендування слов\'янських продуктових' },
  { q: 'Russian Vodka Room', why: 'російський заклад у Мангеттені' },
  { q: 'Gurman', why: '«Гурман» — російський ресторан на Coney Island Ave, Бруклін' },
  { q: 'Babushka Market', why: '«Бабушка» — назва однозначна' },
  { q: 'Varenyk House', why: '«Вареник» — українська кухня' },
  { q: 'Beryozka European Market', why: '«Берёзка» — класична назва слов\'янського продуктового' },
  { q: 'Euro Market', why: 'східноєвропейський продуктовий' },
  { q: 'Meest', why: 'Meest — українська посилкова служба; точка видачі обслуговує діаспору' },
  { q: 'Julia Skuibida', why: 'Скуйбіда — українське прізвище; агенція на Chicago Ave, Українське село' },
  { q: 'Valentina Gaiduchik', why: 'Гайдучик — українське прізвище у назві агенції' },
  { q: 'Alex Ilyaev', why: 'Ільяєв — бухарсько-єврейське прізвище, громада російськомовна' },

  // Пострадянські, але не слов'янські: та сама аудиторія за мовою ведення справ
  { q: 'Tandir Rokhat', why: 'центральноазійська кухня; громада в США веде справи російською', softer: true },
  { q: 'Mtskheta Restaurant', why: 'грузинський ресторан; діаспора переважно російськомовна', softer: true },
  { q: 'Baku Nights', why: 'азербайджанський заклад; спілкування переважно російською', softer: true },
];

let moved = 0;
let skippedGoodSite = 0;
let notFound = 0;

for (const pick of PICKS) {
  const safe = pick.q.replace(/'/g, "''");
  const found = getPlaces(`WHERE name LIKE '${safe}%' AND bucket IN ('manual','pending')`);

  if (!found.length) {
    log.dim(`не в черзі: ${pick.q}`);
    notFound++;
    continue;
  }

  for (const p of found) {
    const ar = getAudit(p.place_id);
    const a = ar ? JSON.parse(ar.audit_json) : null;
    const unreadable = !a || !!a.fetchError;
    const score = ar?.site_score ?? 10;

    // Сучасний сайт — не лід, хоч би хто був власником
    if (!unreadable && score > 6) {
      console.log(`  ⨯ ${String(p.user_rating_count ?? 0).padStart(4)} ${p.name.slice(0, 40).padEnd(42)} сайт ${score}/10 — не наш`);
      skippedGoodSite++;
      continue;
    }

    const state = unreadable ? 'сайт не прочитано' : `сайт ${score}/10`;
    console.log(`  ✓ ${String(p.user_rating_count ?? 0).padStart(4)} ${p.name.slice(0, 40).padEnd(42)} ${state}`);
    if (APPLY) {
      setManualVerdict(
        p.place_id,
        'leads',
        `ручний розбір: ${pick.why}. ${state}.${pick.softer ? ' Пострадянська громада, не слов\'яни — перевір перед дзвінком.' : ''}`,
      );
    }
    moved++;
  }
}

console.log('');
if (APPLY) log.ok(`переведено в Ліди: ${moved}`);
else log.info(`перегляд: буде переведено ${moved}`);
log.dim(`пропущено через сучасний сайт: ${skippedGoodSite}, немає в черзі: ${notFound}`);
