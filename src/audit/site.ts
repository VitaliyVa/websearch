import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as cheerio from 'cheerio';
import { paths } from '../config.js';
import { declaredLanguages } from '../detect/multilang-declared.js';
import { probeAcceptLanguage, probeLanguageRoutes } from '../detect/lang-probe.js';
import { detectSiteLanguage } from '../detect/site-language.js';
import { detectStructure } from '../detect/pages.js';
import { detectTech, footerYear } from '../detect/tech.js';
import { extractEmails, extractSocials } from '../detect/contacts.js';
import { withOwnerName } from '../detect/owner-name.js';
import { checkTls } from './tls.js';
import { fetchPage } from '../util/http.js';
import { htmlToText, hostOf, safeUrl } from '../util/text.js';
import type { Evidence, LangSignal, SiteAudit } from '../types.js';

/** Ті самі коди, що в score/quality.ts — сайт закрито, а не зламано. */
const BLOCKED_STATUSES = new Set([401, 403, 406, 429, 451]);

export interface AuditOptions {
  fetchTimeoutMs: number;
  maxHtmlBytes: number;
  perHostDelayMs: number;
  enableLangProbe: boolean;
  enableAcceptLanguageProbe: boolean;
  enablePlaywrightFallback: boolean;
  /**
   * Куди зберегти завантажений HTML. Дає змогу переоцінювати скоринг без
   * повторного обходу мережі — ми вже тричі перезапускали аудит через зміни
   * у вагах, і щоразу це коштувало 90 хвилин і 3500 запитів до чужих сайтів.
   */
  cacheKey?: string;
}

export interface AuditOutcome {
  audit: SiteAudit;
  lang: LangSignal;
  declaredEvidence: Evidence[];
  probeEvidence: Evidence[];
  acceptLangEvidence: Evidence[];
  langVersionUrls: string[];
}

const EMPTY_AUDIT = (err: string, url: string | null): SiteAudit => ({
  finalUrl: url, httpStatus: null, fetchError: err, redirectedToDifferentHost: false,
  https: false, tlsExpired: false, mixedContent: false,
  hasViewportMeta: false, title: null, metaDescription: null, h1: null,
  ogTags: false, favicon: false, charsetDeclared: false,
  jqueryVersion: null, bootstrapMajor: null, hasFlash: false, tableLayout: false,
  modernFramework: null, cms: null, builder: null, techStack: [],
  footerYear: null, pageCount: 0, uniquePageTypes: 0,
  hasCatalog: false, hasEcommerce: false, hasForms: false, languages: 1,
  emails: [], socials: {}, renderedWithBrowser: false, htmlBytes: 0,
});

export async function auditSite(rawUrl: string, opts: AuditOptions): Promise<AuditOutcome> {
  const url = safeUrl(rawUrl);
  const emptyLang: LangSignal = { score: 0, lang: null, evidence: [], hardExclusion: null };

  if (!url) {
    return {
      audit: EMPTY_AUDIT('bad-url', rawUrl), lang: emptyLang,
      declaredEvidence: [], probeEvidence: [], acceptLangEvidence: [], langVersionUrls: [],
    };
  }

  const res = await fetchPage(url, {
    timeoutMs: opts.fetchTimeoutMs,
    maxBytes: opts.maxHtmlBytes,
    perHostDelayMs: opts.perHostDelayMs,
    retries: 1,
  });

  let html = res.body;
  let renderedWithBrowser = false;
  let recoveredStatus: number | null = null;

  const blockedByBot = res.status != null && BLOCKED_STATUSES.has(res.status);

  // Playwright-fallback у двох випадках:
  //  1. cheerio бачить порожню SPA-оболонку;
  //  2. bot-protection віддала 403/429 звичайному HTTP-клієнту — реальний
  //     браузер часто проходить, і лід не втрачається.
  if (opts.enablePlaywrightFallback && ((res.ok && isEmptyShell(html)) || blockedByBot)) {
    const rendered = await renderWithPlaywright(url, opts.fetchTimeoutMs);
    if (rendered && htmlToText(rendered).length > 250) {
      html = rendered;
      renderedWithBrowser = true;
      if (blockedByBot) recoveredStatus = 200;
    }
  }

  if ((!res.ok && !recoveredStatus) || !html) {
    const audit = EMPTY_AUDIT(res.error ?? 'empty-body', res.finalUrl ?? url);
    audit.httpStatus = res.status;
    audit.redirectedToDifferentHost = res.redirectedToDifferentHost;
    return {
      audit, lang: emptyLang,
      declaredEvidence: [], probeEvidence: [], acceptLangEvidence: [], langVersionUrls: [],
    };
  }

  const finalUrl = res.finalUrl ?? url;
  const host = hostOf(finalUrl);

  if (opts.cacheKey) writeCache(opts.cacheKey, finalUrl, html);

  const $ = cheerio.load(html);
  const text = htmlToText(html);

  /* ──────────────  мова: дешеве → дороге  ────────────── */

  // Крок 0 — з уже завантаженого HTML, 0 додаткових запитів
  const declared = declaredLanguages(html, finalUrl);
  const langVersionUrls = [...declared.found.values()];

  // Крок 1 — Accept-Language, 1 запит. Ловить серверну негоціацію
  // (Next/Nuxt/Django), яку пробінг URL не бачить у принципі.
  let acceptLangEvidence: Evidence[] = [];
  if (opts.enableAcceptLanguageProbe && declared.found.size === 0) {
    const al = await probeAcceptLanguage(finalUrl, html, {
      timeoutMs: opts.fetchTimeoutMs,
      perHostDelayMs: opts.perHostDelayMs,
    });
    acceptLangEvidence = al.evidence;
  }

  // Крок 2 — пробінг роутів, 3-6 запитів, тільки якщо попереднє нічого не дало
  let probeEvidence: Evidence[] = [];
  if (
    opts.enableLangProbe &&
    declared.found.size === 0 &&
    acceptLangEvidence.length === 0
  ) {
    const probe = await probeLanguageRoutes(finalUrl, html, {
      timeoutMs: opts.fetchTimeoutMs,
      perHostDelayMs: opts.perHostDelayMs,
    });
    probeEvidence = probe.evidence;
    for (const h of probe.hits) langVersionUrls.push(h.url);
  }

  const emails = extractEmails(html);
  // Прізвище власника — сильніший доказ за імена клієнтів: воно про саму людину,
  // що володіє бізнесом. Дістається з тієї ж сторінки, без додаткових запитів.
  const lang = withOwnerName(detectSiteLanguage({ html, text, host }), html, emails);

  /* ──────────────  технічний аудит  ────────────── */

  const tech = detectTech(html);
  const structure = await detectStructure(finalUrl, html);
  const tls = finalUrl.startsWith('https:')
    ? await checkTls(host)
    : { valid: false, expired: false, daysLeft: null, error: 'no-https' };

  const https = finalUrl.startsWith('https:');
  const mixedContent =
    https && /(?:src|href)=["']http:\/\/(?!localhost)/i.test(html);

  const audit: SiteAudit = {
    finalUrl,
    httpStatus: recoveredStatus ?? res.status,
    fetchError: null,
    redirectedToDifferentHost: res.redirectedToDifferentHost,

    https,
    tlsExpired: tls.expired,
    mixedContent,

    hasViewportMeta: $('meta[name="viewport"]').length > 0,
    title: $('title').first().text().trim() || null,
    metaDescription: $('meta[name="description"]').attr('content')?.trim() || null,
    h1: $('h1').first().text().trim() || null,
    ogTags: $('meta[property^="og:"]').length > 0,
    favicon: $('link[rel*="icon"]').length > 0,
    charsetDeclared: /<meta[^>]+charset/i.test(html),

    jqueryVersion: tech.jqueryVersion,
    bootstrapMajor: tech.bootstrapMajor,
    hasFlash: tech.hasFlash,
    tableLayout: tech.tableLayout,
    modernFramework: tech.modernFramework,
    cms: tech.cms,
    builder: tech.builder,
    techStack: tech.stack,

    footerYear: footerYear(html),
    pageCount: structure.pageCount,
    uniquePageTypes: structure.uniquePageTypes,
    hasCatalog: structure.hasCatalog,
    hasEcommerce: structure.hasEcommerce,
    hasForms: structure.hasForms,
    languages: Math.max(structure.languages, declared.found.size ? declared.found.size + 1 : 1),

    emails,
    socials: extractSocials(html),
    renderedWithBrowser,
    htmlBytes: res.bytes,
  };

  return {
    audit,
    lang,
    declaredEvidence: declared.evidence,
    probeEvidence,
    acceptLangEvidence,
    langVersionUrls: [...new Set(langVersionUrls)],
  };
}

/* ─────────────────────────  кеш HTML на диску  ───────────────────────── */

export interface CachedPage {
  finalUrl: string;
  fetchedAt: string;
  html: string;
}

const cacheFile = (key: string) => resolve(paths.cache, `${key}.json`);

function writeCache(key: string, finalUrl: string, html: string) {
  try {
    const payload: CachedPage = { finalUrl, fetchedAt: new Date().toISOString(), html };
    writeFileSync(cacheFile(key), JSON.stringify(payload), 'utf8');
  } catch {
    /* кеш — оптимізація, його відсутність не має ламати аудит */
  }
}

export function readCache(key: string): CachedPage | null {
  try {
    const f = cacheFile(key);
    if (!existsSync(f)) return null;
    return JSON.parse(readFileSync(f, 'utf8')) as CachedPage;
  } catch {
    return null;
  }
}

/** SPA-оболонка: тегів багато, а тексту майже нема. */
function isEmptyShell(html: string): boolean {
  if (!html) return false;
  const text = htmlToText(html);
  return text.length < 250 && html.length > 500;
}

let playwrightUnavailable = false;

async function renderWithPlaywright(url: string, timeoutMs: number): Promise<string | null> {
  if (playwrightUnavailable) return null;
  try {
    const { chromium } = await import('playwright');
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({
        viewport: { width: 1440, height: 900 },
        userAgent:
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      });
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
      await page.waitForTimeout(1500);
      return await page.content();
    } finally {
      await browser.close();
    }
  } catch {
    // playwright не встановлено або браузери не завантажені — вимикаємо на весь прогін
    playwrightUnavailable = true;
    return null;
  }
}
