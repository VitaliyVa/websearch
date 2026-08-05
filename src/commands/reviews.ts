import { loadPreset, requireEnv } from '../config.js';
import {
  getAudit, getOwnerScore, getPlaces, getPsi, saveReviewSignal,
} from '../db/index.js';
import { FREE_TIER, paidSpendAllowed, remaining, used } from '../quota.js';
import { reviewLanguageSignal } from '../detect/reviews-language.js';
import { QuotaExceeded } from '../sources/places.js';
import type { Evidence, LangSignal, PsiResult, SiteAudit } from '../types.js';
import { log, progress } from '../util/log.js';
import { scoreSite } from '../score/quality.js';
import { decide } from './audit.js';

export interface ReviewsOpts {
  preset: string;
  limit: number | null;
  allowPaid: boolean;
}

/**
 * L3 — мовний сигнал з Google-відгуків.
 * Запускається ТІЛЬКИ для тих, кому сайтових сигналів не вистачило: це єдиний
 * спосіб побачити асимільований діаспорний бізнес з англомовним сайтом.
 */
export async function reviews(opts: ReviewsOpts) {
  const preset = loadPreset(opts.preset);
  requireEnv(['placesKey'], 'reviews');

  const allowPaid = paidSpendAllowed(opts.allowPaid);
  const cap = allowPaid
    ? preset.budget.maxPlaceDetailsRequests
    : Math.min(preset.budget.maxPlaceDetailsRequests, FREE_TIER.place_details);

  if (opts.allowPaid && !allowPaid) {
    log.warn('--allow-paid проігноровано: потрібна ще й змінна ALLOW_PAID_SPEND=yes у .env');
  }

  /*
   * Порядок черги вирішує все, бо квота обрізає хвіст.
   *
   * Головний критерій — наявний мовний скор DESC, а не якість сайту. Місце зі
   * скором 55 потребує лише +15, щоб стати лідом; місце зі скором 0 потребує
   * рівно максимуму й лише за ідеальних відгуків. За однакової ціни виклику
   * перше дає результат набагато частіше.
   *
   * Далі — кількість відгуків DESC: у Places API вибірка все одно 5 штук, але
   * бізнес із 200 відгуками живий і платоспроможний, а з 6 — ні.
   * Останнє — гірший сайт першим.
   */
  let places = getPlaces(
    `WHERE bucket = 'pending'
     ORDER BY COALESCE((SELECT score FROM owner_scores os WHERE os.place_id = places.place_id), 0) DESC,
              COALESCE(user_rating_count, 0) DESC,
              COALESCE((SELECT site_score FROM site_audits sa WHERE sa.place_id = places.place_id), 5) ASC`,
  );
  if (opts.limit) places = places.slice(0, opts.limit);

  const spent = used('place_details');
  const budgetLeft = remaining('place_details', cap);

  log.step(`L3 Reviews — кандидатів ${places.length}`);
  log.dim(`квота Place Details: витрачено ${spent} / ${cap} (лишилось ${budgetLeft})`);

  if (!allowPaid && places.length > budgetLeft) {
    log.warn(
      `Кандидатів більше, ніж лишилось квоти. Оброблю ${budgetLeft} найпріоритетніших ` +
        `(найгірші сайти + найбільше відгуків). Решта лишиться в черзі до наступного місяця ` +
        `або дай --allow-paid (~$40 за 1000).`,
    );
    places = places.slice(0, budgetLeft);
  }

  if (!places.length) {
    log.info('нема кандидатів. Або все вже оброблено, або квота вичерпана.');
    return;
  }

  const stats = { leads: 0, manual: 0, rejected: 0, withSignal: 0 };
  let done = 0;

  for (const place of places) {
    try {
      const signal = await reviewLanguageSignal(place.place_id, cap, allowPaid);
      saveReviewSignal(place.place_id, signal);
      if (signal.score > 0) stats.withSignal++;

      const auditRow = getAudit(place.place_id);
      const siteAudit: SiteAudit | null = auditRow ? JSON.parse(auditRow.audit_json) : null;
      const siteLang: LangSignal | null = auditRow?.lang_json ? JSON.parse(auditRow.lang_json) : null;
      // Критично: без цих доказів owner score перерахувався б без 30-45 балів
      // за наявність /ru чи /uk версії, і найсильніші ліди провалились би нижче порогу.
      const versionEvidence: Evidence[] = auditRow?.version_evidence_json
        ? JSON.parse(auditRow.version_evidence_json)
        : [];

      /*
       * Перераховуємо вердикт про сайт, а не беремо лише збережений бал.
       *
       * У БД лежить число, але не те, ЧОМУ воно таке: чи сайт справді поганий,
       * чи ми його взагалі не бачили через bot-protection. Без цієї різниці
       * заблокований сайт із сильним мовним сигналом падав прямо в Ліди.
       * scoreSite чиста, тож перерахунок нічого не коштує.
       */
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
      const quality = scoreSite(siteAudit, psi, !!place.website);

      const verdict = decide({
        place: {
          placeId: place.place_id, name: place.name, website: place.website ?? '',
          typesJson: place.types_json, userRatingCount: place.user_rating_count,
          manualVerdict: place.manual_verdict, manualVerdictReason: place.manual_verdict_reason,
              primaryType: place.primary_type,
        },
        audit: siteAudit,
        lang: siteLang,
        versionEvidence,
        siteScore10: auditRow?.site_score ?? quality.score10,
        siteStatus: quality.status,
        datedMarkers: quality.datedMarkers,
        psiDone: !!psiRow,
        reviews: signal,
        preset,
      });

      if (verdict.bucket === 'leads') stats.leads++;
      else if (verdict.bucket === 'manual' || verdict.bucket === 'pending') stats.manual++;
      else stats.rejected++;
    } catch (e) {
      if (e instanceof QuotaExceeded) {
        console.log('');
        log.warn(e.message);
        break;
      }
      log.err(`${place.name}: ${e instanceof Error ? e.message : e}`);
    }
    progress('reviews', ++done, places.length);
  }

  console.log('');
  log.ok(`мовний сигнал з відгуків знайдено у ${stats.withSignal} з ${done}`);
  log.dim(`→ Leads: ${stats.leads}, Manual review: ${stats.manual}, Rejected: ${stats.rejected}`);
  log.dim(`квота Place Details за місяць: ${used('place_details')} / ${cap}`);
}

export { getOwnerScore };
