import pLimit from 'p-limit';
import { loadPreset } from '../config.js';
import {
  getAudit, getPlaces, getPsi, getReviewSignal, savePsi, saveAudit, saveScreenshots, setStage,
} from '../db/index.js';
import { captureScreenshots } from '../enrich/screenshot.js';
import { runPsi } from '../enrich/psi.js';
import { estimateHours } from '../score/hours.js';
import { scoreSite } from '../score/quality.js';
import type { Evidence, LangSignal, SiteAudit } from '../types.js';
import { decide, toReviewSignal } from './audit.js';
import { log, progress } from '../util/log.js';

export interface EnrichOpts {
  preset: string;
  limit: number | null;
  skipScreenshots: boolean;
  skipPsi: boolean;
  /** Розширити на вкладку Manual review. За замовчуванням тільки підтверджені ліди. */
  includeManual: boolean;
}

/**
 * L4 — PSI + скріншоти. Тільки для тих, хто дійшов до Leads / Manual review:
 * PSI повільний (до 60с на URL), тож ганяти його по всій базі безглуздо.
 */
export async function enrich(opts: EnrichOpts) {
  const preset = loadPreset(opts.preset);

  // За замовчуванням тільки підтверджені ліди: PSI — найповільніша стадія
  // (~2 виклики по 20-60с на сайт), і міряти швидкість ще не підтвердженого
  // мовно бізнесу немає сенсу. Manual review доганяємо окремим прогоном
  // після того, як продажник розбере чергу.
  const bucketFilter = opts.includeManual ? "('leads','manual')" : "('leads')";

  let places = getPlaces(
    `WHERE bucket IN ${bucketFilter} AND website IS NOT NULL
     ORDER BY COALESCE((SELECT site_score FROM site_audits sa WHERE sa.place_id = places.place_id), 5) ASC`,
  );
  if (opts.limit) places = places.slice(0, opts.limit);

  log.step(`L4 Enrich — ${places.length} ${opts.includeManual ? 'лідів + ручна черга' : 'підтверджених лідів'}`);
  if (!places.length) {
    log.info('нема що збагачувати.');
    return;
  }

  const doPsi = preset.audit.enablePsi && !opts.skipPsi;
  const doShots = preset.audit.enableScreenshots && !opts.skipScreenshots;
  log.dim(`PSI: ${doPsi ? 'так' : 'ні'}, скріншоти: ${doShots ? 'так' : 'ні'}`);

  // PSI має прихований per-origin rate limit — паралелимо помірно
  const psiLimit = pLimit(4);
  let done = 0;
  let rejectedAfterPsi = 0;

  await Promise.all(
    places.map((place) =>
      psiLimit(async () => {
        const url = place.website!;
        try {
          if (doPsi && !getPsi(place.place_id)) {
            const psi = await runPsi(url);
            savePsi(place.place_id, psi);

            // Перерахунок оцінки сайту вже з даними швидкості
            const row = getAudit(place.place_id);
            if (row) {
              const siteAudit: SiteAudit = JSON.parse(row.audit_json);
              const lang: LangSignal | null = row.lang_json ? JSON.parse(row.lang_json) : null;
              const quality = scoreSite(siteAudit, psi, true);
              const hours = estimateHours(siteAudit.fetchError ? null : siteAudit);
              saveAudit(place.place_id, siteAudit, lang, quality.score10, quality.reasons, hours);

              // Тепер, коли швидкість відома, ПЕРЕВИНОСИМО вердикт через ту саму
              // decide(), що й на попередніх стадіях — щоб правила жили в одному місці.
              const versionEvidence: Evidence[] = row.version_evidence_json
                ? JSON.parse(row.version_evidence_json)
                : [];
              const reviewRow = getReviewSignal(place.place_id);

              const verdict = decide({
                place: {
                  placeId: place.place_id, name: place.name, website: url,
                  typesJson: place.types_json, userRatingCount: place.user_rating_count,
                },
                audit: siteAudit,
                lang,
                versionEvidence,
                siteScore10: quality.score10,
                siteStatus: quality.status,
                datedMarkers: quality.datedMarkers,
                psiDone: true,
                reviews: reviewRow ? toReviewSignal(reviewRow) : null,
                preset,
              });

              if (verdict.bucket === 'rejected') {
                rejectedAfterPsi++;
                return;
              }
            }
          }

          if (doShots) {
            const shots = await captureScreenshots(url, place.place_id);
            if (shots.desktop || shots.mobile) {
              saveScreenshots(place.place_id, shots.desktop, shots.mobile);
            }
          }

          setStage(place.place_id, 'enriched');
        } catch (e) {
          log.err(`${place.name}: ${e instanceof Error ? e.message : e}`);
        } finally {
          progress('enrich', ++done, places.length);
        }
      }),
    ),
  );

  console.log('');
  log.ok('збагачення завершено');
  if (rejectedAfterPsi) {
    log.dim(`відсіяно після заміру швидкості (сайт виявився нормальним): ${rejectedAfterPsi}`);
  }
}
