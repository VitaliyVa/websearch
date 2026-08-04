import { loadPreset } from '../config.js';
import { countPlaces } from '../db/index.js';
import { log } from '../util/log.js';
import { audit } from './audit.js';
import { discover } from './discover.js';
import { enrich } from './enrich.js';
import { exportSheets } from './export.js';
import { reviews } from './reviews.js';
import { stats } from './stats.js';

export interface RunOpts {
  preset: string;
  allowPaid: boolean;
  skipExport: boolean;
  limit: number | null;
}

/** Повний прогін L0 → L5. Кожна стадія має власний стан, тож перезапуск безпечний. */
export async function run(opts: RunOpts) {
  const preset = loadPreset(opts.preset);
  const started = Date.now();

  log.step(`ПОВНИЙ ПРОГІН — "${preset.name}"`);
  log.dim(`метро: ${preset.metros.join(', ')} | тири: ${preset.tiers.join(', ')}`);
  log.dim(`пороги: мовний ≥${preset.thresholds.ownerScoreLead}, сайт ≤${preset.thresholds.siteScoreMaxForLead}/10`);

  await discover({ preset: opts.preset, dryRun: false, allowPaid: opts.allowPaid, limit: opts.limit });
  await audit({ preset: opts.preset, limit: opts.limit, force: false });
  await reviews({ preset: opts.preset, limit: opts.limit, allowPaid: opts.allowPaid });
  await enrich({
    preset: opts.preset, limit: opts.limit,
    skipScreenshots: false, skipPsi: false, includeManual: false,
  });

  if (!opts.skipExport) {
    await exportSheets({ preset: opts.preset, includeRejected: false });
  }

  const mins = ((Date.now() - started) / 60_000).toFixed(1);
  log.step(`Прогін завершено за ${mins} хв`);
  log.ok(
    `Leads: ${countPlaces("WHERE bucket = 'leads'")}, ` +
      `Manual: ${countPlaces("WHERE bucket IN ('manual','pending')")}, ` +
      `NO_SITE: ${countPlaces("WHERE bucket = 'no_site'")}`,
  );
  stats(opts.preset);
}
