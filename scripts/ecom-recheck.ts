/**
 * Перевіряє, скільки міток «інтернет-магазин» відпаде після звуження правила.
 * Працює на кеші — жодного мережевого запиту, жодної витрати квоти.
 */
import { readFileSync, existsSync } from 'node:fs';
import { getPlaces, getAudit } from '../src/db/index.js';

const ECOM_PATH_RE = /\/(cart|checkout|basket)\b/i;
const ECOM_HTML_RE =
  /(add[- _]?to[- _]?cart|woocommerce-cart|wc-block-cart|data-product-id|snipcart|shopping[- _]?cart|plugins\/woocommerce)/i;

let was = 0;
let stays = 0;
const dropped: string[] = [];

for (const p of getPlaces("WHERE bucket='leads'")) {
  const ar = getAudit(p.place_id);
  if (!ar) continue;
  const a = JSON.parse(ar.audit_json);
  if (!a.hasEcommerce) continue;
  was++;

  const file = `cache/${p.place_id}.json`;
  if (!existsSync(file)) continue;
  const cached = JSON.parse(readFileSync(file, 'utf8'));
  const html: string = cached.html ?? cached.body ?? '';

  const hit = ECOM_HTML_RE.test(html);
  if (hit) stays++;
  else dropped.push(`${(p.primary_type_label ?? '?').padEnd(26)} ${p.name.slice(0, 40)}`);
}

console.log(`було позначено магазинами: ${was}`);
console.log(`лишається за сильними маркерами в HTML: ${stays}`);
console.log(`відпадає (перевір очима): ${dropped.length}\n`);
for (const d of dropped) console.log('  ' + d);
