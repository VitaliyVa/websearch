import { createHash } from 'node:crypto';
import { loadMetros, loadNiches, type Preset } from '../config.js';
import type { Metro, Niche, SearchTask, Tier } from '../types.js';

const id = (parts: string[]) =>
  createHash('sha1').update(parts.join('|')).digest('hex').slice(0, 16);

/**
 * Два режими, бо вони ловлять різні бізнеси:
 *
 *  ethnic     — «ukrainian dental office» по всьому метро. Висока точність,
 *               але бачить лише тих, хто сам себе позиціонує етнічно.
 *  geo-dense  — «dental office» жорстко в межах діаспорного району. Низька
 *               точність на вході, зате ловить асимільований бізнес з
 *               англомовною назвою — саме той, у кого є гроші. Мовний фільтр
 *               нижче по воронці відсіює зайве безкоштовно.
 */
export function buildTasks(preset: Preset): SearchTask[] {
  const metros = loadMetros();
  const { niches, ethnicMarkers, ethnicStandaloneQueries } = loadNiches();

  const tasks: SearchTask[] = [];
  const tierSet = new Set<Tier>(preset.tiers);
  const ethnicTiers = new Set<Tier>(preset.discovery.ethnicNicheTiers);
  const geoTiers = new Set<Tier>(preset.discovery.geoDenseTiers);
  const markers = ethnicMarkers.slice(0, preset.discovery.ethnicMarkersLimit);
  const activeNiches = niches.filter((n) => tierSet.has(n.tier));

  for (const metroKey of preset.metros) {
    const metro = metros[metroKey] as Metro | undefined;
    if (!metro) throw new Error(`Метро "${metroKey}" нема в config/metros.json`);

    if (preset.discovery.ethnicMode) {
      // 1. Самостійні етнічні запити — без прив'язки до ніші
      for (const q of ethnicStandaloneQueries) {
        const textQuery = `${q} in ${metro.label}`;
        tasks.push({
          id: id(['standalone', metroKey, textQuery]),
          metroKey,
          mode: 'ethnic-standalone',
          textQuery,
          includedType: null,
          nicheKey: null,
          hoodName: null,
          bias: { lat: metro.center.lat, lng: metro.center.lng, radiusM: metro.ethnicRadiusM },
        });
      }

      // 2. Маркер × ніша
      for (const niche of activeNiches) {
        if (!ethnicTiers.has(niche.tier)) continue;
        for (const marker of markers) {
          const textQuery = `${marker} ${niche.textQuery} in ${metro.label}`;
          tasks.push({
            id: id(['ethnic', metroKey, marker, niche.key]),
            metroKey,
            mode: 'ethnic',
            textQuery,
            // includedType навмисно не ставимо: він звужує семантичний матч
            // і Google починає ігнорувати етнічний маркер.
            includedType: null,
            nicheKey: niche.key,
            hoodName: null,
            bias: { lat: metro.center.lat, lng: metro.center.lng, radiusM: metro.ethnicRadiusM },
          });
        }
      }
    }

    // 3. Щільна нішева зачистка діаспорних районів
    if (preset.discovery.geoDenseMode) {
      for (const hood of metro.hoods) {
        for (const niche of activeNiches) {
          if (!geoTiers.has(niche.tier)) continue;
          tasks.push({
            id: id(['geo', metroKey, hood.name, niche.key]),
            metroKey,
            mode: 'geo-dense',
            textQuery: `${niche.textQuery} near ${hood.name}`,
            includedType: niche.includedType,
            nicheKey: niche.key,
            hoodName: hood.name,
            bias: { lat: hood.lat, lng: hood.lng, radiusM: hood.radiusM },
          });
        }
      }
    }
  }

  return tasks;
}

export function nicheTier(nicheKey: string | null): Tier | null {
  if (!nicheKey) return null;
  const { niches } = loadNiches();
  return (niches.find((n: Niche) => n.key === nicheKey)?.tier as Tier) ?? null;
}

/** Оцінка кількості запитів до Google без реального прогону. */
export function estimateRequests(tasks: SearchTask[], maxPages: number) {
  // Емпірика: етнічні запити майже завжди дають <20 результатів (1 сторінка),
  // geo-dense по щільних районах часто впирається у стелю.
  const avgPages = (t: SearchTask) =>
    t.mode === 'geo-dense' ? Math.min(maxPages, 2.2) : 1.3;
  const total = tasks.reduce((s, t) => s + avgPages(t), 0);
  return { tasks: tasks.length, estimatedRequests: Math.round(total) };
}
