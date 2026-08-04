/**
 * Перетворює заміряні ознаки на оцінку сучасності дизайну 0-100
 * і звіряє її з візуальними вердиктами, які я поставив очима.
 *
 * Звірка тут не формальність: якщо шкала не збігається з очима на відомих
 * прикладах, їй не можна довіряти на решті — і краще це виявити зараз, ніж
 * після того, як ліди роз'їдуться по вкладках.
 */
import { readFileSync } from 'node:fs';

interface Probe {
  n: number; placeId: string; name: string; url: string;
  error?: string; title?: string;
  cssVars?: boolean; cssClamp?: boolean; gridUsed?: number; flexUsed?: number;
  floatLayout?: number; jquery?: string | null; bootstrap3?: boolean;
  fontAwesome4?: boolean; tables?: number; webp?: number; totalImgs?: number;
  lazyImgs?: number; copyrightYear?: number | null; fixedWidth?: boolean;
  cyrillic?: boolean; langLinks?: number; textLen?: number; isSocialOnly?: boolean;
}

const probes: Probe[] = JSON.parse(readFileSync(process.argv[2]!, 'utf8'));

/** Мої візуальні вердикти: сучасний / застарілий. Основа для звірки. */
const SEEN: Record<number, 'modern' | 'dated'> = {
  1: 'modern', 2: 'dated', 4: 'modern', 5: 'modern', 6: 'modern',
  8: 'modern', 14: 'dated', 18: 'modern', 19: 'modern', 23: 'modern', 36: 'modern',
};

export function modernityScore(p: Probe): { score: number; why: string[] } {
  const why: string[] = [];
  let s = 50;
  const add = (n: number, label: string) => { s += n; why.push(`${n > 0 ? '+' : ''}${n} ${label}`); };

  if (p.cssVars) add(12, 'CSS-змінні');
  if (p.cssClamp) add(10, 'clamp/min/max');
  if ((p.gridUsed ?? 0) >= 3) add(12, `grid ×${p.gridUsed}`);
  else if ((p.gridUsed ?? 0) >= 1) add(5, 'grid місцями');
  if ((p.flexUsed ?? 0) >= 20) add(8, 'flex скрізь');
  else if ((p.flexUsed ?? 0) >= 5) add(4, 'flex місцями');

  if ((p.webp ?? 0) > 0) add(8, `webp/avif ×${p.webp}`);
  if ((p.lazyImgs ?? 0) > 0) add(5, 'lazy-loading');

  if (p.jquery?.startsWith('1.')) add(-18, `jQuery ${p.jquery}`);
  else if (p.jquery?.startsWith('2.')) add(-12, `jQuery ${p.jquery}`);
  else if (p.jquery?.startsWith('3.')) add(-4, `jQuery ${p.jquery}`);

  if (p.bootstrap3) add(-12, 'сітка Bootstrap 3');
  if (p.fontAwesome4) add(-8, 'FontAwesome 4');
  if (p.fixedWidth) add(-8, 'фікс. ширина 960-1170px');
  if ((p.floatLayout ?? 0) > 25) add(-10, `float-верстка ×${p.floatLayout}`);
  if ((p.tables ?? 0) > 3) add(-6, `таблиць ${p.tables}`);

  const y = p.copyrightYear;
  if (y != null) {
    if (y >= 2025) add(6, `копірайт ${y}`);
    else if (y <= 2021) add(-10, `копірайт ${y}`);
    else if (y <= 2023) add(-5, `копірайт ${y}`);
  }

  return { score: Math.max(0, Math.min(100, s)), why };
}

// Звіт друкуємо ЛИШЕ при прямому запуску: інакше він засмічує вивід усім,
// хто імпортує modernityScore
const directRun = (process.argv[1] ?? '').replace(/\\/g, '/').endsWith('score-modernity.ts');
if (!directRun) {
  // нічого не друкуємо — модуль підключили лише заради modernityScore
} else {

const rows = probes.map((p) => ({ p, ...modernityScore(p) }));

console.log('── звірка з візуальним оглядом ──');
let agree = 0;
let checked = 0;
for (const r of rows) {
  const seen = SEEN[r.p.n];
  if (!seen) continue;
  checked++;
  const verdict = r.score >= 60 ? 'modern' : 'dated';
  const ok = verdict === seen;
  if (ok) agree++;
  console.log(
    `  ${ok ? '✓' : '✗'} ${String(r.p.n).padStart(2)} ${r.p.name.slice(0, 34).padEnd(36)} замір ${String(r.score).padStart(3)} → ${verdict.padEnd(6)} · очима ${seen}`,
  );
}
console.log(`\n  збіг: ${agree}/${checked}`);

console.log('\n── усі, за зростанням сучасності ──');
for (const r of rows.sort((a, b) => a.score - b.score)) {
  const flag = r.p.error ? 'ПОМИЛКА' : r.p.isSocialOnly ? 'СОЦМЕРЕЖА' : /Challenge|Checking your browser|403/i.test(r.p.title ?? '') ? 'ЗАБЛОКОВАНО' : '';
  console.log(
    `  ${String(r.p.n).padStart(2)} ${String(r.score).padStart(3)} ${r.p.name.slice(0, 36).padEnd(38)} ${flag.padEnd(11)} ${r.why.slice(0, 4).join(', ')}`,
  );
}

}
