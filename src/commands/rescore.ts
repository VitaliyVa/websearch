import * as cheerio from 'cheerio';
import { loadPreset } from '../config.js';
import { readCache } from '../audit/site.js';
import { getAudit, getPlaces, getReviewSignal, saveAudit } from '../db/index.js';
import { detectSiteLanguage } from '../detect/site-language.js';
import { detectTech, footerYear } from '../detect/tech.js';
import { extractEmails, extractSocials } from '../detect/contacts.js';
import { withOwnerName } from '../detect/owner-name.js';
import { estimateHours } from '../score/hours.js';
import { scoreSite } from '../score/quality.js';
import { getPsi } from '../db/index.js';
import type { Evidence, LangSignal, PsiResult, SiteAudit } from '../types.js';
import { log, progress } from '../util/log.js';
import { hostOf, htmlToText } from '../util/text.js';
import { decide, toReviewSignal } from './audit.js';

/**
 * Переоцінка збережених сторінок БЕЗ мережі.
 *
 * Ваги сигналів доводиться правити на реальних даних — за цей прогін ми вже
 * тричі змінювали скоринг, і щоразу це означало 90 хвилин і 3500 повторних
 * запитів до чужих сайтів. Маючи HTML у кеші, та сама переоцінка займає хвилини
 * і не турбує нікого.
 *
 * Що НЕ перераховується: пробінг мовних роутів і Accept-Language — це мережеві
 * перевірки. Їх результат береться зі збереженого version_evidence_json.
 */
export function rescore(presetName: string, limit: number | null) {
  const preset = loadPreset(presetName);

  let places = getPlaces("WHERE website IS NOT NULL AND stage != 'discovered'");
  if (limit) places = places.slice(0, limit);

  log.step(`Переоцінка з кешу — ${places.length} сайтів (0 мережевих запитів)`);

  let done = 0;
  let missing = 0;
  const moved = { toLeads: 0, toManual: 0, toRejected: 0, toPending: 0 };

  for (const place of places) {
    const cached = readCache(place.place_id);
    const row = getAudit(place.place_id);

    if (!cached || !row) {
      missing++;
      progress('rescore', ++done, places.length);
      continue;
    }

    const prevBucket = place.bucket;
    const oldAudit: SiteAudit = JSON.parse(row.audit_json);
    const html = cached.html;
    const host = hostOf(cached.finalUrl);
    const $ = cheerio.load(html);
    const text = htmlToText(html);

    // Перераховуємо все, що виводиться з HTML
    const emails = extractEmails(html);
    const lang: LangSignal = withOwnerName(detectSiteLanguage({ html, text, host }), html, emails);
    const tech = detectTech(html);

    const audit: SiteAudit = {
      ...oldAudit,
      jqueryVersion: tech.jqueryVersion,
      bootstrapMajor: tech.bootstrapMajor,
      hasFlash: tech.hasFlash,
      tableLayout: tech.tableLayout,
      modernFramework: tech.modernFramework,
      cms: tech.cms,
      builder: tech.builder,
      techStack: tech.stack,
      footerYear: footerYear(html),
      hasViewportMeta: $('meta[name="viewport"]').length > 0,
      title: $('title').first().text().trim() || null,
      metaDescription: $('meta[name="description"]').attr('content')?.trim() || null,
      h1: $('h1').first().text().trim() || null,
      ogTags: $('meta[property^="og:"]').length > 0,
      favicon: $('link[rel*="icon"]').length > 0,
      emails,
      socials: extractSocials(html),
    };

    const psiRow = getPsi(place.place_id);
    const psi: PsiResult | null = psiRow
      ? {
          mobileScore: psiRow.mobile_score,
          desktopScore: psiRow.desktop_score,
          lcpMs: psiRow.lcp_ms,
          cls: psiRow.cls,
          fetchedAt: psiRow.fetched_at,
        }
      : null;

    const quality = scoreSite(audit, psi, true);
    const hours = estimateHours(audit.fetchError ? null : audit);
    const versionEvidence: Evidence[] = row.version_evidence_json
      ? JSON.parse(row.version_evidence_json)
      : [];

    saveAudit(place.place_id, audit, lang, quality.score10, quality.reasons, hours, versionEvidence);

    const reviewRow = getReviewSignal(place.place_id);
    const verdict = decide({
      place: { placeId: place.place_id, name: place.name, website: place.website!, typesJson: place.types_json },
      audit,
      lang,
      versionEvidence,
      siteScore10: quality.score10,
      datedMarkers: quality.datedMarkers,
      psiDone: !!psi,
      reviews: reviewRow ? toReviewSignal(reviewRow) : null,
      preset,
    });

    if (verdict.bucket !== prevBucket) {
      if (verdict.bucket === 'leads') moved.toLeads++;
      else if (verdict.bucket === 'manual') moved.toManual++;
      else if (verdict.bucket === 'rejected') moved.toRejected++;
      else moved.toPending++;
    }

    progress('rescore', ++done, places.length);
  }

  console.log('');
  log.ok(`переоцінено ${done - missing} сайтів`);
  if (missing) log.dim(`без кешу (аудитовані до появи кешування): ${missing} — їх треба через audit --force`);
  log.dim(
    `змінили статус → Leads: ${moved.toLeads}, Manual: ${moved.toManual}, ` +
      `Rejected: ${moved.toRejected}, у чергу: ${moved.toPending}`,
  );
}
