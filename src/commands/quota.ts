import { loadPreset } from '../config.js';
import { buildTasks, estimateRequests } from '../sources/queries.js';
import { searchRan } from '../db/index.js';
import { FREE_TIER, remaining, snapshot, used } from '../quota.js';
import { log } from '../util/log.js';

/**
 * Стан витрат і чи вміститься наступний повний прогін.
 * Головне питання, на яке має відповідати: «якщо я зараз запущу discover,
 * це буде безкоштовно?»
 */
export function quota(presetName: string) {
  log.step('Квота Google');

  console.log('');
  for (const s of snapshot()) {
    const pct = Math.round((s.used / s.free) * 100);
    const bar = '█'.repeat(Math.min(20, Math.round(pct / 5))).padEnd(20, '░');
    const period = s.api === 'psi' ? 'на добу' : 'на місяць';
    console.log(
      `  ${s.api.padEnd(14)} ${bar} ${String(s.used).padStart(5)} / ${String(s.free).padEnd(6)} ` +
        `(${period}, лишилось ${s.left})`,
    );
  }

  let preset: ReturnType<typeof loadPreset>;
  try {
    preset = loadPreset(presetName);
  } catch {
    console.log('');
    return;
  }

  const tasks = buildTasks(preset);
  const pending = tasks.filter((t) => !searchRan(t.id));
  const est = estimateRequests(tasks, preset.discovery.maxPagesPerQuery);
  const perTask = est.estimatedRequests / Math.max(tasks.length, 1);
  const needed = Math.ceil(pending.length * perTask);
  const left = remaining('text_search', Math.min(preset.budget.maxTextSearchRequests, FREE_TIER.text_search));

  console.log(`\n  Наступний повний discover ("${preset.name}")`);
  console.log(`    невиконаних задач:     ${pending.length} з ${tasks.length}`);
  console.log(`    оцінка запитів:        ~${needed}`);
  console.log(`    доступно безкоштовно:  ${left}`);

  if (needed === 0) {
    console.log(`    → усі задачі пресета вже виконані`);
  } else if (needed <= left) {
    console.log(`    → \x1b[32mвміщається\x1b[0m, витрат не буде`);
  } else {
    const fits = Math.max(0, Math.floor(left / Math.max(perTask, 0.1)));
    console.log(`    → \x1b[31mНЕ вміщається\x1b[0m. discover відмовиться стартувати.`);
    console.log(`      безпечний обсяг зараз: --limit ${fits}`);
    console.log(`      або зменш maxPagesPerQuery (зараз ${preset.discovery.maxPagesPerQuery})`);
  }

  const paid = (process.env.ALLOW_PAID_SPEND ?? '').toLowerCase() === 'yes';
  console.log(
    `\n  Платний режим: ${paid ? '\x1b[31mДОЗВОЛЕНО (ALLOW_PAID_SPEND=yes)\x1b[0m' : 'заблоковано'}` +
      `${paid ? '\n    ⚠ прибери ALLOW_PAID_SPEND з .env, щоб виключити витрати' : ''}`,
  );
  console.log(
    `\n  Ціна за вихід за ліміт: Text Search ~$35/1000, Place Details ~$40/1000.` +
      `\n  Ліміти Google скидаються 1 числа.\n`,
  );
}
