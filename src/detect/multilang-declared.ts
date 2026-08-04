import type { Evidence } from '../types.js';

export interface DeclaredLangs {
  /** мова -> URL версії */
  found: Map<string, string>;
  htmlLang: string | null;
  flagIcons: boolean;
  /** Скільки ВСЬОГО мов декларує сайт — ключове для відсіву глобальних i18n-сайтів */
  totalLanguages: number;
  evidence: Evidence[];
}

const SLAVIC = new Set(['uk', 'ru']);

/**
 * Діаспорний бізнес у США має 2, максимум 3 мови: EN + RU/UK (+ іноді ES).
 * Сайт із 10+ мовами — це глобальний продукт або НКО з волонтерським перекладом,
 * і наявність `ru` серед них не говорить нічого про власника.
 * Без цієї поправки gnu.org отримує 45 балів як «російський бізнес».
 */
function versionWeight(base: number, totalLanguages: number): number {
  if (totalLanguages <= 3) return base;
  if (totalLanguages <= 5) return Math.round(base * 0.4);
  return 5;
}

/**
 * 90% мультимовних сайтів декларують себе явно. Це вичерпуємо ПЕРШИМ —
 * нуль додаткових HTTP-запитів, бо HTML уже завантажений.
 */
export function declaredLanguages(html: string, baseUrl: string): DeclaredLangs {
  const found = new Map<string, string>();
  const evidence: Evidence[] = [];
  const allLangs = new Set<string>();

  const abs = (href: string): string | null => {
    try {
      return new URL(href, baseUrl).toString();
    } catch {
      return null;
    }
  };

  // 1. hreflang — стандарт, найнадійніше
  for (const m of html.matchAll(/<link[^>]+rel=["']alternate["'][^>]*>/gi)) {
    const tag = m[0];
    const lang = /hreflang=["']([a-z]{2})(?:[-_][A-Za-z]{2})?["']/i.exec(tag)?.[1]?.toLowerCase();
    const href = /href=["']([^"']+)["']/i.exec(tag)?.[1];
    if (!lang) continue;
    if (lang !== 'x-') allLangs.add(lang);
    if (href && SLAVIC.has(lang)) {
      const u = abs(href);
      if (u) found.set(lang, u);
    }
  }

  // Скільки мов декларує сайт загалом — рахуємо ще й по роутах у перемикачі
  for (const m of html.matchAll(
    /href=["'][^"']*(?:\/([a-z]{2})\/|[?&](?:lang|language|locale)=([a-z]{2}))(?:["'?#]|\/)/gi,
  )) {
    const code = (m[1] ?? m[2] ?? '').toLowerCase();
    if (code && code !== 'js' && code !== 'css') allLangs.add(code);
  }
  const totalLanguages = Math.max(allLangs.size, 1);

  if (found.size) {
    evidence.push({
      signal: 'hreflang_slavic',
      weight: versionWeight(45, totalLanguages),
      detail:
        `hreflang: ${[...found.keys()].join(', ')}` +
        (totalLanguages > 3 ? ` (але сайт має ${totalLanguages} мов — типовий i18n, не діаспора)` : ''),
    });
  }

  // 2. og:locale:alternate
  for (const m of html.matchAll(/property=["']og:locale:alternate["'][^>]*content=["']([a-z]{2})[_-]/gi)) {
    const lang = m[1]!.toLowerCase();
    if (SLAVIC.has(lang) && !found.has(lang)) {
      found.set(lang, baseUrl);
      evidence.push({ signal: 'og_locale_alternate', weight: 30, detail: `og:locale ${lang}` });
    }
  }

  // 3. JSON-LD inLanguage
  for (const m of html.matchAll(/"inLanguage"\s*:\s*"([a-z]{2})/gi)) {
    const lang = m[1]!.toLowerCase();
    if (SLAVIC.has(lang) && !found.has(lang)) {
      found.set(lang, baseUrl);
      evidence.push({ signal: 'jsonld_inlanguage', weight: 25, detail: `inLanguage ${lang}` });
    }
  }

  // 4. <html lang>
  const htmlLang = /<html[^>]+lang=["']([a-z]{2})/i.exec(html)?.[1]?.toLowerCase() ?? null;
  if (htmlLang && SLAVIC.has(htmlLang)) {
    evidence.push({ signal: 'html_lang', weight: 30, detail: `<html lang="${htmlLang}">` });
    if (!found.has(htmlLang)) found.set(htmlLang, baseUrl);
  }

  // 5. DOM-перемикач: будь-яке посилання на мовний роут
  const switchRe = /href=["']([^"']*(?:\/(?:ru|uk|ua)(?:\/|["'?#])|[?&](?:lang|language|locale)=(?:ru|uk|ua)))/gi;
  let switcherHits = 0;
  for (const m of html.matchAll(switchRe)) {
    const href = m[1]!;
    const codeRaw =
      /\/(ru|uk|ua)(?:\/|["'?#])/i.exec(href)?.[1] ??
      /[?&](?:lang|language|locale)=(ru|uk|ua)/i.exec(href)?.[1];
    if (!codeRaw) continue;
    const code = codeRaw.toLowerCase() === 'ua' ? 'uk' : codeRaw.toLowerCase();
    const u = abs(href);
    if (u && !found.has(code)) found.set(code, u);
    switcherHits++;
  }
  if (switcherHits) {
    evidence.push({
      signal: 'lang_switcher_link',
      weight: versionWeight(35, totalLanguages),
      detail:
        `перемикач мови на сторінці (${switcherHits} посил.)` +
        (totalLanguages > 3 ? `, всього ${totalLanguages} мов` : ''),
    });
  }

  // 6. Прапорці — характерна ознака старих сайтів
  const flagIcons =
    /src=["'][^"']*(?:flags?[\/_-])?(?:ua|ukr|ukraine|rus|russia)(?:[-_]?flag)?\.(?:png|gif|svg|jpe?g)/i.test(html);
  if (flagIcons) {
    evidence.push({ signal: 'flag_icons', weight: 15, detail: 'іконки прапорів UA/RU' });
  }

  return { found, htmlLang, flagIcons, totalLanguages, evidence };
}
