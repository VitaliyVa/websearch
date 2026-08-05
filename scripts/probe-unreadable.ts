/**
 * Пробує відкрити справжнім браузером ті сайти, які звичайний fetch не осилив.
 *
 * 701 запис у черзі має `fetchError` — про них ми не знаємо НІЧОГО, хоча за
 * 403-ю сторінкою може стояти сайт, повний кирилиці. Playwright ходить як
 * реальний Chrome, тож частину bot-protection проходить.
 *
 * Жодного запиту до Google — сайти тягнемо напряму, це безкоштовно.
 * Спершу на вибірці: рахуємо, скільки відкрилось і скільки дало мовний сигнал,
 * щоб вирішити, чи варто ганяти всі 701.
 */
import { writeFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { getPlaces, getAudit } from '../src/db/index.js';

const LIMIT = Number(process.argv[2] ?? 30);
const OUT = process.argv[3] ?? '';

/*
 * Сигнали шукаємо в РЕНДЕРЕНОМУ тексті. Саме тут перевага браузера: сайти на
 * React/Vue віддають порожній HTML, і кирилиця з'являється лише після JS.
 */
const PROBE = `(() => {
  const text = document.body ? document.body.innerText : '';
  const html = document.documentElement.outerHTML;
  const cyr = (text.match(/[\\u0400-\\u04FF]/g) || []).length;
  return {
    title: document.title.slice(0, 80),
    cyrillicChars: cyr,
    cyrillicRatio: text.length ? +(cyr / text.length).toFixed(3) : 0,
    ukrGlyphs: (text.match(/[іїєґІЇЄҐ]/g) || []).length,
    rusGlyphs: (text.match(/[ыэъёЫЭЪЁ]/g) || []).length,
    langAttr: document.documentElement.lang || '',
    hreflang: Array.from(document.querySelectorAll('link[rel=alternate][hreflang]'))
      .map(l => l.getAttribute('hreflang')).filter(h => /^(ru|uk)/i.test(h || '')).join(','),
    viber: /viber:\\/\\/|viber\\.me/i.test(html),
    telegram: /t\\.me\\/|tg:\\/\\//i.test(html),
    textLen: text.length,
  };
})()`;

const candidates = getPlaces("WHERE bucket IN ('manual','pending') AND website IS NOT NULL")
  .filter((p) => {
    const ar = getAudit(p.place_id);
    if (!ar) return false;
    const a = JSON.parse(ar.audit_json);
    // 404/400 — адреса просто мертва, браузер тут не допоможе
    return !!a.fetchError && !/http-40[04]/.test(String(a.fetchError));
  })
  .sort((a, b) => (b.user_rating_count ?? 0) - (a.user_rating_count ?? 0))
  .slice(0, LIMIT);

console.log(`пробую ${candidates.length} сайтів, які fetch не подужав\n`);

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 1366, height: 900 },
  userAgent:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  locale: 'en-US',
});

const results: Record<string, unknown>[] = [];
let opened = 0;
let withSignal = 0;

for (const [i, p] of candidates.entries()) {
  const page = await ctx.newPage();
  const rec: Record<string, unknown> = {
    placeId: p.place_id, name: p.name, url: p.website, reviews: p.user_rating_count ?? 0,
  };
  try {
    await page.goto(p.website!, { waitUntil: 'domcontentloaded', timeout: 25_000 });
    await page.waitForTimeout(3000);

    /*
     * Челендж Cloudflare («Just a moment…») віддає повноцінну сторінку на
     * ~270 символів, і за розміром тексту вона неотличима від справжньої.
     * Перший замір через це нарахував 30 «відкритих» сайтів, хоча третина з
     * них були заглушками. Тому чекаємо, поки заголовок перестане бути
     * челенджем, і лише тоді читаємо.
     */
    const CHALLENGE = /just a moment|checking your browser|human verification|attention required|verifying you are human/i;
    for (let wait = 0; wait < 5 && CHALLENGE.test(await page.title()); wait++) {
      await page.waitForTimeout(3000);
    }

    const r = await page.evaluate(PROBE) as Record<string, number | string | boolean>;
    Object.assign(rec, r);
    rec.stillBlocked = CHALLENGE.test(String(r.title));
    if (!rec.stillBlocked && (r.textLen as number) > 400) opened++;

    const signal =
      (r.cyrillicChars as number) > 20 ||
      !!r.hreflang ||
      /^(ru|uk)/i.test(String(r.langAttr)) ||
      r.viber === true;
    rec.signal = signal;
    if (signal) withSignal++;
  } catch (e) {
    rec.error = (e as Error).message.split('\n')[0]!.slice(0, 70);
  } finally {
    await page.close();
  }
  results.push(rec);
  if ((i + 1) % 10 === 0) console.log(`  ${i + 1}/${candidates.length}`);
}

await browser.close();
if (OUT) writeFileSync(OUT, JSON.stringify(results, null, 1), 'utf8');

console.log(`\nвідкрилось браузером: ${opened} з ${candidates.length}`);
console.log(`з них мовний сигнал:  ${withSignal}`);
console.log('');
for (const r of results.filter((x) => x.signal)) {
  console.log(`  ✓ ${String(r.reviews).padStart(4)} відг · ${String(r.name).slice(0, 38).padEnd(40)} кир=${r.cyrillicChars} lang=${r.langAttr} hreflang=${r.hreflang} viber=${r.viber}`);
}
