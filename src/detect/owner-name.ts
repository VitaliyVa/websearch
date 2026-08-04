import type { LangSignal } from '../types.js';
import { isSlavicName } from './slavic-names.js';
import { countMatches, CYRILLIC_RE, SR_GLYPHS_RE } from '../util/text.js';

/**
 * Пошук імені ВЛАСНИКА на сторінці.
 *
 * Відрізняється від імен рецензентів: ті показують клієнтуру, а це — саму
 * людину, що володіє бізнесом. Найцінніше для випадку «нейтральна назва +
 * англомовний сайт»: «Bright Smile Dental» нічого не каже, а «Dr. Dmytro
 * Kovalenko, DDS» у розділі про команду каже все.
 *
 * СВІДОМЕ ОБМЕЖЕННЯ: беремо імена лише з контекстів, де вони майже напевно
 * належать власнику чи персоналу — структуровані дані, сусідство з роллю,
 * копірайт, email. Витягати «схожі на прізвища» слова з довільного тексту
 * не можна: сторінки повні відгуків клієнтів («Great job! — Oksana K.»),
 * назв вулиць і партнерів. Це дало б хибні спрацювання рівно того ж роду,
 * що вже ловили нас на -ski та на слові telegram.
 */

/** Ролі, поруч з якими ім'я майже напевно належить власнику або лікарю. */
const ROLE_WORDS =
  '(?:owner|founder|co-founder|president|principal|proprietor|director|attorney|lawyer|agent|broker|realtor|dr\\.?|doctor|dds|dmd|md|do|esq\\.?|cpa|rn|np|pa-c)';

export interface OwnerNameHit {
  name: string;
  source: 'jsonld' | 'role' | 'copyright' | 'email' | 'cyrillic';
  strong: boolean;
}

export interface OwnerNameResult {
  hits: OwnerNameHit[];
  score: number;
  detail: string | null;
}

/** Схоже на людське ім'я: «Слово Слово» з великих літер, без службових слів. */
/*
 * Прізвище — від 4 літер, ім'я — від 3.
 *
 * Шум давали саме короткі ПРІЗВИЩА: «De Tan», «Only Sun», «Billy Huh».
 * Для імені поріг нижчий, бо Max, Ivan, Oleh, Leo — нормальні імена, і
 * вимога 4 літер відрізала справжню знахідку Max Gorenyuk.
 */
const NAME_PAIR_RE = /\b([A-Z][a-z'’-]{2,19})\s+([A-Z][a-z'’-]{3,24})\b/g;

const STOPWORDS = new Set([
  'the', 'and', 'our', 'your', 'we', 'us', 'inc', 'llc', 'ltd', 'corp', 'company',
  'group', 'center', 'centre', 'clinic', 'dental', 'law', 'office', 'services',
  'insurance', 'realty', 'auto', 'repair', 'construction', 'roofing', 'home',
  'care', 'health', 'medical', 'family', 'best', 'new', 'great', 'first',
  'united', 'american', 'chicago', 'york', 'california', 'street', 'avenue',
  'road', 'suite', 'monday', 'friday', 'privacy', 'policy', 'terms', 'contact',
  'about', 'read', 'more', 'learn', 'call', 'today', 'free', 'get', 'all',
  'rights', 'reserved', 'copyright',
]);

const looksLikePerson = (first: string, last: string) =>
  !STOPWORDS.has(first.toLowerCase()) && !STOPWORDS.has(last.toLowerCase());

/**
 * Слова інтерфейсу й службові рядки, які трапляються поруч зі словами-ролями
 * і виглядають як імена. Кожен запис знайдено прогоном по 1598 реальних
 * сторінках: «Login Register», «Member Login», «For Sale», «By Train»,
 * «admin» у полі автора WordPress.
 */
const WEB_STOPWORDS = new Set([
  'admin', 'administrator', 'login', 'register', 'sign', 'signin', 'signup',
  'sale', 'member', 'search', 'submit', 'subscribe', 'order', 'cart', 'checkout',
  'account', 'profile', 'settings', 'menu', 'block', 'train', 'cabin', 'user',
  'guest', 'test', 'demo', 'sample', 'example', 'webmaster', 'support', 'info',
  'sales', 'office', 'team', 'staff', 'owner', 'manager', 'director', 'agent',
  'immediately', 'within', 'illinois', 'wisconsin', 'california', 'chicago',
  'hills', 'park', 'city', 'north', 'south', 'east', 'west', 'freight', 'rite',
  // Марки авто — сторінки автосервісів рясніють ними поруч зі словом service
  'honda', 'toyota', 'hummer', 'nissan', 'subaru', 'mazda', 'lexus', 'acura',
  'infiniti', 'chevrolet', 'chrysler', 'dodge', 'buick', 'cadillac', 'volvo',
  'audi', 'bmw', 'mercedes', 'porsche', 'jaguar', 'mitsubishi', 'hyundai', 'kia',
  // Дні тижня й час роботи стоять поруч із «closed»/«open»
  'closed', 'open', 'today', 'sunday', 'monday', 'tuesday', 'wednesday',
  'thursday', 'friday', 'saturday', 'salle', 'only',
]);

/**
 * Для власника беремо ТІЛЬКИ сильні сигнали.
 *
 * Прогін по реальних сторінках показав, що слабкі суфікси тут згубні:
 * «-in» ловив admin, Tobin, Marcelin, «-ina» ловив Vanina. З 261 спрацювання
 * справжніми були одиниці. Режим 'business' вимикає і слабкі суфікси,
 * і збіги за іменем.
 */
function isSlavic(name: string) {
  for (const token of name.toLowerCase().split(/[\s'’.-]+/)) {
    if (WEB_STOPWORDS.has(token)) return { ok: false, strong: false, via: 'stopword' as const };
  }
  return isSlavicName(name, { context: 'business' });
}

export function detectOwnerName(html: string, emails: string[] = []): OwnerNameResult {
  const hits: OwnerNameHit[] = [];
  const seen = new Set<string>();

  const push = (name: string, source: OwnerNameHit['source'], strong: boolean) => {
    const key = name.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    hits.push({ name, source, strong });
  };

  /* ── 1. JSON-LD: структуровані дані, найнадійніше ───────────────────── */
  for (const m of html.matchAll(
    /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
  )) {
    const names = collectJsonLdNames(m[1] ?? '');
    for (const n of names) {
      const v = isSlavic(n);
      if (v.ok) push(n, 'jsonld', v.strong);
    }
  }

  /* ── 2. Ім'я поруч із роллю ─────────────────────────────────────────── */
  /*
   * Обмежуємо обсяг тексту й кількість кандидатів.
   *
   * Без цього прогін по кешу зависав: сторінка-каталог на кілька сотень
   * кілобайт дає тисячі пар слів із великих літер, і кожна йде через
   * нормалізацію та словник на 50 тисяч ключів. Ім'я власника, якщо воно є,
   * майже завжди в першій частині сторінки — у шапці, «про нас» або футері.
   */
  const MAX_TEXT = 120_000;
  const MAX_CANDIDATES = 400;

  const text = html
    .slice(0, MAX_TEXT * 3) // HTML довший за текст приблизно втричі
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .slice(0, MAX_TEXT);

  /*
   * Два кроки замість одного великого регексу.
   *
   * Спроба зробити це однією маскою впиралась у конфлікт прапорців: назва ролі
   * має шукатись без урахування регістру («Realtor» і «realtor»), а ім'я — навпаки,
   * саме з великих літер. Один прапорець /i на весь вираз ламає другу вимогу.
   * Тому спершу знаходимо кандидатів у імена, потім дивимось оточення.
   */
  const ROLE_NEAR_RE = new RegExp(ROLE_WORDS, 'i');
  const WINDOW = 40;

  let candidates = 0;
  for (const m of text.matchAll(NAME_PAIR_RE)) {
    if (++candidates > MAX_CANDIDATES) break;

    const name = m[0];
    const [first = '', last = ''] = [m[1] ?? '', m[2] ?? ''];
    if (!looksLikePerson(first, last)) continue;

    const start = m.index ?? 0;
    const around =
      text.slice(Math.max(0, start - WINDOW), start) +
      ' | ' +
      text.slice(start + name.length, start + name.length + WINDOW);

    // Дешева перевірка ролі ПЕРЕД дорогою перевіркою словника
    if (!ROLE_NEAR_RE.test(around)) continue;

    const v = isSlavic(name);
    if (v.ok) push(name, 'role', v.strong);
  }

  /* ── 3. Рядок копірайту ─────────────────────────────────────────────── */
  const tail = html.slice(-8000).replace(/<[^>]+>/g, ' ');
  for (const m of tail.matchAll(/(?:©|&copy;|copyright)\s*(?:\d{4}(?:\s*[-–]\s*\d{4})?)?\s*([A-Z][A-Za-z'’-]{2,24})/g)) {
    const word = m[1] ?? '';
    if (STOPWORDS.has(word.toLowerCase())) continue;
    const v = isSlavic(word);
    if (v.ok) push(word, 'copyright', v.strong);
  }

  /* ── 4. Локальна частина email ──────────────────────────────────────── */
  for (const email of emails) {
    const local = email.split('@')[0] ?? '';
    for (const token of local.split(/[._\-+\d]+/)) {
      if (token.length < 4) continue;
      const v = isSlavic(token);
      if (v.ok) push(token, 'email', v.strong);
    }
  }

  /* ── 5. Кирилиця в імені поруч із роллю ─────────────────────────────── */
  if (countMatches(text, CYRILLIC_RE) > 0 && !SR_GLYPHS_RE.test(text)) {
    const cyrRole = new RegExp(
      `(?:власник|засновник|директор|керівник|лікар|адвокат)[\\s:,-]{1,4}([А-ЯІЇЄҐ][а-яіїєґ']{2,}\\s+[А-ЯІЇЄҐ][а-яіїєґ']{2,})`,
      'gi',
    );
    for (const m of text.matchAll(cyrRole)) {
      push((m[1] ?? '').trim(), 'cyrillic', true);
    }
  }

  /* ── бали ───────────────────────────────────────────────────────────── */
  // Тільки сильні збіги. Слабкий клас прибрано: на реальних сторінках він
  // давав admin, Tobin, Marcelin і Vanina замість прізвищ власників.
  const strongHit = hits.find((h) => h.strong);
  const score = strongHit
    ? strongHit.source === 'jsonld' || strongHit.source === 'cyrillic'
      ? 30
      : 25
    : 0;

  const detail = hits.length
    ? `прізвище власника на сайті: ${hits
        .slice(0, 3)
        .map((h) => `${h.name} (${sourceLabel(h.source)})`)
        .join(', ')}`
    : null;

  return { hits, score, detail };
}

/**
 * Додає сигнал прізвища власника до вже порахованого мовного сигналу.
 * Живе тут, а не в detectSiteLanguage, бо потребує вже витягнутих email —
 * і щоб audit і rescore рахували це однаково, без дублювання логіки.
 */
export function withOwnerName(lang: LangSignal, html: string, emails: string[]): LangSignal {
  if (lang.hardExclusion) return lang;

  const owner = detectOwnerName(html, emails);
  if (owner.score === 0) return lang;

  return {
    ...lang,
    score: Math.max(0, Math.min(100, lang.score + owner.score)),
    evidence: [
      ...lang.evidence,
      { signal: 'owner_surname_on_site', weight: owner.score, detail: owner.detail ?? undefined },
    ],
  };
}

const sourceLabel = (s: OwnerNameHit['source']) =>
  ({ jsonld: 'структ. дані', role: 'поруч з посадою', copyright: 'копірайт', email: 'email', cyrillic: 'кирилиця' }[s]);

/** Витягає значення `name` з вузлів Person / founder / employee у JSON-LD. */
function collectJsonLdNames(raw: string): string[] {
  const out: string[] = [];
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return out;
  }

  const visit = (node: unknown, insidePerson: boolean) => {
    if (Array.isArray(node)) {
      for (const n of node) visit(n, insidePerson);
      return;
    }
    if (!node || typeof node !== 'object') return;

    const obj = node as Record<string, unknown>;
    const type = String(obj['@type'] ?? '');
    const isPerson = insidePerson || /person/i.test(type);

    if (isPerson && typeof obj.name === 'string') out.push(obj.name);

    for (const [key, value] of Object.entries(obj)) {
      if (key === 'name') continue;
      const personKey = /^(founder|employee|author|member|owner|director|creator)$/i.test(key);
      visit(value, personKey);
    }
  };

  visit(data, false);
  return out.filter((n) => n.length > 3 && n.length < 60);
}
