import { loadPreset, requireEnv } from '../config.js';
import { markSearchRan, searchRan, upsertPlace, countPlaces } from '../db/index.js';
import { FREE_TIER, paidSpendAllowed, remaining, used } from '../quota.js';
import { applyCheapFilter } from '../filters/cheap.js';
import { QuotaExceeded, searchText } from '../sources/places.js';
import { buildTasks, estimateRequests, nicheTier } from '../sources/queries.js';
import { log, progress } from '../util/log.js';

export interface DiscoverOpts {
  preset: string;
  dryRun: boolean;
  allowPaid: boolean;
  limit: number | null;
}

export async function discover(opts: DiscoverOpts) {
  const preset = loadPreset(opts.preset);
  const tasks = buildTasks(preset);
  const est = estimateRequests(tasks, preset.discovery.maxPagesPerQuery);

  const allowPaid = paidSpendAllowed(opts.allowPaid);
  const cap = allowPaid
    ? preset.budget.maxTextSearchRequests
    : Math.min(preset.budget.maxTextSearchRequests, FREE_TIER.text_search);
  const left = remaining('text_search', cap);

  log.step(`L0 Discovery — пресет "${preset.name}"`);
  log.dim(`метро: ${preset.metros.join(', ')}`);
  log.dim(`задач: ${est.tasks}, очікувано запитів до Google: ~${est.estimatedRequests}`);
  log.dim(
    `квота text_search: витрачено ${used('text_search')} / ${cap}, лишилось ${left}` +
      (allowPaid ? '  [ПЛАТНИЙ РЕЖИМ УВІМКНЕНО]' : ''),
  );

  if (opts.allowPaid && !allowPaid) {
    log.warn(
      '--allow-paid проігноровано: потрібне друге підтвердження. Додай ALLOW_PAID_SPEND=yes у .env.\n' +
        '  Це навмисно: один випадковий прапорець не має коштувати грошей.',
    );
  }

  if (opts.dryRun) {
    log.info('--dry-run: показую перші 15 задач і виходжу');
    for (const t of tasks.slice(0, 15)) {
      console.log(`  [${t.mode}] "${t.textQuery}" ${t.includedType ? `type=${t.includedType} ` : ''}r=${t.bias.radiusM}м`);
    }
    return;
  }

  requireEnv(['placesKey'], 'discover');

  const pending = tasks.filter((t) => !searchRan(t.id));
  const todo = opts.limit ? pending.slice(0, opts.limit) : pending;
  log.info(`до виконання: ${todo.length} (вже виконано раніше: ${tasks.length - pending.length})`);

  // ── ПРЕФЛАЙТ: відмовляємось стартувати, якщо прогін не вміщається у квоту.
  // Раніше тут було лише попередження — тобто прогін стартував і зупинявся
  // посеред черги, залишаючи метро обробленими наполовину. Краще не починати.
  const perTask = est.estimatedRequests / Math.max(tasks.length, 1);
  const needed = Math.ceil(todo.length * perTask);
  if (needed > left && !allowPaid) {
    const fits = Math.max(0, Math.floor(left / Math.max(perTask, 0.1)));
    throw new Error(
      `Прогін не вміщається у безкоштовну квоту.\n` +
        `  Потрібно ~${needed} запитів, лишилось ${left}.\n` +
        `  Нічого не запускаю, щоб не витратити реальні гроші.\n\n` +
        `  Варіанти:\n` +
        `    • npm run lead -- discover --limit ${fits}   (вміститься точно)\n` +
        `    • зменшити maxPagesPerQuery у пресеті (зараз ${preset.discovery.maxPagesPerQuery})\n` +
        `    • звузити пресет: менше метро / ethnicMarkersLimit / geoDenseTiers\n` +
        `    • чекати 1 числа — ліміт Google скидається\n` +
        `    • свідомо дозволити оплату: --allow-paid + ALLOW_PAID_SPEND=yes у .env`,
    );
  }

  let newPlaces = 0;
  let seen = 0;
  let done = 0;

  for (const task of todo) {
    try {
      const outcome = await searchText({
        textQuery: task.textQuery,
        includedType: task.includedType,
        lat: task.bias.lat,
        lng: task.bias.lng,
        radiusM: task.bias.radiusM,
        maxPages: preset.discovery.maxPagesPerQuery,
        quotaCap: cap,
        allowPaid,
      });

      for (const place of outcome.places) {
        seen++;
        const isNew = upsertPlace(place, task, nicheTier(task.nicheKey));
        if (isNew) {
          newPlaces++;
          applyCheapFilter(
            {
              placeId: place.placeId,
              address: place.address,
              website: place.website,
              phone: place.phone,
              userRatingCount: place.userRatingCount,
              businessStatus: place.businessStatus,
              types: [place.primaryType, ...place.types].filter((t): t is string => !!t),
            },
            preset,
          );
        }
      }

      markSearchRan(task.id, outcome.pagesFetched, outcome.places.length);
    } catch (e) {
      if (e instanceof QuotaExceeded) {
        console.log('');
        log.warn(e.message);
        break;
      }
      log.err(`задача "${task.textQuery}": ${e instanceof Error ? e.message : e}`);
    }

    progress('discovery', ++done, todo.length);
  }

  console.log('');
  log.ok(`знайдено місць: ${seen} (нових: ${newPlaces})`);
  log.dim(`у базі всього: ${countPlaces()}, з них відсіяно одразу: ${countPlaces("WHERE bucket = 'rejected'")}`);
  log.dim(`запитів Text Search за місяць: ${used('text_search')} / ${cap} (лишилось ${remaining('text_search', cap)})`);
}
