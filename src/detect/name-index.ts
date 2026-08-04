import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { paths } from '../config.js';
import { normalizeName } from './translit.js';

/**
 * Індекс імен із Wiktionary, зведений до нормалізованих ключів.
 *
 * КЛЮЧОВА ІДЕЯ — не бінарна перевірка «є в українському списку», а
 * ЕКСКЛЮЗИВНІСТЬ. Багато прізвищ належать кільком мовам одночасно:
 * Ivanov — і російське, і болгарське; Mazur — і польське, і українське.
 * Бінарна перевірка на таких дає ті самі помилки, що вже ловили нас на -ski.
 *
 * Тому питання не «чи є», а «чи є ЛИШЕ у нас»:
 *   exclusive — тільки в укр/рос           → сильний сигнал
 *   shared    — і в наших, і в конкурентів → слабкий
 *   foreign   — тільки в конкурентів       → жорстке виключення
 *   unknown   — ніде                       → падаємо на суфіксні правила
 */

export type NameVerdict = 'exclusive' | 'shared' | 'foreign' | 'unknown';

interface IndexFile {
  category: string;
  role: 'target' | 'competitor';
  count: number;
  keys: string[];
}

/*
 * Українські списки виділені окремо від російських.
 *
 * Причина: категорія «English surnames» у Wiktionary забруднена
 * транслітераціями — Bondarchuk лежить і там. А «Russian surnames» містить
 * чимало прізвищ польського походження (Ковальський), які носять росіяни.
 * Тому правила різні: збіг з українським списком переважує «англійський»,
 * а збіг лише з російським у парі з польським — навпаки, ознака польського.
 */
/*
 * ІМЕНА зі словника свідомо НЕ використовуються — тільки прізвища.
 *
 * Категорії «Ukrainian/Russian given names» у Wiktionary містять усе, що
 * вживається носіями мови, разом із міжнародним: Aaron, Maria, Marina, Maya,
 * Yana, Farida. На реальних даних це дало «Aviv ← Tel Aviv Bakery»,
 * «Aaron ← Aaron's Reliable Movers», «Maya ← Maya Construction Group».
 * Імена беремо лише з курованого переліку, який ми контролюємо.
 */
const TARGET_UK_FILES = ['uk-surnames'];
const TARGET_RU_FILES = ['ru-surnames'];

/**
 * Конкуренти поділені на дві групи за розміром діаспори в США — це вирішує,
 * що робити з іменем, яке належить і нам, і їм.
 *
 * major: поляки й англомовні. У Чикаго поляків БІЛЬШЕ за українців, тому
 *        спільне ім'я (Kowalski, Boyko) імовірніше їхнє → виключаємо.
 * minor: болгари, серби, чехи. Їхні діаспори в цільових метро малі, тому
 *        спільне ім'я (Ivanov, Petrov) імовірніше наше → лишаємо слабким.
 */
const COMPETITOR_MAJOR = ['pl-surnames', 'en-surnames', 'en-given'];
const COMPETITOR_MINOR = ['bg-surnames', 'sh-surnames', 'cs-surnames'];

let uk: Set<string> | null = null;
let ru: Set<string> | null = null;
let polish: Set<string> | null = null;
let english: Set<string> | null = null;
let minor: Set<string> | null = null;
let loadedFrom: string[] = [];

function load() {
  if (uk && ru && polish && english && minor) return;
  uk = new Set();
  ru = new Set();
  polish = new Set();
  english = new Set();
  minor = new Set();
  loadedFrom = [];

  const dir = resolve(paths.root, 'data', 'names');

  const read = (name: string, into: Set<string>) => {
    const file = resolve(dir, `${name}.json`);
    if (!existsSync(file)) return;
    try {
      const data = JSON.parse(readFileSync(file, 'utf8')) as IndexFile;
      for (const k of data.keys) into.add(k);
      loadedFrom.push(`${name}(${data.keys.length})`);
    } catch {
      /* пошкоджений файл — просто пропускаємо, суфіксні правила лишаються */
    }
  };

  for (const f of TARGET_UK_FILES) read(f, uk);
  for (const f of TARGET_RU_FILES) read(f, ru);
  read('pl-surnames', polish);
  read('en-surnames', english);
  read('en-given', english); // англійські імена лишаємо — вони потрібні для ВИКЛЮЧЕНЬ
  for (const f of COMPETITOR_MINOR) read(f, minor);
}

export function indexStatus() {
  load();
  return {
    target: uk!.size + ru!.size,
    competitor: polish!.size + english!.size + minor!.size,
    uk: uk!.size,
    ru: ru!.size,
    polish: polish!.size,
    english: english!.size,
    minor: minor!.size,
    files: loadedFrom,
    ready: uk!.size > 0,
  };
}

/** Вердикт для ОДНОГО вже нормалізованого токена. */
export function lookupToken(key: string): NameVerdict {
  return lookupKey(key);
}

/**
 * Чи є ключ у ВЕЛИКИХ конкурентів (поляки, англомовні).
 *
 * Окремо від lookupToken, бо дрібні конкуренти не мають права вето на сильний
 * східнослов'янський суфікс: «Sladkovskii» збігається з чеським «Sladkovský»
 * після нормалізації, але чеська діаспора в цільових метро мізерна, а подвійне
 * -ii саме й свідчить про східнослов'янську транслітерацію (чеською було б -ský).
 */
export function isForeignMajor(key: string): boolean {
  load();
  return polish!.has(key) || english!.has(key);
}

/** Вердикт для ОДНОГО токена (слова), уже нормалізованого. */
function lookupKey(key: string): NameVerdict {
  load();
  const inUk = uk!.has(key);
  const inRu = ru!.has(key);
  const inPl = polish!.has(key);
  const inEn = english!.has(key);
  const inMinor = minor!.has(key);

  /*
   * Порядок правил відображає надійність джерел.
   *
   * Українська категорія найчистіша під нашу задачу, тому збіг із нею
   * переважує англійську: остання забруднена транслітераціями (Bondarchuk
   * значиться і як «English surname»). Але перед польською вона поступається —
   * у Чикаго польська діаспора більша, і спірне ім'я статистично їхнє.
   */
  if (inUk && !inPl) return 'exclusive';
  if (inUk && inPl) return 'shared';

  // Прізвище лише в російському списку + польському — це польське прізвище,
  // яке носять росіяни (Ковальський). Для США читаємо як польське.
  if (inRu && inPl) return 'foreign';
  if (inRu && !inEn) return 'exclusive';
  if (inRu && inEn) return 'shared';

  if (inPl || inEn) return 'foreign';
  if (inMinor) return 'foreign';
  return 'unknown';
}

export interface IndexLookup {
  verdict: NameVerdict;
  /** Токен, який дав вердикт (для пояснення в таблиці) */
  matched: string | null;
}

/**
 * Перевіряє повне ім'я — усі його слова. Пріоритет вердиктів:
 * exclusive > shared > foreign > unknown.
 *
 * Чому exclusive перемагає foreign: «Oksana Smith» — Оксана заміжня за
 * американцем. Ім'я ексклюзивно наше, прізвище чуже. Для нашої задачі
 * (чи говорить людина укр/рос) вирішує ім'я.
 */
export function lookupName(fullName: string): IndexLookup {
  const tokens = fullName
    .split(/[\s'’,.-]+/)
    .map((t) => normalizeName(t))
    .filter((t) => t.length >= 3);

  let best: NameVerdict = 'unknown';
  let matched: string | null = null;

  for (const t of tokens) {
    const v = lookupKey(t);
    // exclusive виграє одразу — далі шукати нема сенсу
    if (v === 'exclusive') return { verdict: 'exclusive', matched: t };
    if (v === 'shared') {
      best = 'shared';
      matched = t;
    } else if (v === 'foreign' && best === 'unknown') {
      best = 'foreign';
      matched = t;
    }
  }

  return { verdict: best, matched };
}
