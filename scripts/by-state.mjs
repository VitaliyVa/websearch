/** Реальна географія бази — за адресою, а не за metro_key пошукового запиту. */
import { DatabaseSync } from 'node:sqlite';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const db = new DatabaseSync(resolve(ROOT, 'data', 'leads.db'), { readOnly: true });

const stateOf = (a) => {
  if (!a) return null;
  const m = /,\s*([A-Z]{2})\s+\d{5}(?:-\d{4})?\b/.exec(a) ?? /,\s*([A-Z]{2})\s*$/.exec(a.trim());
  return m ? m[1] : null;
};

const rows = db
  .prepare("SELECT address, bucket, metro_key FROM places WHERE bucket != 'rejected'")
  .all();

const byState = new Map();
for (const r of rows) {
  const s = stateOf(r.address) ?? '??';
  const e = byState.get(s) ?? { total: 0, leads: 0 };
  e.total++;
  if (r.bucket === 'leads') e.leads++;
  byState.set(s, e);
}

console.log('=== реальні штати (за адресою) ===');
const sorted = [...byState.entries()].sort((a, b) => b[1].total - a[1].total);
for (const [s, e] of sorted) {
  const bar = '█'.repeat(Math.max(1, Math.round((e.total / sorted[0][1].total) * 30)));
  console.log(`  ${s}  ${String(e.total).padStart(5)}  ${bar}${e.leads ? `  (лідів ${e.leads})` : ''}`);
}

const target = new Set(['IL', 'CA', 'NY']);
const inTarget = sorted.filter(([s]) => target.has(s)).reduce((a, [, e]) => a + e.total, 0);
const total = rows.length;
console.log(`\n  У цільових штатах (IL/CA/NY): ${inTarget} з ${total} = ${Math.round((inTarget / total) * 100)}%`);
console.log(`  Витік за межі: ${total - inTarget} (${Math.round(((total - inTarget) / total) * 100)}%)`);
db.close();
