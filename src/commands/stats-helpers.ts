import { loadPreset, type Preset } from '../config.js';

export { allUsage, countPlaces, db } from '../db/index.js';

/** Пресет може бути відсутній — статистика має працювати все одно. */
export function loadPresetSafe(name: string): Preset | null {
  try {
    return loadPreset(name);
  } catch {
    return null;
  }
}
