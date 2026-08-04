import type { PsiResult, SiteAudit } from '../types.js';
import { isRetail, typeLabelUk } from '../export/type-labels.js';

/**
 * Короткий бриф для продажника: що за бізнес, що в нього за сайт, за що
 * зачепитись у розмові.
 *
 * Навмисно детермінований, а не «AI на око». Продажник читає ці рядки перед
 * дзвінком і буде на них посилатись уголос — тому кожне речення мусить
 * спиратись на заміряний факт. Вигадана деталь тут коштує дорожче за
 * відсутню: клієнт одразу чує, що дзвонить людина, яка сайт не відкривала.
 *
 * Звідси головне правило: якщо даних нема — речення просто не з'являється.
 * І друге, виведене з реальних помилок першої версії: якщо сигнал
 * неоднозначний, формулюємо його обережно, а не в найгучнішому прочитанні.
 */

export interface BriefInput {
  name: string;
  typeLabel: string;
  location: string;
  rating: number | null;
  reviews: number | null;
  website: string | null;
  audit: SiteAudit | null;
  psi: PsiResult | null;
  langLabel: string;
  datedMarkers: string[];
  difficultyLabel: string | null;
  /**
   * Вердикт scoreSite. Джерело правди про те, чи ми взагалі бачили сайт.
   *
   * Без нього бриф судив за статусом відповіді й пропускав заглушки
   * bot-protection, що віддаються з кодом 2xx: moskalenkogroup.com повертає
   * HTTP 202 зі 168 байтами, і бриф упевнено писав «сайт односторінковий,
   * без каталогу й форм» про сайт, який насправді адаптивний і робочий.
   */
  siteStatus?: 'ok' | 'dead' | 'blocked' | 'no_site';
}

const YEAR = new Date().getFullYear();

export function buildBrief(i: BriefInput): string {
  return [business(i), site(i), problems(i), hook(i)].filter(Boolean).join(' ');
}

/** 1. Хто це і чи вартий дзвінка. */
function business(i: BriefInput): string {
  const uk = typeLabelUk(i.typeLabel);
  const what = uk && uk !== '—' ? uk.toLowerCase() : 'бізнес';
  const where = i.location && i.location !== '—' ? `, ${i.location.replace(/\s*\(.*\)$/, '')}` : '';

  let social = '';
  if (i.rating != null && i.reviews) {
    social = ` — ${i.rating}★ з ${i.reviews} ${plural(i.reviews, 'відгуку', 'відгуків', 'відгуків')}`;
    // Багато відгуків = бізнес живий і має бюджет. Це найсильніший аргумент
    // «до кого дзвонити першим», тому виносимо його в перше речення.
    if (i.reviews >= 200) social += ', дуже помітний у своєму районі';
    else if (i.reviews >= 60) social += ', стабільний потік клієнтів';
  } else if (i.reviews) {
    social = ` — ${i.reviews} ${plural(i.reviews, 'відгук', 'відгуки', 'відгуків')}`;
  }

  const lang =
    i.langLabel === 'українська' ? ' Власники — українськомовні.'
    : i.langLabel === 'російська' ? ' Власники — російськомовні.'
    : i.langLabel.startsWith('кирилиця') ? ' У контактах кирилиця, мову точно не визначено.'
    : '';

  return `${cap(what)}${where}${social}.${lang}`;
}

/** 2. Що взагалі являє собою сайт. */
function site(i: BriefInput): string {
  if (!i.website) return 'Сайту немає взагалі — тільки картка в Google Maps.';

  const a = i.audit;
  if (!a) return 'Сайт вказано, але прочитати його не вдалось.';

  // Нас не пустили — отже про сайт ми не знаємо НІЧОГО. Жодних тверджень.
  if (i.siteStatus === 'blocked') {
    return 'Сайт закритий захистом від ботів — ми його не бачили, тому нічого про нього не стверджуємо. Відкрий очима перед дзвінком.';
  }

  if (a.fetchError || (a.httpStatus != null && a.httpStatus >= 500)) {
    /*
     * Обережне формулювання, бо тут легко збрехати.
     *
     * Якщо PSI зміг заміряти сторінку, значить Google її відкрив — сайт живий,
     * а впав саме НАШ робот (таймаут, TLS, блокування за User-Agent). Перша
     * версія в обох випадках писала «сайт не відкривається», і продажник із
     * цією фразою пішов би в дзвінок проти сайту, який чудово працює.
     */
    const googleSawIt = i.psi?.mobileScore != null || i.psi?.desktopScore != null;
    return googleSawIt
      ? 'Наш робот не зміг прочитати сайт, хоча Google його бачить — перед дзвінком відкрий очима.'
      : 'Сайт зазначений у Google, але не відкривається — фактично бізнес в інтернеті без вітрини.';
  }

  if (a.httpStatus != null && [401, 403, 406, 429, 451].includes(a.httpStatus)) {
    return 'Сайт закритий захистом від ботів — вміст треба глянути очима перед дзвінком.';
  }

  const bits: string[] = [];

  const platform = a.builder ?? a.cms ?? a.modernFramework;
  if (platform) bits.push(`зроблений на ${platform}`);
  else if (a.techStack.length) bits.push(`зібраний на ${a.techStack.slice(0, 2).join(' + ')}`);

  if (a.pageCount > 1) bits.push(`${a.pageCount} ${plural(a.pageCount, 'сторінка', 'сторінки', 'сторінок')}`);

  /*
   * Про «типи сторінок» згадуємо лише коли сайт справді шаблонний.
   *
   * uniquePageTypes рахує перший сегмент шляху, тож у «плоского» сайту, де всі
   * сторінки лежать у корені, кожна стає окремим типом: 50 сторінок → 46
   * «різних макетів». Це не факт про сайт, а артефакт вимірювання, і в брифі
   * він виглядав переконливою дурницею.
   */
  const templated = a.pageCount >= 6 && a.uniquePageTypes >= 3 && a.uniquePageTypes / a.pageCount <= 0.6;
  if (templated) bits.push(`${a.uniquePageTypes} ${plural(a.uniquePageTypes, 'тип', 'типи', 'типів')} сторінок`);

  const can: string[] = [];
  if (a.hasEcommerce) {
    /*
     * WooCommerce та інші рушії вантажать свої стилі на всіх сторінках сайту,
     * навіть якщо магазину нема. У юристів і клінік це давало мітку
     * «інтернет-магазин» — фразу, після якої клієнт розуміє, що сайт не дивились.
     */
    can.push(isRetail(i.typeLabel) ? 'інтернет-магазин' : 'модуль магазину (може бути неактивний)');
  } else if (a.hasCatalog) {
    can.push('каталог або меню');
  }
  if (a.hasForms) can.push('форми заявок');
  if (a.languages > 1) can.push(`${a.languages} ${plural(a.languages, 'мова', 'мови', 'мов')}`);

  if (!bits.length && !can.length) {
    return 'Сайт односторінковий, без каталогу й форм — по суті візитівка.';
  }

  const head = bits.length ? `Сайт ${bits.join(', ')}` : 'Сайт';
  const tail = can.length ? `, є ${can.join(', ')}` : '';
  return `${head}${tail}.`;
}

/** 3. Конкретні провали — те, що показують на екрані під час дзвінка. */
function problems(i: BriefInput): string {
  const a = i.audit;
  if (!i.website) return '';
  // Про заблокований сайт не перелічуємо «проблеми»: жодної з них ми не бачили
  if (i.siteStatus === 'blocked') return '';

  const bad: string[] = [];
  const readable = a && !a.fetchError;

  if (readable) {
    if (!a.hasViewportMeta) bad.push('не адаптивний — на телефоні його треба розтягувати пальцями');
    if (!a.https) bad.push('без HTTPS: Chrome пише «Не захищено» просто в адресному рядку');
    if (a.tlsExpired) bad.push('прострочений SSL-сертифікат');
    if (a.mixedContent) bad.push('змішаний контент — браузер лається на небезпечні файли');
    if (a.hasFlash) bad.push('на сайті ще лишився Flash, який мертвий з 2020 року');
    if (a.tableLayout) bad.push('верстка таблицями — прийом із початку 2000-х');
    if (a.jqueryVersion?.startsWith('1.')) bad.push(`jQuery ${a.jqueryVersion} — версія віком понад 10 років`);
    if (a.footerYear && YEAR - a.footerYear >= 3) {
      const n = YEAR - a.footerYear;
      bad.push(`у футері ${a.footerYear} — сайт не чіпали ${n} ${plural(n, 'рік', 'роки', 'років')}`);
    }
    if (!a.metaDescription && !a.ogTags) bad.push('нема опису для Google і прев\'ю для соцмереж');
  }

  const psi = i.psi;
  if (psi?.lcpMs != null && psi.lcpMs > 4000) {
    bad.push(`головний екран з'являється аж через ${(psi.lcpMs / 1000).toFixed(1)} с`);
  }
  if (psi?.mobileScore != null && psi.mobileScore < 40) {
    bad.push(`оцінка Google для мобільних ${psi.mobileScore} зі 100`);
  }

  if (!bad.length) return '';
  // Три пункти — стеля: далі продажник перестає їх запам'ятовувати
  return `Проблеми: ${bad.slice(0, 3).join('; ')}.`;
}

/** 4. З чого почати розмову. Один рядок, найсильніший аргумент. */
function hook(i: BriefInput): string {
  const a = i.audit;
  const many = (i.reviews ?? 0) >= 50;
  const googleSawIt = i.psi?.mobileScore != null || i.psi?.desktopScore != null;

  if (!i.website) {
    return `Зачіпка: бізнес шукають у Google Maps${many ? ' і активно туди пишуть' : ''}, але перейти нікуди — кожен такий клієнт іде до конкурента з сайтом.`;
  }
  if (i.siteStatus === 'blocked') {
    return 'Зачіпка: спершу відкрий сайт сам. Якщо він сучасний — це не наш клієнт, і краще дізнатись це до дзвінка, а не під час.';
  }
  if (a?.fetchError && !googleSawIt) {
    return 'Зачіпка: посилання з Google веде в нікуди — це видно за 5 секунд прямо під час дзвінка.';
  }
  if (a && !a.fetchError && !a.hasViewportMeta) {
    return 'Зачіпка: більшість заходів із Google Maps — з телефона, а саме на телефоні сайт розсипається. Показати екран і мовчати.';
  }
  if (i.psi?.lcpMs != null && i.psi.lcpMs > 8000) {
    return 'Зачіпка: відкрити сайт разом із клієнтом і порахувати вголос секунди до появи вмісту.';
  }
  if (a?.builder) {
    return `Зачіпка: за ${a.builder} власник уже платить щомісяця — розмова не про «нову витрату», а про заміну наявної.`;
  }
  /*
   * Маркер «сайт не відкривається» відкидаємо, якщо Google сторінку зміряв:
   * інакше бриф сам собі суперечив би за два речення — спершу «Google його
   * бачить», а потім «сайт не відкривається».
   */
  const markers = googleSawIt
    ? i.datedMarkers.filter((m) => !m.includes('не відкривається'))
    : i.datedMarkers;
  if (markers.length) {
    return `Зачіпка: ${markers[0]} — видно неозброєним оком, доводити нічого не треба.`;
  }
  return 'Зачіпка: сайт робочий, але візуально відстав — заходити варто через дизайн і довіру, а не через поломки.';
}

/** Українське відмінювання: 1 рік / 2 роки / 5 років. */
function plural(n: number, one: string, few: string, many: string): string {
  const mod100 = Math.abs(n) % 100;
  const mod10 = mod100 % 10;
  if (mod100 >= 11 && mod100 <= 14) return many;
  if (mod10 === 1) return one;
  if (mod10 >= 2 && mod10 <= 4) return few;
  return many;
}

const cap = (s: string) => (s ? s[0]!.toUpperCase() + s.slice(1) : s);
