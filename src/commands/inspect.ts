import { loadPreset } from '../config.js';
import { auditSite } from '../audit/site.js';
import { nameSignal } from '../detect/name-signal.js';
import { estimateHours, formatHours } from '../score/hours.js';
import { scoreOwner } from '../score/owner.js';
import { scoreSite } from '../score/quality.js';
import { log } from '../util/log.js';
import { hostOf } from '../util/text.js';

/**
 * Ручна перевірка одного сайту без запису в базу і без викликів Google.
 * Потрібна для двох речей: підбір порогів на реальних прикладах і розбір
 * спірних лідів з вкладки Manual review.
 */
export async function inspect(url: string, businessName: string, presetName: string) {
  const preset = loadPreset(presetName);

  log.step(`Inspect: ${url}`);
  const started = Date.now();

  const r = await auditSite(url, {
    fetchTimeoutMs: preset.audit.fetchTimeoutMs,
    maxHtmlBytes: preset.audit.maxHtmlBytes,
    perHostDelayMs: preset.audit.perHostDelayMs,
    enableLangProbe: preset.audit.enableLangProbe,
    enableAcceptLanguageProbe: preset.audit.enableAcceptLanguageProbe,
    enablePlaywrightFallback: preset.audit.enablePlaywrightFallback,
  });

  const a = r.audit;
  const quality = scoreSite(a, null, true);
  const hours = estimateHours(a.fetchError ? null : a);
  const nm = nameSignal(businessName || a.title || '', hostOf(a.finalUrl ?? url));
  const owner = scoreOwner({
    site: r.lang,
    reviews: null,
    name: nm,
    declaredEvidence: [...r.declaredEvidence, ...r.probeEvidence, ...r.acceptLangEvidence],
    thresholds: {
      lead: preset.thresholds.ownerScoreLead,
      manual: preset.thresholds.ownerScoreManual,
    },
  });

  const yn = (v: boolean) => (v ? 'так' : 'НІ');

  console.log(`\n  ФЕТЧ  (${((Date.now() - started) / 1000).toFixed(1)}с)`);
  console.log(`    статус:        ${a.httpStatus ?? '—'}${a.fetchError ? `  помилка: ${a.fetchError}` : ''}`);
  console.log(`    фінальний URL: ${a.finalUrl ?? '—'}`);
  console.log(`    рендер:        ${a.renderedWithBrowser ? 'playwright (SPA)' : 'HTTP'}  ${a.htmlBytes} байт`);

  console.log(`\n  ТЕХНІЧНИЙ СТАН`);
  console.log(`    адаптивний:    ${yn(a.hasViewportMeta)}`);
  console.log(`    HTTPS:         ${yn(a.https)}  mixed=${yn(a.mixedContent)}  SSL прострочений=${yn(a.tlsExpired)}`);
  console.log(`    стек:          ${a.techStack.join(', ') || '—'}`);
  console.log(`    CMS/білдер:    ${[a.cms, a.builder].filter(Boolean).join(' / ') || '—'}`);
  console.log(`    сучасний фрв.: ${a.modernFramework ?? '—'}`);
  console.log(`    копірайт рік:  ${a.footerYear ?? '—'}`);
  console.log(`    SEO:           title=${yn(!!a.title)} desc=${yn(!!a.metaDescription)} h1=${yn(!!a.h1)} og=${yn(a.ogTags)}`);

  console.log(`\n  СТРУКТУРА`);
  console.log(`    сторінок:      ${a.pageCount}  унікальних типів: ${a.uniquePageTypes}`);
  console.log(`    каталог=${yn(a.hasCatalog)} ecommerce=${yn(a.hasEcommerce)} форми=${yn(a.hasForms)} мов=${a.languages}`);

  console.log(`\n  КОНТАКТИ`);
  console.log(`    email:         ${a.emails.join(', ') || '—'}`);
  console.log(`    соцмережі:     ${Object.entries(a.socials).map(([k, v]) => `${k}=${v}`).join('  ') || '—'}`);

  console.log(`\n  МОВНІ СИГНАЛИ`);
  const rows: [string, string][] = [
    ['кирилиця/месенджери', r.lang.evidence.map(fmt).join('; ') || '—'],
    ['декларовані версії', r.declaredEvidence.map(fmt).join('; ') || '—'],
    ['Accept-Language', r.acceptLangEvidence.map(fmt).join('; ') || '—'],
    ['пробінг роутів', r.probeEvidence.map(fmt).join('; ') || '—'],
    ['назва бізнесу', nm.evidence.map(fmt).join('; ') || '—'],
  ];
  for (const [k, v] of rows) console.log(`    ${k.padEnd(22)} ${v}`);
  if (r.langVersionUrls.length) console.log(`    ${'знайдені версії'.padEnd(22)} ${r.langVersionUrls.join(' | ')}`);
  if (r.lang.hardExclusion) console.log(`    ${'ВИКЛЮЧЕННЯ'.padEnd(22)} ${r.lang.hardExclusion}`);

  console.log(`\n  ВЕРДИКТ`);
  console.log(`    оцінка сайту:  ${quality.score10}/10  (${quality.status})`);
  console.log(`    причини:       ${quality.reasons.join('; ') || '—'}`);
  console.log(`    години:        ${formatHours(hours)}`);
  console.log(`      ${hours.breakdown.join('\n      ')}`);
  console.log(
    `    мовний скор:   ${owner.score}  → ${owner.bucket}` +
      `  (пороги: Leads ≥${preset.thresholds.ownerScoreLead}, Manual ≥${preset.thresholds.ownerScoreManual})`,
  );
  console.log(`    мова:          ${owner.lang ?? '—'}`);
  console.log(
    `    ВІДГУКИ НЕ ПЕРЕВІРЯЛИСЬ — у реальному прогоні вони можуть додати до +55 балів.\n`,
  );
}

const fmt = (e: { detail?: string; weight: number }) =>
  `${e.detail ?? '?'}${e.weight ? ` (+${e.weight})` : ''}`;
