/**
 * Кладе скріншоти в `web/public/shots/`, щоб вони поїхали у збірку GitHub Pages.
 *
 * Чому копіюємо, а не посилаємось: панель — статика на чужому домені, до
 * `D:\other\websearch\screenshots\` вона не дістанеться ніколи. Google Drive
 * теж відпадає — service account на споживчому акаунті не може створювати
 * файли (перевірено раніше, помилка storageQuotaExceeded).
 *
 * Обсяг стримуємо навмисно: лідам — обидва скріни (по них іде розмова),
 * решті — тільки мобільний. Мобільний і є головним доказом: саме на телефоні
 * старий сайт розсипається, і саме його показують клієнту.
 */
import { copyFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { getPlaces, getScreenshots } from '../src/db/index.js';
import { log } from '../src/util/log.js';

const OUT = resolve(process.cwd(), 'web/public/shots');

// Архівні картки також використовують ці URL: зберігаємо наявні файли.
mkdirSync(OUT, { recursive: true });

const leadIds = new Set(getPlaces("WHERE bucket='leads'").map((p) => p.place_id));
const all = getPlaces("WHERE archived_at IS NULL AND bucket IN ('leads','upsell','manual','pending','no_site','no_site_lead')");

let copied = 0;
let bytes = 0;

for (const p of all) {
  const shots = getScreenshots(p.place_id);
  if (!shots) continue;

  const isLead = leadIds.has(p.place_id);
  const wanted: [string | null, string][] = isLead
    ? [[shots.mobile_path, 'mobile'], [shots.desktop_path, 'desktop']]
    : [[shots.mobile_path, 'mobile']];

  for (const [src, kind] of wanted) {
    if (!src || !existsSync(src)) continue;
    const dest = resolve(OUT, `${p.place_id}-${kind}.jpg`);
    copyFileSync(src, dest);
    bytes += statSync(dest).size;
    copied++;
  }
}

log.ok(`скопійовано ${copied} скріншотів, ${(bytes / 1024 / 1024).toFixed(1)} МБ → web/public/shots/`);
