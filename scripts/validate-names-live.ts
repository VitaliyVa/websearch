/**
 * Прогін нового розпізнавання імен по РЕАЛЬНИХ назвах бізнесів із бази.
 * Синтетичні тести перевіряють те, що я передбачив; це — те, чого не передбачив.
 */
import { DatabaseSync } from 'node:sqlite';
import { resolve } from 'node:path';
import { paths } from '../src/config.js';
import { isSlavicName } from '../src/detect/slavic-names.js';

const db = new DatabaseSync(resolve(paths.data, 'leads.db'), { readOnly: true });

const rows = db.prepare('SELECT name, address FROM places').all() as { name: string; address: string }[];

const byVia = new Map<string, { count: number; samples: string[] }>();
let hits = 0;

for (const r of rows) {
  // Перевіряємо кожне слово назви окремо — прізвище зазвичай одне з них
  for (const word of r.name.split(/[\s,.'&\-—|/()]+/)) {
    if (word.length < 4) continue;
    const v = isSlavicName(word, { context: 'business' });
    if (!v.ok) continue;
    hits++;
    const e = byVia.get(v.via) ?? { count: 0, samples: [] };
    e.count++;
    if (e.samples.length < 12) e.samples.push(`${word}  ←  ${r.name.slice(0, 44)}`);
    byVia.set(v.via, e);
    break;
  }
}

console.log(`назв перевірено: ${rows.length}, спрацювань: ${hits} (${((hits / rows.length) * 100).toFixed(1)}%)\n`);

for (const [via, e] of [...byVia.entries()].sort((a, b) => b[1].count - a[1].count)) {
  console.log(`── ${via}  (${e.count})`);
  for (const s of e.samples) console.log(`     ${s}`);
  console.log('');
}

db.close();
