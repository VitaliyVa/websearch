/**
 * Кому з черги відгуки реально можуть допомогти.
 *
 * Максимум від відгуків — 70 балів. Місце зі скором 0 дійде рівно до порогу
 * лише за ідеального набору рецензентів, тому витрачати на нижню смугу майже
 * марно. Цей зріз показує, де проходить межа доцільності.
 */
import { loadPreset } from '../src/config.js';
import { db } from '../src/db/index.js';

const preset = loadPreset('us-diaspora-pilot');
const LEAD = preset.thresholds.ownerScoreLead;
const MAX_BOOST = 70;

const rows = db()
  .prepare(
    `SELECT COALESCE(o.score, 0) AS score, COUNT(*) AS c
     FROM places p
     LEFT JOIN owner_scores o ON o.place_id = p.place_id
     WHERE p.bucket = 'pending'
     GROUP BY CASE
       WHEN COALESCE(o.score,0) >= 55 THEN 5
       WHEN COALESCE(o.score,0) >= 40 THEN 4
       WHEN COALESCE(o.score,0) >= 25 THEN 3
       WHEN COALESCE(o.score,0) >= 10 THEN 2
       ELSE 1 END
     ORDER BY score DESC`,
  )
  .all() as { score: number; c: number }[];

// Скільки саме потрібно добрати кожній смузі
const bands: [string, number, number][] = [
  ['55-69', 55, 69],
  ['40-54', 40, 54],
  ['25-39', 25, 39],
  ['10-24', 10, 24],
  ['0-9', 0, 9],
];

const counts = db()
  .prepare(
    `SELECT COALESCE(o.score,0) AS s, COUNT(*) AS c
     FROM places p LEFT JOIN owner_scores o ON o.place_id = p.place_id
     WHERE p.bucket = 'pending' GROUP BY s`,
  )
  .all() as { s: number; c: number }[];

const inBand = (lo: number, hi: number) =>
  counts.filter((x) => x.s >= lo && x.s <= hi).reduce((a, x) => a + x.c, 0);

console.log(`поріг ліда: ${LEAD}, максимум від відгуків: +${MAX_BOOST}\n`);
console.log('смуга    к-сть   треба добрати   реалістичність');
console.log('─'.repeat(58));

let worthIt = 0;
for (const [label, lo, hi] of bands) {
  const n = inBand(lo, hi);
  const need = LEAD - hi; // найлегший випадок у смузі
  const needHard = LEAD - lo; // найважчий
  let verdict: string;
  if (needHard <= 25) verdict = 'дуже висока';
  else if (needHard <= 45) verdict = 'висока';
  else if (needHard <= 60) verdict = 'середня';
  else verdict = 'низька — лише ідеальні відгуки';
  if (needHard <= 60) worthIt += n;
  console.log(`${label.padEnd(8)} ${String(n).padStart(5)}   +${String(need).padStart(2)}…+${String(needHard).padEnd(3)}      ${verdict}`);
}

console.log('─'.repeat(58));
console.log(`варті виклику (потрібно ≤60): ${worthIt}`);
console.log(`решта: ${counts.reduce((a, x) => a + x.c, 0) - worthIt} — майже безнадійні\n`);

// Скільки з них ще НЕ перевірялись
const unchecked = db()
  .prepare(
    `SELECT COUNT(*) c FROM places p
     LEFT JOIN owner_scores o ON o.place_id = p.place_id
     LEFT JOIN review_signals r ON r.place_id = p.place_id
     WHERE p.bucket = 'pending' AND r.place_id IS NULL AND COALESCE(o.score,0) >= 10`,
  )
  .get() as { c: number };

console.log(`зі скором ≥10 і ЩЕ НЕ перевірених відгуками: ${unchecked.c}`);
