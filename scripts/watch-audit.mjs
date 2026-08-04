/**
 * Нагляд за фоновим audit. Мовчить, поки все нормально.
 * Сигналить про: завершення, застій, аномально високу частку недоступних сайтів.
 *
 *   node scripts/watch-audit.mjs <очікувана к-сть>
 */
import { DatabaseSync } from 'node:sqlite';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TARGET = Number(process.argv[2] ?? 0);
/** Точка відліку: цікавить робота, зроблена ПІСЛЯ запуску наглядача. */
const STARTED_AT = process.argv[3] ?? new Date(Date.now() - 20 * 60_000).toISOString();
const POLL_MS = 120_000;
const STALL_POLLS = 3;
/** Якщо більше третини сайтів не відкривається — щось не так з мережею, а не з сайтами. */
const DEAD_RATIO_ALARM = 0.35;

function snap() {
  const db = new DatabaseSync(resolve(ROOT, 'data', 'leads.db'), { readOnly: true });
  try {
    /*
     * Рахуємо ОНОВЛЕНІ з моменту старту, а не всі рядки.
     * `audit --force` перезаписує наявні записи через UPSERT, тому COUNT(*)
     * не росте — і наглядач сигналив «застій», поки робота йшла повним ходом.
     */
    const audited = db
      .prepare('SELECT COUNT(*) c FROM site_audits WHERE audited_at > ?')
      .get(STARTED_AT).c;
    const dead = db
      .prepare(
        "SELECT COUNT(*) c FROM site_audits WHERE audited_at > ? AND json_extract(audit_json,'$.fetchError') IS NOT NULL",
      )
      .get(STARTED_AT).c;
    const buckets = db
      .prepare('SELECT bucket, COUNT(*) c FROM places GROUP BY bucket')
      .all()
      .reduce((a, r) => ({ ...a, [r.bucket]: r.c }), {});
    return { audited, dead, buckets };
  } finally {
    db.close();
  }
}

let prev = -1;
let stalls = 0;
let alarmed = false;

for (;;) {
  let s;
  try {
    s = snap();
  } catch (e) {
    console.log(`DB ERROR: ${e.message}`);
    process.exit(1);
  }

  const deadRatio = s.audited ? s.dead / s.audited : 0;

  if (!alarmed && s.audited > 300 && deadRatio > DEAD_RATIO_ALARM) {
    alarmed = true;
    console.log(
      `УВАГА: ${(deadRatio * 100).toFixed(0)}% сайтів не відкривається (${s.dead}/${s.audited}). ` +
        `Схоже на проблему з мережею або блокування, а не на мертві сайти. Перевір.`,
    );
  }

  if (TARGET && s.audited >= TARGET) {
    console.log(
      `DONE: аудитовано ${s.audited}, недоступних ${s.dead} (${(deadRatio * 100).toFixed(0)}%). ` +
        `leads=${s.buckets.leads ?? 0} pending=${s.buckets.pending ?? 0} rejected=${s.buckets.rejected ?? 0}`,
    );
    process.exit(0);
  }

  if (s.audited === prev) {
    if (++stalls >= STALL_POLLS) {
      console.log(`STALLED: ${stalls * 2} хв без прогресу на ${s.audited} аудитах.`);
      process.exit(1);
    }
  } else {
    stalls = 0;
    prev = s.audited;
  }

  await new Promise((r) => setTimeout(r, POLL_MS));
}
