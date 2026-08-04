import { loadPreset } from '../config.js';
import { getPlaces } from '../db/index.js';
import { applyCheapFilter, cheapFilter } from '../filters/cheap.js';
import { log } from '../util/log.js';

const safeTypes = (json: string | null | undefined): string[] => {
  if (!json) return [];
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
};

/**
 * Перепрогін дешевих фільтрів по вже зібраній базі. 0 викликів Google.
 * Потрібен, коли змінюються пороги в пресеті або виправляється логіка фільтра —
 * інакше довелось би заново платити за discover.
 *
 * Уже проаудитовані місця (leads/manual) не чіпаємо: у них вердикт спирався
 * ще й на мовні сигнали, які цей фільтр не бачить.
 */
export function refilter(presetName: string, includeAudited = false) {
  const preset = loadPreset(presetName);

  // Проходимо ВСЮ базу, але застосовуємо вибірково — див. нижче.
  const places = getPlaces('');
  log.step(`Перефільтрація — ${places.length} місць (0 викликів Google)`);

  const counts = new Map<string, number>();
  let skipped = 0;

  for (const p of places) {
    const input = {
      placeId: p.place_id,
      address: p.address,
      website: p.website,
      phone: p.phone,
      userRatingCount: p.user_rating_count,
      businessStatus: p.business_status,
      types: safeTypes(p.types_json),
    };

    const verdict = cheapFilter(input, preset);

    /*
     * Refilter може ПОНИЖУВАТИ, але не підвищувати.
     *
     * Дешеві фільтри не бачать мовних сигналів, тому для вже проаудитованого
     * місця вердикт 'pending' означав би «я не знаю», а не «поверни в чергу».
     * Застосувати його — значить стерти результат аудиту. Тому:
     *   • 'rejected' застосовуємо завжди (нове правило відсіву має спрацювати
     *     і на тих, кого стара логіка вже пропустила далі);
     *   • 'pending'/'no_site' — лише для ще не проаудитованих.
     */
    const isDemotion = verdict.bucket === 'rejected';
    const notAuditedYet = p.stage === 'discovered';

    if (!isDemotion && !notAuditedYet && !includeAudited) {
      skipped++;
      continue;
    }

    applyCheapFilter(input, preset);
    const key = verdict.reason ?? verdict.bucket;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  console.log('');
  for (const [k, c] of [...counts.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(c).padStart(5)}  ${k}`);
  }
  console.log('');
  if (skipped) log.dim(`пропущено вже проаудитованих (вердикт аудиту збережено): ${skipped}`);
  log.ok('перефільтровано');
}
