/*
 * Квантифікатори ОБМЕЖЕНІ навмисно.
 *
 * Було `[A-Za-z0-9._%+-]+@…` без стелі. На сторінці з вбудованим base64-
 * зображенням це суцільний блок дозволених символів на сотні кілобайт, і
 * рушій пробує кожну стартову позицію — до 10.7 секунди на одну сторінку.
 * Реальна локальна частина адреси не буває довшою за 64 символи (RFC 5321).
 */
const EMAIL_RE = /\b[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9-]{1,63}(?:\.[A-Za-z0-9-]{1,63}){0,4}\.[A-Za-z]{2,12}\b/g;

/** Прибирає base64-блоби, які й дають патологічний відкат. */
const stripBinary = (s: string) =>
  s
    .replace(/data:[a-z+/-]+;base64,[A-Za-z0-9+/=]+/gi, 'data:stripped')
    .replace(/[A-Za-z0-9+/]{200,}={0,2}/g, ' ');

/** Сміттєві адреси, які трапляються в шаблонах/аналітиці. */
const EMAIL_BLOCKLIST =
  /@(?:example|sentry|wixpress|squarespace|godaddy|schema|w3|sentry\.io|2x|domain)\.|\.(png|jpg|jpeg|gif|svg|webp|css|js)$|^(?:info|email|your|name|user)@(?:email|domain|website|company|yoursite)\./i;

/**
 * Службові шляхи соцмереж: піксель (/tr), кнопки шеру, віджети, oauth.
 * Без цього фільтра у 90% сайтів «сторінкою у Facebook» стає facebook.com/tr.
 */
const SOCIAL_JUNK =
  /\/(tr|sharer|share|dialog|plugins|widgets|intent|login|oauth|v\d+\.\d+|tr\.js|embed|badge|profile\.php)\b/i;

const SOCIAL_PATTERNS: { key: string; re: RegExp }[] = [
  { key: 'facebook', re: /https?:\/\/(?:www\.|m\.)?facebook\.com\/[A-Za-z0-9._%-]+/i },
  { key: 'instagram', re: /https?:\/\/(?:www\.)?instagram\.com\/[A-Za-z0-9._%-]+/i },
  { key: 'telegram', re: /https?:\/\/t\.me\/[A-Za-z0-9_]+/i },
  { key: 'youtube', re: /https?:\/\/(?:www\.)?youtube\.com\/(?:c\/|channel\/|@)[A-Za-z0-9._%-]+/i },
  { key: 'tiktok', re: /https?:\/\/(?:www\.)?tiktok\.com\/@[A-Za-z0-9._%-]+/i },
  { key: 'linkedin', re: /https?:\/\/(?:www\.)?linkedin\.com\/(?:company|in)\/[A-Za-z0-9._%-]+/i },
  { key: 'yelp', re: /https?:\/\/(?:www\.)?yelp\.com\/biz\/[A-Za-z0-9._%-]+/i },
];

/*
 * Стеля для повнотекстового пошуку адрес — 120 КБ.
 *
 * Нижча за інші детектори навмисно. На великих сторінках цей крок зривався
 * у 10 секунд навіть після обмеження квантифікаторів, і полювання за конкретним
 * винним регексом себе не виправдало: дешевше обмежити обсяг.
 *
 * Втрати мінімальні: адреси живуть у mailto-посиланнях (їх шукаємо по ВСЬОМУ
 * документу окремим дешевим регексом) і в шапці чи футері. Ховати контакт на
 * 300-й кілобайт сторінки не має сенсу нікому.
 */
const MAX_SCAN = 120_000;

export function extractEmails(fullHtml: string): string[] {
  const truncated = fullHtml.length > MAX_SCAN;
  const html = stripBinary(truncated ? fullHtml.slice(0, MAX_SCAN) : fullHtml);
  const found = new Set<string>();

  // 1. mailto: — найнадійніше, і шукаємо по ВСЬОМУ документу:
  // регекс дешевий, а посилання може бути й у кінці сторінки
  for (const m of fullHtml.matchAll(/mailto:([^"'?>\s]{3,120})/gi)) {
    const e = decodeURIComponent(m[1]!).toLowerCase().trim();
    if (isValid(e)) found.add(e);
  }

  // 2. Cloudflare email protection — типова обфускація
  for (const m of html.matchAll(/data-cfemail=["']([0-9a-f]+)["']/gi)) {
    const decoded = decodeCfEmail(m[1]!);
    if (decoded && isValid(decoded)) found.add(decoded);
  }

  for (const m of html.matchAll(EMAIL_RE)) {
    const e = m[0].toLowerCase();
    if (isValid(e)) found.add(e);
    if (found.size >= 40) break; // більше не знадобиться, віддаємо лише 5
  }

  /*
   * Деобфускацію «name (at) domain (dot) com» робимо ЛИШЕ на невеликих
   * сторінках: вона створює копію документа, тобто подвоює обсяг сканування,
   * а трапляється така обфускація рідко.
   */
  if (!truncated && found.size === 0) {
    const deobfuscated = html
      .replace(/\s*\(\s*at\s*\)\s*|\s+at\s+/gi, '@')
      .replace(/\s*\(\s*dot\s*\)\s*|\s+dot\s+/gi, '.');
    for (const m of deobfuscated.matchAll(EMAIL_RE)) {
      const e = m[0].toLowerCase();
      if (isValid(e)) found.add(e);
      if (found.size >= 10) break;
    }
  }

  // Пріоритет контактним адресам перед випадковими
  return [...found]
    .sort((a, b) => rank(a) - rank(b))
    .slice(0, 5);
}

const isValid = (e: string) =>
  e.length < 80 && e.includes('@') && !EMAIL_BLOCKLIST.test(e) && !/\.(png|jpg|css|js)$/i.test(e);

const rank = (e: string) => {
  if (/^(info|contact|office|hello|sales|admin)@/i.test(e)) return 0;
  if (/^(support|help|service)@/i.test(e)) return 1;
  if (/^(no-?reply|donotreply)@/i.test(e)) return 9;
  return 5;
};

/** Cloudflare email obfuscation: перший байт — ключ XOR. */
function decodeCfEmail(hex: string): string | null {
  try {
    const key = parseInt(hex.slice(0, 2), 16);
    let out = '';
    for (let i = 2; i < hex.length; i += 2) {
      out += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16) ^ key);
    }
    return out.includes('@') ? out.toLowerCase() : null;
  } catch {
    return null;
  }
}

export function extractSocials(html: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const { key, re } of SOCIAL_PATTERNS) {
    // Беремо перший НЕслужбовий збіг, а не просто перший
    const global = new RegExp(re.source, 'gi');
    for (const m of html.matchAll(global)) {
      const url = m[0];
      if (SOCIAL_JUNK.test(url)) continue;
      out[key] = url;
      break;
    }
  }
  return out;
}
