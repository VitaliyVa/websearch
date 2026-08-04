/**
 * Замір «віку дизайну» прямо в браузері.
 *
 * Технічна оцінка сайту (site_score) каже лише, чи він справний: HTTPS,
 * viewport, швидкість, мета-теги. Сайт 2014 року, якому підкрутили ці речі,
 * отримує 9/10 і вилітає з лідів — хоча саме його треба переробляти.
 *
 * Тут міряємо інше: якими ПРИЙОМАМИ він зроблений. Кожна техніка має вік,
 * і набір технік датує сайт надійніше, ніж копірайт у футері (той часто
 * підставляє скрипт автоматично).
 *
 * Жодних запитів до Google — сайти тягнемо напряму, це безкоштовно.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';

/*
 * Тіло заміру — РЯДОК, а не функція, і це принципово.
 *
 * tsx проганяє файл через esbuild, який іменованим функціям дописує хелпер
 * __name. У браузер той хелпер не потрапляє, тож передана функція падає з
 * «__name is not defined». Саме так мовчки вмерли 45 із 47 перших замірів:
 * скрипт відпрацював «успішно» і повернув порожнечу.
 */
const PROBE = `(() => {
  const html = document.documentElement.outerHTML;

  let css = '';
  for (const sheet of Array.from(document.styleSheets)) {
    try { for (const rule of Array.from(sheet.cssRules)) css += rule.cssText; }
    catch (e) { /* крос-доменний CSS не прочитати */ }
  }

  const imgs = Array.from(document.images);

  // Рахуємо ЗАСТОСОВАНІ стилі, а не згадки в файлі фреймворку
  let gridUsed = 0, flexUsed = 0;
  const els = Array.from(document.body.querySelectorAll('*')).slice(0, 1500);
  for (const el of els) {
    const d = getComputedStyle(el).display;
    if (d === 'grid' || d === 'inline-grid') gridUsed++;
    if (d === 'flex' || d === 'inline-flex') flexUsed++;
  }

  const jq = (window.jQuery && window.jQuery.fn && window.jQuery.fn.jquery) || null;
  const years = Array.from(html.matchAll(/(?:©|&copy;|copyright)[^0-9]{0,40}(20[0-9]{2})/gi)).map(m => Number(m[1]));
  const text = document.body.innerText || '';

  return {
    title: document.title.slice(0, 90),
    cssVars: /--[a-z-]+\\s*:/i.test(css),
    cssClamp: /clamp\\(/.test(css),
    gridUsed: gridUsed,
    flexUsed: flexUsed,
    floatLayout: (css.match(/float\\s*:\\s*(left|right)/g) || []).length,
    jquery: jq,
    bootstrap3: /col-(xs|sm|md|lg)-[0-9]/.test(html),
    fontAwesome4: /font-awesome\\/4|fa fa-/.test(html),
    tables: document.querySelectorAll('table').length,
    webp: imgs.filter(im => /\\.(webp|avif)/i.test(im.currentSrc || im.src)).length,
    totalImgs: imgs.length,
    lazyImgs: imgs.filter(im => im.loading === 'lazy').length,
    copyrightYear: years.length ? Math.max.apply(null, years) : null,
    fixedWidth: /max-width\\s*:\\s*(960|970|1000|1140|1170)px/.test(css),
    cyrillic: /[\\u0400-\\u04FF]{4,}/.test(text),
    langLinks: Array.from(document.querySelectorAll('a')).filter(a =>
      /\\b(ru|rus|укр|рус|russian|ukrainian)\\b/i.test(a.textContent || '') ||
      /[?&/](lang=)?(ru|uk)\\b/.test(a.getAttribute('href') || '')).length,
    textLen: text.length,
    isSocialOnly: /instagram\\.com|facebook\\.com|ebay\\.com/.test(location.hostname),
    finalHost: location.hostname,
  };
})()`;

const listPath = process.argv[2]!;
const outPath = process.argv[3]!;
const cands: { placeId: string; name: string; website: string }[] = JSON.parse(readFileSync(listPath, 'utf8'));

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 1366, height: 900 },
  userAgent:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  locale: 'en-US',
});

const results: Record<string, unknown>[] = [];

for (const [i, c] of cands.entries()) {
  const page = await ctx.newPage();
  const rec: Record<string, unknown> = { n: i + 1, placeId: c.placeId, name: c.name, url: c.website };

  try {
    await page.goto(c.website, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await page.waitForTimeout(3500);
    Object.assign(rec, await page.evaluate(PROBE));
  } catch (e) {
    rec.error = (e as Error).message.split('\n')[0]!.slice(0, 90);
  } finally {
    await page.close();
  }

  results.push(rec);
  if ((i + 1) % 10 === 0) console.log(`  ${i + 1}/${cands.length}`);
}

await browser.close();
writeFileSync(outPath, JSON.stringify(results, null, 1), 'utf8');

const failed = results.filter((r) => r.error).length;
console.log(`готово: ${results.length - failed} заміряно, ${failed} не вдалось → ${outPath}`);
