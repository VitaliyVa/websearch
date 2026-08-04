import type { HoursEstimate } from '../types.js';

/**
 * Складність розробки в зірках 1-5.
 *
 * Годинний діапазон лишається всередині — на ньому будується оцінка і він
 * потрібен для внутрішнього планування. Але продажнику він шкодив: «22-33 год»
 * у розмові з клієнтом миттєво перетворюється на ціну, яку ще ніхто не рахував,
 * і прив'язує розмову до трудовитрат замість цінності. Зірки говорять те саме
 * («це маленький проєкт» / «це велика робота»), не даючи приводу торгуватись
 * за години.
 *
 * Пороги відкалібровані на фактичному розподілі 64 лідів (медіана ~62 год,
 * p20 ≈ 30, p80 ≈ 72), а не взяті з голови: інакше майже всі впали б в одну
 * зірку і колонка не несла б інформації.
 */
export interface Difficulty {
  stars: 1 | 2 | 3 | 4 | 5;
  label: string;
}

const LADDER: { upTo: number; stars: 1 | 2 | 3 | 4 | 5; label: string }[] = [
  { upTo: 28, stars: 1, label: 'односторінковий лендінг' },
  { upTo: 45, stars: 2, label: 'простий сайт-візитівка' },
  { upTo: 62, stars: 3, label: 'кілька типів сторінок' },
  { upTo: 75, stars: 4, label: 'великий сайт з каталогом' },
  { upTo: Infinity, stars: 5, label: 'складний проєкт' },
];

export function difficultyOf(e: HoursEstimate | null): Difficulty | null {
  if (!e) return null;
  const mid = (e.min + e.max) / 2;
  const step = LADDER.find((l) => mid <= l.upTo)!;
  return { stars: step.stars, label: step.label };
}

/** Те саме, але з уже збережених у БД hours_min / hours_max. */
export function difficultyFromHours(min: number | null, max: number | null): Difficulty | null {
  if (min == null || max == null) return null;
  return difficultyOf({ min, max, breakdown: [] });
}

/** Текстове представлення для Google Sheets, де немає компонентів. */
export const formatStars = (d: Difficulty) => '★'.repeat(d.stars) + '☆'.repeat(5 - d.stars);
