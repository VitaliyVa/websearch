/**
 * Знімає кандидатів наживо у контрольованому розмірі.
 *
 * Навіщо, якщо скріни вже є: по-перше, старі десктопні знімки бувають вищі за
 * 2000 px і не читаються пакетно; по-друге, кеш показує стан на момент аудиту,
 * а рішення «чи вартий сайт заміни» треба ухвалювати за тим, що там ЗАРАЗ.
 *
 * Жодного запиту до Google — сайти тягнемо напряму, це безкоштовно.
 */
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from 'playwright';

const listPath = process.argv[2]!;
const outDir = process.argv[3]!;
const cands: { placeId: string; name: string; website: string }[] = JSON.parse(
  (await import('node:fs')).readFileSync(listPath, 'utf8'),
);

mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 1280, height: 820 },
  userAgent:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  locale: 'en-US',
});

let ok = 0;
let fail = 0;
const notes: string[] = [];

for (const [i, c] of cands.entries()) {
  const dest = resolve(outDir, `${String(i + 1).padStart(2, '0')}-${c.placeId}.jpg`);
  if (existsSync(dest)) { ok++; continue; }

  const page = await ctx.newPage();
  try {
    await page.goto(c.website, { waitUntil: 'domcontentloaded', timeout: 25_000 });
    // Даємо шанс шрифтам, ліниво завантаженим зображенням і челенджам
    await page.waitForTimeout(3500);
    const buf = await page.screenshot({ type: 'jpeg', quality: 72 });
    writeFileSync(dest, buf);
    const title = await page.title().catch(() => '');
    notes.push(`${i + 1}\t${c.name}\t${title.slice(0, 70)}`);
    ok++;
  } catch (e) {
    fail++;
    notes.push(`${i + 1}\t${c.name}\tПОМИЛКА: ${(e as Error).message.slice(0, 80)}`);
  } finally {
    await page.close();
  }
  if ((i + 1) % 10 === 0) console.log(`  ${i + 1}/${cands.length}`);
}

await browser.close();
writeFileSync(resolve(outDir, 'titles.tsv'), notes.join('\n'), 'utf8');
console.log(`знято ${ok}, помилок ${fail} → ${outDir}`);
