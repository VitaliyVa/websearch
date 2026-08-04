import { allUsage, countPlaces, db, loadPresetSafe } from './stats-helpers.js';
import { log } from '../util/log.js';

export function stats(presetName: string) {
  const preset = loadPresetSafe(presetName);

  log.step('Стан бази');

  const total = countPlaces();
  if (!total) {
    log.info('база порожня. Почни з `npm run discover`.');
    return;
  }

  const buckets = db()
    .prepare('SELECT bucket, COUNT(*) AS c FROM places GROUP BY bucket ORDER BY c DESC')
    .all() as unknown as { bucket: string; c: number }[];

  const labels: Record<string, string> = {
    leads: 'Leads (готові для продажників)',
    pending: 'у черзі на перевірку відгуків',
    manual: 'Manual review',
    no_site: 'NO_SITE (тільки соцмережі)',
    rejected: 'Rejected',
  };

  console.log('');
  console.log(`  Всього місць: ${total}`);
  for (const b of buckets) {
    console.log(`    ${(labels[b.bucket] ?? b.bucket).padEnd(38)} ${String(b.c).padStart(5)}`);
  }

  const scoreDist = db()
    .prepare(
      `SELECT site_score AS s, COUNT(*) AS c FROM site_audits
       WHERE site_score IS NOT NULL GROUP BY site_score ORDER BY site_score`,
    )
    .all() as unknown as { s: number; c: number }[];

  if (scoreDist.length) {
    console.log('\n  Розподіл оцінки сайтів (1 = найгірший = найкращий лід):');
    const max = Math.max(...scoreDist.map((x) => x.c));
    for (const d of scoreDist) {
      const bar = '█'.repeat(Math.max(1, Math.round((d.c / max) * 30)));
      console.log(`    ${String(d.s).padStart(2)}/10  ${bar} ${d.c}`);
    }
  }

  const ownerDist = db()
    .prepare(
      `SELECT CASE
                WHEN score >= 85 THEN '85-100'
                WHEN score >= 70 THEN '70-84'
                WHEN score >= 55 THEN '55-69'
                WHEN score >= 40 THEN '40-54'
                WHEN score >= 20 THEN '20-39'
                ELSE '0-19' END AS band,
              COUNT(*) AS c
       FROM owner_scores GROUP BY band ORDER BY band DESC`,
    )
    .all() as unknown as { band: string; c: number }[];

  if (ownerDist.length) {
    console.log('\n  Розподіл мовного скору власника:');
    const max = Math.max(...ownerDist.map((x) => x.c));
    for (const d of ownerDist) {
      const bar = '█'.repeat(Math.max(1, Math.round((d.c / max) * 30)));
      console.log(`    ${d.band.padStart(6)}  ${bar} ${d.c}`);
    }
    if (preset) {
      console.log(
        `\n    Поточні пороги: Leads ≥${preset.thresholds.ownerScoreLead}, ` +
          `Manual ≥${preset.thresholds.ownerScoreManual}. ` +
          `Дивись розподіл вище і став поріг усвідомлено.`,
      );
    }
  }

  const topEvidence = db()
    .prepare(
      `SELECT json_extract(value, '$.signal') AS signal, COUNT(*) AS c
       FROM owner_scores, json_each(owner_scores.evidence_json)
       WHERE json_extract(value, '$.weight') > 0
       GROUP BY signal ORDER BY c DESC LIMIT 12`,
    )
    .all() as unknown as { signal: string; c: number }[];

  if (topEvidence.length) {
    console.log('\n  Які сигнали спрацьовують найчастіше:');
    for (const e of topEvidence) {
      console.log(`    ${String(e.signal).padEnd(32)} ${e.c}`);
    }
  }

  console.log('\n  Витрати API за місяць:');
  const usage = allUsage();
  if (!usage.length) console.log('    (нічого)');
  const caps: Record<string, number> = {
    text_search: preset?.budget.maxTextSearchRequests ?? 1000,
    place_details: preset?.budget.maxPlaceDetailsRequests ?? 1000,
    psi: 25_000,
  };
  for (const u of usage) {
    const cap = caps[u.api];
    console.log(
      `    ${u.api.padEnd(16)} ${u.month}  ${String(u.count).padStart(6)}` +
        (cap ? ` / ${cap}${u.count >= cap ? '  ← ВИЧЕРПАНО' : ''}` : ''),
    );
  }

  const rejects = db()
    .prepare(
      `SELECT reject_reason AS r, COUNT(*) AS c FROM places
       WHERE bucket = 'rejected' AND reject_reason IS NOT NULL
       GROUP BY reject_reason ORDER BY c DESC LIMIT 10`,
    )
    .all() as unknown as { r: string; c: number }[];

  if (rejects.length) {
    console.log('\n  Топ причин відсіву:');
    for (const r of rejects) console.log(`    ${String(r.c).padStart(5)}  ${r.r}`);
  }

  console.log('');
}
