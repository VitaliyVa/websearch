/**
 * Нагляд за фоновим discover. Друкує рядок ТІЛЬКИ коли є про що сказати:
 * завершення, застій, наближення до ліміту квоти або обвал темпу знахідок.
 *
 * Мовчання = все йде нормально.
 *   node scripts/watch-discover.mjs <очікувана к-сть задач>
 */
import { DatabaseSync } from 'node:sqlite';
import { existsSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TOTAL_TASKS = Number(process.argv[2] ?? 368);
const QUOTA_WARN = 900;
const FREE_TIER = 1000;
const POLL_MS = 60_000;
const STALL_POLLS = 3; // 3 хвилини без прогресу = застій

const month = () => new Date().toISOString().slice(0, 7);

function readQuota() {
  const f = resolve(ROOT, '.quota-ledger.json');
  if (!existsSync(f)) return 0;
  try {
    return JSON.parse(readFileSync(f, 'utf8'))[month()]?.text_search ?? 0;
  } catch {
    return -1; // пошкоджений файл — сигналимо
  }
}

function readDb() {
  const db = new DatabaseSync(resolve(ROOT, 'data', 'leads.db'), { readOnly: true });
  try {
    const runs = db.prepare('SELECT COUNT(*) c FROM search_runs').get();
    const places = db.prepare('SELECT COUNT(*) c FROM places').get();
    return { tasks: runs.c, places: places.c };
  } finally {
    db.close();
  }
}

let prevTasks = -1;
let stalls = 0;

for (;;) {
  let snap;
  try {
    snap = readDb();
  } catch (e) {
    console.log(`DB ERROR: ${e.message}`);
    process.exit(1);
  }

  const quota = readQuota();

  if (quota === -1) {
    console.log('QUOTA LEDGER CORRUPT — зупини прогін і перевір .quota-ledger.json');
    process.exit(1);
  }

  if (quota >= QUOTA_WARN) {
    console.log(
      `QUOTA WARNING: ${quota}/${FREE_TIER} Text Search. Задач ${snap.tasks}/${TOTAL_TASKS}. ` +
        `До платного порогу лишилось ${FREE_TIER - quota}.`,
    );
    process.exit(0);
  }

  if (snap.tasks >= TOTAL_TASKS) {
    console.log(
      `DONE: ${snap.tasks}/${TOTAL_TASKS} задач, ${snap.places} місць, ${quota}/${FREE_TIER} запитів.`,
    );
    process.exit(0);
  }

  if (snap.tasks === prevTasks) {
    stalls++;
    if (stalls >= STALL_POLLS) {
      console.log(
        `STALLED: ${stalls} хв без прогресу на ${snap.tasks}/${TOTAL_TASKS} задач ` +
          `(${quota} запитів). Ймовірно rate limit або мережа.`,
      );
      process.exit(1);
    }
  } else {
    stalls = 0;
    prevTasks = snap.tasks;
  }

  await new Promise((r) => setTimeout(r, POLL_MS));
}
