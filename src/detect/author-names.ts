import { isSlavicName } from './slavic-names.js';
import { countMatches, CYRILLIC_RE, RU_GLYPHS_RE, SR_GLYPHS_RE, UK_GLYPHS_RE } from '../util/text.js';

/**
 * Аналіз ІМЕН рецензентів у Google-відгуках.
 *
 * Ловить те, чого не бачить жоден інший сигнал: діаспорний бізнес із повністю
 * англомовним сайтом, нейтральною назвою і відгуками англійською — але від
 * людей на імена Oksana Kovalenko і Dmytro Shevchenko. Клієнтура видає власника
 * навіть тоді, коли він сам нічого слов'янського про себе не публікує.
 *
 * Дістається безкоштовно: authorAttribution.displayName входить у той самий
 * запит Place Details, який ми й так робимо заради мови відгуків.
 */

export interface AuthorNameStats {
  total: number;
  slavic: number;
  cyrillic: number;
  ratio: number;
  /** Переважна мова за гліфами в іменах, якщо визначилась */
  lang: 'uk' | 'ru' | null;
}

export function analyzeAuthorNames(names: (string | null)[]): AuthorNameStats {
  const clean = names.filter((n): n is string => !!n && n.trim().length > 1);
  if (!clean.length) return { total: 0, slavic: 0, cyrillic: 0, ratio: 0, lang: null };

  let slavic = 0;
  let cyrillic = 0;
  let ukGlyphs = 0;
  let ruGlyphs = 0;

  for (const name of clean) {
    // Кирилиця в імені — найсильніший варіант, але треба відсіяти сербів
    if (countMatches(name, CYRILLIC_RE) > 0) {
      if (SR_GLYPHS_RE.test(name)) continue;
      cyrillic++;
      slavic++;
      ukGlyphs += countMatches(name, UK_GLYPHS_RE);
      ruGlyphs += countMatches(name, RU_GLYPHS_RE);
      continue;
    }

    // Одного збігу достатньо: ім'я АБО прізвище
    if (isSlavicName(name).ok) slavic++;
  }

  return {
    total: clean.length,
    slavic,
    cyrillic,
    ratio: slavic / clean.length,
    lang: ukGlyphs > ruGlyphs ? 'uk' : ruGlyphs > 0 ? 'ru' : null,
  };
}

/** Бали за іменами рецензентів. Кирилиця в імені важить більше за транслітерацію. */
export function scoreAuthorNames(s: AuthorNameStats): number {
  if (s.total === 0) return 0;

  /*
   * Ваги підняті після живого прогону: цей сигнал спрацював у 25 випадках
   * із 44, тоді як мова відгуків — у нуль. Він несе всю цінність стадії,
   * тому має бути здатен самотужки довести лід до порогу.
   */
  let score = 0;
  if (s.ratio >= 0.6) score = 45;
  else if (s.ratio >= 0.4) score = 35;
  else if (s.ratio >= 0.2) score = 18;

  // Кирилиця в самому імені рецензента — він не просто слов'янського
  // походження, а активно користується кирилицею в повсякденні
  if (s.cyrillic >= 2) score += 15;
  else if (s.cyrillic === 1) score += 8;

  return Math.min(score, 60);
}
