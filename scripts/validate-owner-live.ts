/**
 * Прогін детектора прізвища власника по РЕАЛЬНИХ сторінках із кешу.
 * Синтетичні тести перевіряють передбачене; це — непередбачене.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { paths } from '../src/config.js';
import { detectOwnerName } from '../src/detect/owner-name.js';
import { extractEmails } from '../src/detect/contacts.js';

const db = new DatabaseSync(resolve(paths.data, 'leads.db'), { readOnly: true });
const nameOf = new Map<string, string>();
for (const r of db.prepare('SELECT place_id, name FROM places').all() as { place_id: string; name: string }[]) {
  nameOf.set(r.place_id, r.name);
}
db.close();

const files = readdirSync(paths.cache).filter((f) => f.endsWith('.json'));
const bySource = new Map<string, { count: number; samples: string[] }>();
let scanned = 0;
let withHit = 0;

for (const f of files) {
  let cached: { html: string };
  try {
    cached = JSON.parse(readFileSync(resolve(paths.cache, f), 'utf8'));
  } catch {
    continue;
  }
  if (!cached?.html) continue;
  scanned++;

  const placeId = f.replace(/\.json$/, '');
  const r = detectOwnerName(cached.html, extractEmails(cached.html));
  if (r.score === 0) continue;
  withHit++;

  for (const hit of r.hits.slice(0, 1)) {
    const e = bySource.get(hit.source) ?? { count: 0, samples: [] };
    e.count++;
    if (e.samples.length < 14) {
      e.samples.push(`${hit.name.padEnd(24)} ← ${(nameOf.get(placeId) ?? placeId).slice(0, 42)}`);
    }
    bySource.set(hit.source, e);
  }
}

console.log(`сторінок у кеші: ${scanned}, з прізвищем власника: ${withHit} (${((withHit / Math.max(scanned, 1)) * 100).toFixed(1)}%)\n`);

for (const [src, e] of [...bySource.entries()].sort((a, b) => b[1].count - a[1].count)) {
  console.log(`── ${src}  (${e.count})`);
  for (const s of e.samples) console.log(`     ${s}`);
  console.log('');
}
