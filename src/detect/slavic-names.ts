/**
 * ЄДИНЕ джерело правди про те, чи ім'я укр/рос.
 *
 * До цього логіка жила у двох файлах (author-names, owner-name) з РІЗНИМИ
 * наборами правил — один ловив закінчення -in, інший ні. Такі розбіжності
 * гарантовано розходяться далі, тому зведено сюди.
 *
 * Бази даних прізвищ немає і не планується: офлайн-список на кілька мільйонів
 * записів не вартий того, коли 90% покриття дають ~20 суфіксів плюс перелік
 * найпоширеніших прізвищ на приголосний.
 */

import { isForeignMajor, lookupName } from './name-index.js';
import { normalizeName } from './translit.js';

/* ─────────────────────────  ІМЕНА  ───────────────────────── */

/*
 * Імена, що є ОДНОЧАСНО поширеними англійськими. Свідомо НЕ включені до
 * списку нижче: Alexander, Roman, Diana, Marina — звичайні імена в США,
 * і зарахування їх означало б ловити кожного американця на ім'я Александер.
 *
 * Кордон проведено за частотністю в англомовному середовищі, а не за наявністю
 * у словнику: Wiktionary тримає і Svitlana серед англійських імен (як
 * запозичення), хоча реальних американок з таким іменем майже немає.
 *
 * Виключені: alexander, roman, boris, diana, marina, karina, alina,
 *            veronika, marta, polina, nikita, victoria, sofia, anna, maria
 */
export const SLAVIC_FIRST_NAMES = new Set([
  // українські транслітерації
  'oksana', 'dmytro', 'volodymyr', 'oleksandr', 'olexandr', 'oleksandra', 'kateryna',
  'iryna', 'serhii', 'serhiy', 'andrii', 'andriy', 'mykola', 'yurii', 'yuriy', 'taras',
  'bohdan', 'bohdana', 'svitlana', 'nataliia', 'nataliya', 'vitalii', 'vitaliy',
  'olha', 'halyna', 'tetiana', 'tetyana', 'vasyl', 'petro', 'marta', 'sofiia',
  // 'roman' навмисно відсутнє — англійське слово, дало Roman Auto Body,
  // Roman Motors, ROMAN Home Remodeling
  'ihor', 'myroslav', 'liudmyla', 'valentyna', 'anastasiia', 'khrystyna',
  'yaroslav', 'zoriana', 'solomiia', 'ostap', 'danylo', 'maksym', 'nazar', 'mykhailo',
  'stepan', 'levko', 'orysia', 'oleh', 'pavlo', 'viktor', 'yevhen', 'ruslana',
  // російські транслітерації
  'dmitry', 'dmitriy', 'sergey', 'sergei', 'vladimir', 'aleksandr',
  'ekaterina', 'irina', 'nikolay', 'nikolai', 'natalya', 'elena',
  'olga', 'svetlana', 'tatiana', 'tatyana', 'yevgeny', 'evgeny', 'evgenia',
  'mikhail', 'aleksey', 'alexey', 'andrey', 'anatoly',
  'galina', 'lyudmila', 'nadezhda', 'oleg', 'pavel', 'vadim',
  'yulia', 'yuliya', 'zhanna', 'inna', 'alla', 'raisa',
  'leonid', 'arkady', 'semyon', 'stanislav', 'ruslan',
  'kseniya', 'ksenia', 'grigory', 'konstantin', 'artem', 'artyom',
  'yegor', 'gennady', 'vyacheslav', 'valentin', 'zinaida', 'klavdiya',
]);

/* ─────────────────────────  ПРІЗВИЩА  ───────────────────────── */

/**
 * Прізвища на ПРИГОЛОСНИЙ — їх неможливо впіймати за суфіксом.
 * Саме тут були найбільші прогалини: Мельник — найпоширеніше українське
 * прізвище взагалі — не ловилось жодним правилом.
 */
export const SLAVIC_SURNAMES = new Set([
  // українські, найпоширеніші
  'melnyk', 'melnik', 'melnychuk', 'oliynyk', 'oliinyk', 'olijnyk',
  'boyko', 'boiko', 'moroz', 'bondar', 'bondarenko', 'kravets', 'kravetz',
  'kolomiets', 'kolomiyets', 'shvets', 'shvetz', 'tkach', 'tkachuk',
  'koval', 'kovall', 'kovalenko', 'kovalchuk', 'kushnir', 'kushnier',
  'zhuk', 'bilyk', 'bilyi', 'lysak', 'danko', 'marko', 'kozak', 'kozar',
  'hrytsak', 'sokil', 'chorny', 'chornyi', 'chorna', 'palii', 'paliy',
  'yatsko', 'shulha', 'shulga', 'kulyk', 'bereza', 'vovk', 'zayats', 'zaiats',
  'mazur', 'zubko', 'tsymbal', 'riabko', 'sirko', 'hutsul', 'bandura',
  'shtefan', 'skoryk', 'rybak', 'chaban', 'haiduk', 'gaiduk', 'bodnar',
  'dziuba', 'dzyuba', 'slobodian', 'verba', 'hnatiuk', 'stets', 'stetsko',
  'lytvyn', 'litvin', 'prokopiv', 'yakymiv', 'kravchuk', 'kravchenko',
  'polishchuk', 'savchuk', 'shevchuk', 'fedorchuk', 'marchuk', 'dmytruk',
  'romaniuk', 'romanyuk', 'petryk', 'hrab', 'sydir', 'kots', 'tsyhan',
  // російські на приголосний або нетипове закінчення
  'nikitin', 'ilyin', 'fomin', 'sorokin', 'kuzmin', 'kalinin', 'lapin',
  'gagarin', 'yeltsin', 'putin', 'kuznetsov', 'medvedev', 'sobol', 'gorbach',
  'shmidt', 'gerts', 'kats', 'katz', 'roytman', 'rabinovich', 'kagan',
]);

/**
 * Продуктивні суфікси. Сильний клас — практично не трапляється поза
 * східнослов'янськими прізвищами.
 */
export const SLAVIC_SUFFIX_STRONG_RE =
  new RegExp(
    '\\b[a-z]{2,}(' +
      [
        'enko', 'chenko', 'chuk', 'tchouk', 'shyn', 'yshyn', 'ishin',
        'ovich', 'ovych', 'evich', 'evych', 'nyuk', 'niuk', 'yuk', 'iuk',
        // жіночі й варіантні форми на -ський: Buchkovska, Sokolovska, Sladkovskii
        'skiy', 'skyy', 'skii', 'skaya', 'vska', 'tsky', 'itsky', 'nitsky',
        'nyk', 'chyk',
      ].join('|') +
      ')\\b',
    'i',
  );

/**
 * Слабший клас: -ov/-ev/-in та подібні. Часто слов'янські, але сюди ж
 * потрапляють болгарські, сербські й випадкові англійські слова —
 * тому вага нижча і працює список винятків.
 */
/*
 * -ak СВІДОМО прибрано. Nowak — найпоширеніше польське прізвище взагалі,
 * плюс Kubiak, Wozniak, Marciniak. Українські прізвища на -ak (Лисак, Грицак,
 * Козак) нечисленні й перелічені в SLAVIC_SURNAMES поіменно, тому суфікс тут
 * приносив би самих поляків.
 */
export const SLAVIC_SUFFIX_WEAK_RE = /\b[a-z]{3,}(ov|ev|off|eff|ova|eva|in|ina|yna|yk)\b/i;

/** Польські закінчення. У Чикаго поляків більше за українців — виключаємо. */
export const POLISH_SURNAME_RE =
  /\b\w{3,}(owski|ewski|inski|ynski|owicz|ewicz|czyk|czak|owska|kowska|ewska|inska|ynska|kiewicz|czuk)\b/i;

/** Найпоширеніші польські прізвища, які не ловляться закінченням. */
export const POLISH_SURNAMES = new Set([
  'nowak', 'wojcik', 'wojcek', 'kowalski', 'kowalska', 'wisniewski', 'dabrowski',
  'lewandowski', 'zielinski', 'szymanski', 'wozniak', 'kozlowski', 'jankowski',
  'mazur', 'kwiatkowski', 'krawczyk', 'piotrowski', 'grabowski', 'pawlowski',
  'michalski', 'nowicki', 'adamczyk', 'dudek', 'zajac', 'wieczorek', 'jablonski',
  'krol', 'majewski', 'olszewski', 'stepien', 'malinowski', 'jaworski', 'sikora',
  'baran', 'rutkowski', 'michalak', 'szewczyk', 'ostrowski', 'tomaszewski',
  'pietrzak', 'marciniak', 'wrobel', 'zalewski', 'kubiak', 'maciejewski',
]);

/**
 * Англійські слова й імена, що випадково підходять під слов'янські суфікси.
 * Кожен запис тут — реальний хибний збіг, знайдений на даних.
 */
export const FALSE_FRIENDS_RE = new RegExp(
  [
    // -in / -ina: найпоширеніша пастка
    'martin', 'marin', 'karin', 'robin', 'colin', 'austin', 'justin', 'kevin',
    'benjamin', 'franklin', 'calvin', 'melvin', 'dustin', 'kristin', 'erin',
    'darwin', 'griffin', 'gavin', 'devin', 'irwin', 'quentin', 'valentin',
    'regina', 'carolina', 'katrina', 'christina', 'sabrina', 'marina_beach',
    // -ov / -off / -ove
    'takeoff', 'kickoff', 'payoff', 'liftoff', 'standoff', 'ripoff', 'showoff',
    'tradeoff', 'dropoff', 'cutoff', 'playoff', 'remove', 'improve', 'approve',
    // -ak / -yak
    'kayak', 'crack', 'attack', 'snack',
    // -yk / -ik
    'graphik', 'klinik',
  ].map((w) => `\\b${w}\\b`).join('|'),
  'i',
);

/*
 * Ручні списки зберігаємо ще й у нормалізованому вигляді — звірка завжди
 * йде по канонічних ключах, інакше кирилиця й варіанти написання не збіжаться.
 */
const toKeys = (src: Iterable<string>) => new Set([...src].map((s) => normalizeName(s)));

const SLAVIC_SURNAME_KEYS = toKeys(SLAVIC_SURNAMES);
const SLAVIC_FIRST_NAME_KEYS = toKeys(SLAVIC_FIRST_NAMES);
const POLISH_SURNAME_KEYS = toKeys(POLISH_SURNAMES);

export interface SlavicVerdict {
  ok: boolean;
  /** true — точний збіг зі словником або сильний суфікс */
  strong: boolean;
  /** Звідки вердикт — потрапляє в пояснення для продажника */
  via: 'wiktionary' | 'wiktionary-shared' | 'list' | 'suffix' | 'suffix-weak' | 'none';
}

const NO: SlavicVerdict = { ok: false, strong: false, via: 'none' };

/**
 * Чи схоже прізвище/ім'я на укр/рос.
 *
 * Порядок навмисний: спершу словник Wiktionary (лінгвістична класифікація,
 * найнадійніше і з урахуванням ексклюзивності), потім ручні списки, і лише
 * наприкінці суфіксні правила — вони найгрубіші й саме на них ми вже двічі
 * ловили поляків.
 */
/**
 * Слова, що є ОДНОЧАСНО слов'янськими іменами і звичайними англійськими
 * словами. У назві бізнесу вони майже завжди означають англійське значення.
 *
 * Знайдені прогоном по реальній базі: «Roman Auto Body», «Roman Motors»,
 * «ROMAN Home Remodeling» — жодне не про Романа. «Marina» у назві — це
 * пристань для човнів, «Nova» — латинське «нова», «Vera» — англійське ім'я.
 */
const BUSINESS_WORD_NAMES = new Set([
  'roman', 'marina', 'nova', 'vera', 'mira', 'dana', 'alma', 'lada', 'sonata',
  'victoria', 'diana', 'alexander', 'anna', 'maria', 'sofia', 'aviv', 'maya',
  'aaron', 'karen', 'richard', 'david', 'andrew', 'less', 'star', 'sever',
]);

export interface SlavicOptions {
  /**
   * 'person'   — рядок є іменем людини (рецензент, підпис під посадою).
   *              Можна довіряти іменам і слабким суфіксам.
   * 'business' — рядок є назвою бізнесу. Там повно англійських слів, тому
   *              працюють лише прізвища й сильні суфікси.
   *
   * Розділення додано після прогону по реальних даних: у режимі 'person'
   * назви бізнесів давали «Truckin ← Truckin Central», «Xilin ← Xilin
   * Association» (китайська громада), «Less ← Pay Less Moving».
   */
  context?: 'person' | 'business';
}

/**
 * Стеля довжини рядка.
 *
 * Суфіксні регекси мають вигляд `\b[a-z]{2,}(alt1|alt2|…|alt25)\b`. На довгому
 * рядку жадібний `[a-z]{2,}` відкочується по кожній позиції для кожної з 25
 * альтернатив — це квадратична поведінка, і на патологічній сторінці прогін
 * зависав назовсім (209 секунд без єдиного запису, CPU у стелю).
 *
 * Справжніх імен довших за 60 символів не буває, тож обмеження нічого не коштує.
 */
const MAX_NAME_LEN = 60;

export function isSlavicName(raw: string, opts: SlavicOptions = {}): SlavicVerdict {
  const business = opts.context === 'business';
  const name = raw.trim();
  const minLen = business ? 5 : 3;
  if (name.length < minLen || name.length > MAX_NAME_LEN) return NO;

  if (business && BUSINESS_WORD_NAMES.has(name.toLowerCase())) return NO;

  // Нормалізуємо токени: інакше кирилична «Шевчук» ніколи не збіжиться
  // з латинським ключем у списку
  const tokens = name
    .toLowerCase()
    .split(/[\s'’-]+/)
    .map((t) => normalizeName(t))
    .filter((t) => t.length >= 3);

  /*
   * 1. ПРІЗВИЩА з курованого списку — пріоритет над словником.
   *
   * Wiktionary тримає Boyko, Bondar і Tkach у категорії English surnames
   * (як англізовані форми), тому словник позначав їх «foreign» і викидав
   * справжні українські прізвища. Курований список має пріоритет саме тому,
   * що ми за нього відповідаємо.
   */
  for (const token of tokens) {
    if (SLAVIC_SURNAME_KEYS.has(token)) return { ok: true, strong: true, via: 'list' };
  }

  /*
   * 2. ІМЕНА з курованого списку.
   *
   * Неоднозначні (Alexander, Roman, Diana) до списку просто не входять —
   * фільтрація зроблена на етапі складання, а не тут. Спроба гейтити список
   * словником провалилась: Wiktionary тримає Svitlana серед англійських імен,
   * і гейт викидав явно українське ім'я.
   */
  // У назві бізнесу ім'я нічого не доводить: «Roman Auto Body», «Roman Motors»,
  // «ROMAN Home Remodeling» — це англійське слово Roman, а не Роман
  if (!business) {
    for (const token of tokens) {
      if (SLAVIC_FIRST_NAME_KEYS.has(token)) return { ok: true, strong: true, via: 'list' };
    }
  }

  /* ── 3. Ручні виключення ──────────────────────────────────────────── */
  if (POLISH_SURNAME_RE.test(name)) return NO;
  if (FALSE_FRIENDS_RE.test(name)) return NO;
  for (const token of tokens) {
    if (POLISH_SURNAME_KEYS.has(token)) return NO;
  }

  /* ── 4. Словник Wiktionary з урахуванням ексклюзивності ───────────── */
  const idx = lookupName(name);
  if (idx.verdict === 'exclusive') return { ok: true, strong: true, via: 'wiktionary' };
  if (idx.verdict === 'shared') return { ok: true, strong: false, via: 'wiktionary-shared' };

  /*
   * Вердикт «foreign» НЕ є жорсткою зупинкою для повного імені.
   *
   * «Alexander Reznikov» і «Anna Bondarchuk» — обидва явно наші, але Alexander
   * і Anna лежать в англійському словнику, і одне таке слово отруювало все ім'я:
   * суфікс -чук у прізвищі вже не встигав спрацювати.
   *
   * Прізвище дискримінативніше за ім'я, тому останній токен має право голосу
   * навіть попри чужий вердикт по імені.
   */
  /*
   * Суфікси перевіряємо на СИРОМУ прізвищі, не на нормалізованому.
   *
   * Нормалізація зрізає саме те закінчення, яке несе сигнал: «Gordovskiy»
   * стає «gordovski», і -skiy вже не знайти. На живих даних через це губились
   * Igor Gordovskiy, Nikita Sladkovskii, Evaa Sokolovska.
   *
   * Зворотний бік тієї ж помилки: нормалізація робить w→v, тому американське
   * «Renfrow» перетворювалось на «renfrov» і ловилось як -ов. На сирому тексті
   * воно закінчується на -ow і не збігається ні з чим.
   */
  const rawTokens = name.split(/[\s'’,.-]+/).filter((t) => t.length >= 3);
  const rawSurname = rawTokens[rawTokens.length - 1] ?? '';
  const surname = tokens[tokens.length - 1] ?? '';

  /*
   * І тільки по ПРІЗВИЩУ, не по всьому імені: «Dhroov Patel» ловився через
   * ім'я Dhroov (-ov), хоча прізвище індійське.
   */
  // Вето мають лише великі конкуренти. Дрібні (чехи, болгари, серби) не можуть
  // перебити сильний східнослов'янський суфікс — їхніх діаспор у цільових
  // метро майже немає.
  const surnameClean = !surname || !isForeignMajor(surname);

  if (surnameClean && rawSurname) {
    if (SLAVIC_SUFFIX_STRONG_RE.test(rawSurname)) return { ok: true, strong: true, via: 'suffix' };
    // Слабкі суфікси (-ov/-in/-yk) лише для імен людей: на назвах бізнесу
    // вони давали Truckin Central, Xilin Association, Ukraina Deli
    if (!business && SLAVIC_SUFFIX_WEAK_RE.test(rawSurname)) {
      return { ok: true, strong: false, via: 'suffix-weak' };
    }
  }

  return NO;
}
