import { fetchPage } from '../util/http.js';
import { countMatches, CYRILLIC_RE, normalizeHtml, RU_GLYPHS_RE, sha1, UK_GLYPHS_RE } from '../util/text.js';
import type { Evidence } from '../types.js';

export interface ProbeHit {
  url: string;
  lang: 'uk' | 'ru';
  cyrChars: number;
}

export interface ProbeResult {
  hits: ProbeHit[];
  requestsUsed: number;
  evidence: Evidence[];
}

const CANDIDATES = ['/ru/', '/uk/', '/ua/', '?lang=ru', '?lang=uk'];

const SOFT_404_TEXT =
  /page not found|404 error|nothing found|no results found|страница не найдена|сторінку не знайдено|oops/i;

/**
 * Пробінг мовних роутів з БАЗОВОЮ ЛІНІЄЮ.
 *
 * Наївна перевірка «GET /ru → 200 ⇒ є російська версія» дає масу хибних
 * спрацювань: SPA і WordPress з catch-all віддають 200 на будь-який шлях.
 * Тому спершу міряємо, як сайт відповідає на завідомо неіснуючий URL,
 * і відкидаємо все, що на нього схоже.
 */
export async function probeLanguageRoutes(
  baseUrl: string,
  homeHtml: string,
  opts: { timeoutMs: number; perHostDelayMs: number },
): Promise<ProbeResult> {
  const hits: ProbeHit[] = [];
  const evidence: Evidence[] = [];
  let requests = 0;

  const fetchOpts = {
    timeoutMs: opts.timeoutMs,
    perHostDelayMs: opts.perHostDelayMs,
    retries: 0,
    maxBytes: 600_000,
  };

  // ── базова лінія: як виглядає «нічого нема»
  const junkUrl = new URL(`/zqx-probe-${Date.now().toString(36)}-nope`, baseUrl).toString();
  const junk = await fetchPage(junkUrl, fetchOpts);
  requests++;

  const junkFp = junk.body ? sha1(normalizeHtml(junk.body)) : null;
  const junkLen = junk.body.length;
  const homeFp = sha1(normalizeHtml(homeHtml));

  // Сайт віддає 404 як належить — пробінг буде чистим і дешевим.
  const honest404 = junk.status === 404;

  for (const path of CANDIDATES) {
    let url: string;
    try {
      url = path.startsWith('?')
        ? (() => {
            const u = new URL(baseUrl);
            const [k, v] = path.slice(1).split('=');
            u.searchParams.set(k!, v!);
            return u.toString();
          })()
        : new URL(path, baseUrl).toString();
    } catch {
      continue;
    }

    const res = await fetchPage(url, fetchOpts);
    requests++;

    if (!res.ok || res.status !== 200 || !res.body) continue;

    const fp = sha1(normalizeHtml(res.body));

    if (!honest404 && junkFp && fp === junkFp) continue;               // catch-all
    if (fp === homeFp) continue;                                       // редірект назад на головну
    if (!honest404 && Math.abs(res.body.length - junkLen) < 200) continue; // майже той самий 404
    if (SOFT_404_TEXT.test(res.body.slice(0, 4000))) continue;         // soft 404 текстом

    const cyr = countMatches(res.body, CYRILLIC_RE);
    if (cyr < 150) continue;                                           // сторінка є, але не кирилична

    const uk = countMatches(res.body, UK_GLYPHS_RE);
    const ru = countMatches(res.body, RU_GLYPHS_RE);
    hits.push({ url, lang: uk > ru ? 'uk' : 'ru', cyrChars: cyr });
  }

  if (hits.length) {
    /*
     * Вага 32, а не 40 (як у hreflang). Знайдений роут доводить лише, що плагін
     * перекладу вміє цю мову — це слабше за hreflang, який власник налаштував
     * свідомо. На пілоті корейський супермаркет Joong Boo отримав 75 балів саме
     * через робочу ?lang=ru від Polylang. З вагою 32 такі випадки падають нижче
     * порогу лідів і йдуть на ручну перевірку, а підтверджені іншими сигналами
     * (кирилиця, Viber, прізвище) лишаються лідами.
     */
    evidence.push({
      signal: 'lang_route_confirmed',
      weight: 32,
      detail: `робоча ${hits[0]!.lang === 'uk' ? 'укр' : 'рос'} версія: ${hits[0]!.url}`,
    });
  }

  return { hits, requestsUsed: requests, evidence };
}

/**
 * Серверна мовна негоціація. Next.js i18n, Nuxt i18n, Django, Laravel
 * віддають іншу мову за заголовком Accept-Language — без жодного /ru в URL.
 * Пробінг роутів такі сайти не бачить взагалі. Один запит.
 */
export async function probeAcceptLanguage(
  baseUrl: string,
  homeHtml: string,
  opts: { timeoutMs: number; perHostDelayMs: number },
): Promise<{ matched: boolean; lang: 'uk' | 'ru' | null; evidence: Evidence[] }> {
  const res = await fetchPage(baseUrl, {
    timeoutMs: opts.timeoutMs,
    perHostDelayMs: opts.perHostDelayMs,
    retries: 0,
    maxBytes: 600_000,
    acceptLanguage: 'uk-UA,uk;q=0.9,ru;q=0.8,en;q=0.1',
  });

  if (!res.ok || !res.body) return { matched: false, lang: null, evidence: [] };

  const changed = sha1(normalizeHtml(res.body)) !== sha1(normalizeHtml(homeHtml));
  const cyr = countMatches(res.body, CYRILLIC_RE);
  if (!changed || cyr < 100) return { matched: false, lang: null, evidence: [] };

  const uk = countMatches(res.body, UK_GLYPHS_RE);
  const ru = countMatches(res.body, RU_GLYPHS_RE);
  const lang: 'uk' | 'ru' = uk > ru ? 'uk' : 'ru';

  return {
    matched: true,
    lang,
    evidence: [{
      signal: 'accept_language_negotiation',
      weight: 35,
      detail: `сайт віддає ${lang === 'uk' ? 'укр' : 'рос'} за Accept-Language`,
    }],
  };
}
