/**
 * Те саме, що probe-unreadable, але СПРАВЖНІМ Chrome із постійним профілем.
 *
 * Вбудований у Playwright Chromium видно за десятком ознак (navigator.webdriver,
 * відсутність плагінів, свіжий профіль без історії), і Cloudflare його ріже.
 * Реальний Chrome з профілем на диску виглядає як звичайний користувач, тому
 * частину челенджів проходить сам, без жодної ручної дії.
 *
 * headed=1 у змінних середовища відкриває вікно — тоді челендж можна пройти
 * руками, і cookie осяде в профілі для наступних прогонів.
 */
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import { getPlaces, getAudit } from '../src/db/index.js';

const LIMIT = Number(process.argv[2] ?? 15);
const HEADED = process.env.HEADED === '1';
const PROFILE = resolve(process.cwd(), '.chrome-profile');
mkdirSync(PROFILE, { recursive: true });

const CHALLENGE = /just a moment|checking your browser|human verification|attention required|verifying you are human|robot challenge/i;

const seen = new Set<string>();
const candidates = getPlaces("WHERE bucket IN ('manual','pending') AND website IS NOT NULL")
  .filter((p) => {
    const ar = getAudit(p.place_id);
    if (!ar) return false;
    const a = JSON.parse(ar.audit_json);
    if (!a.fetchError || /http-40[04]/.test(String(a.fetchError))) return false;
    // Один домен — одна спроба: у мережевих точок сайт спільний
    try {
      const h = new URL(p.website!).hostname;
      if (seen.has(h)) return false;
      seen.add(h);
      return true;
    } catch {
      return false;
    }
  })
  .sort((a, b) => (b.user_rating_count ?? 0) - (a.user_rating_count ?? 0))
  .slice(0, LIMIT);

console.log(`${candidates.length} доменів, справжній Chrome, профіль: ${PROFILE}\n`);

const ctx = await chromium.launchPersistentContext(PROFILE, {
  channel: 'chrome',
  headless: !HEADED,
  viewport: { width: 1366, height: 900 },
  locale: 'en-US',
  args: ['--disable-blink-features=AutomationControlled'],
});

let passed = 0;
let blocked = 0;
let failed = 0;

for (const p of candidates) {
  const page = await ctx.newPage();
  try {
    await page.goto(p.website!, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    for (let i = 0; i < 6 && CHALLENGE.test(await page.title()); i++) {
      await page.waitForTimeout(2500);
    }
    const title = await page.title();
    const len = await page.evaluate('document.body ? document.body.innerText.length : 0') as number;

    if (CHALLENGE.test(title)) {
      blocked++;
      console.log(`  ✗ ${String(p.user_rating_count ?? 0).padStart(4)} ${p.name.slice(0, 34).padEnd(36)} челендж`);
    } else {
      passed++;
      console.log(`  ✓ ${String(p.user_rating_count ?? 0).padStart(4)} ${p.name.slice(0, 34).padEnd(36)} ${String(len).padStart(6)} симв · ${title.slice(0, 34)}`);
    }
  } catch (e) {
    failed++;
    console.log(`  ! ${String(p.user_rating_count ?? 0).padStart(4)} ${p.name.slice(0, 34).padEnd(36)} ${(e as Error).message.split('\n')[0]!.slice(0, 34)}`);
  } finally {
    await page.close();
  }
}

if (!HEADED) await ctx.close();
else console.log('\nВікно лишається відкритим — пройди челендж вручну, потім Ctrl+C.');

console.log(`\nпройдено: ${passed} · челендж: ${blocked} · помилка: ${failed}`);
