/** Швидкий зріз прогресу аудиту: скільки оновлено за останні N хвилин. */
import { DatabaseSync } from 'node:sqlite';
import { readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const db = new DatabaseSync(resolve(ROOT, 'data', 'leads.db'), { readOnly: true });

const q = (sql, ...a) => db.prepare(sql).get(...a);

const now = new Date();
console.log(`час зараз:  локальний ${now.toLocaleTimeString('uk-UA')} | UTC ${now.toISOString()}`);
console.log(`останній audited_at: ${q('SELECT MAX(audited_at) m FROM site_audits').m}`);

for (const mins of [5, 15, 60]) {
  const cutoff = new Date(Date.now() - mins * 60_000).toISOString();
  const c = q('SELECT COUNT(*) c FROM site_audits WHERE audited_at > ?', cutoff).c;
  console.log(`  оновлено за ${String(mins).padStart(3)} хв: ${c}`);
}

console.log(`\nвсього рядків аудиту: ${q('SELECT COUNT(*) c FROM site_audits').c}`);
try {
  console.log(`файлів у кеші HTML:   ${readdirSync(resolve(ROOT, 'cache')).length}`);
} catch {}

const b = db.prepare('SELECT bucket, COUNT(*) c FROM places GROUP BY bucket ORDER BY c DESC').all();
console.log('\nкошики: ' + b.map((x) => `${x.bucket}=${x.c}`).join('  '));
db.close();
