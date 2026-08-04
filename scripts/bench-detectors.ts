/**
 * Заміряє детектори на НАЙБІЛЬШИХ сторінках кешу — саме там ховаються
 * регекси з катастрофічним відкатом. Кожна сторінка має вкластися в бюджет,
 * інакше друкуємо винного.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import * as cheerio from 'cheerio';
import { paths } from '../src/config.js';
import { detectOwnerName } from '../src/detect/owner-name.js';
import { detectSiteLanguage } from '../src/detect/site-language.js';
import { detectTech, footerYear } from '../src/detect/tech.js';
import { extractEmails, extractSocials } from '../src/detect/contacts.js';
import { htmlToText } from '../src/util/text.js';

const BUDGET_MS = 1000;
const N = Number(process.argv[2] ?? 40);

const files = readdirSync(paths.cache)
  .map((f) => ({ f, size: statSync(resolve(paths.cache, f)).size }))
  .sort((a, b) => b.size - a.size)
  .slice(0, N);

console.log(`${N} найбільших сторінок кешу, бюджет ${BUDGET_MS} мс на сторінку\n`);

const totals: Record<string, number> = {};
let slow = 0;

for (const { f, size } of files) {
  let html: string;
  try {
    html = JSON.parse(readFileSync(resolve(paths.cache, f), 'utf8')).html ?? '';
  } catch {
    continue;
  }
  if (!html) continue;

  const steps: [string, () => unknown][] = [];
  let text = '';
  steps.push(['htmlToText', () => (text = htmlToText(html))]);
  steps.push(['detectTech', () => detectTech(html)]);
  steps.push(['footerYear', () => footerYear(html)]);
  steps.push(['detectSiteLanguage', () => detectSiteLanguage({ html, text, host: 'x.com' })]);
  steps.push(['extractSocials', () => extractSocials(html)]);
  let emails: string[] = [];
  steps.push(['extractEmails', () => (emails = extractEmails(html))]);
  steps.push(['detectOwnerName', () => detectOwnerName(html, emails)]);
  steps.push(['cheerio.load', () => cheerio.load(html)]);

  let pageMs = 0;
  const worst: [string, number][] = [];
  for (const [label, fn] of steps) {
    const t = Date.now();
    fn();
    const ms = Date.now() - t;
    totals[label] = (totals[label] ?? 0) + ms;
    pageMs += ms;
    if (ms > 200) worst.push([label, ms]);
  }

  if (pageMs > BUDGET_MS) {
    slow++;
    console.log(
      `ПОВІЛЬНО ${(size / 1024).toFixed(0)} КБ → ${pageMs} мс   ` +
        worst.map(([l, m]) => `${l}=${m}мс`).join(' '),
    );
  }
}

console.log('\nсумарно по кроках:');
for (const [k, v] of Object.entries(totals).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${k.padEnd(20)} ${String(v).padStart(6)} мс  (${Math.round(v / files.length)} мс/стор)`);
}
console.log(`\nсторінок понад бюджет: ${slow} з ${files.length}`);
