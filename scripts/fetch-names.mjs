/**
 * Тягне списки імен і прізвищ із категорій Wiktionary, нормалізує і пише
 * у data/names/*.json. Запускається ВРУЧНУ, результат комітиться в репозиторій —
 * аудит не має залежати від мережі й чужого API.
 *
 * Чому Wiktionary, а не датасети імен реальних людей: тут прізвища класифіковані
 * ЛІНГВІСТИЧНО (за мовою походження), а не за громадянством носіїв. Саме це
 * потрібно, щоб відрізняти українське прізвище від польського, а не «прізвище
 * людини, що живе в Україні» від «прізвища людини, що живе в Польщі».
 *
 * Ліцензія даних Wiktionary — CC BY-SA.
 *
 *   node scripts/fetch-names.mjs
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeName } from '../src/detect/translit.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(ROOT, 'data', 'names');
const API = 'https://en.wiktionary.org/w/api.php';

/** Цільові + КОНКУРЕНТНІ мови. Виключення тут важливіші за включення. */
const CATEGORIES = [
  { file: 'uk-surnames', cat: 'Ukrainian_surnames', role: 'target' },
  { file: 'ru-surnames', cat: 'Russian_surnames', role: 'target' },
  { file: 'uk-given', cat: 'Ukrainian_given_names', role: 'target' },
  { file: 'ru-given', cat: 'Russian_given_names', role: 'target' },
  { file: 'pl-surnames', cat: 'Polish_surnames', role: 'competitor' },
  { file: 'en-surnames', cat: 'English_surnames', role: 'competitor' },
  { file: 'en-given', cat: 'English_given_names', role: 'competitor' },
  { file: 'bg-surnames', cat: 'Bulgarian_surnames', role: 'competitor' },
  { file: 'sh-surnames', cat: 'Serbo-Croatian_surnames', role: 'competitor' },
  { file: 'cs-surnames', cat: 'Czech_surnames', role: 'competitor' },
];

async function fetchCategory(cat) {
  const titles = [];
  let cont;
  for (let page = 0; page < 40; page++) {
    const url =
      `${API}?action=query&list=categorymembers&cmtitle=Category:${cat}` +
      `&cmlimit=500&cmnamespace=0&format=json&origin=*` +
      (cont ? `&cmcontinue=${encodeURIComponent(cont)}` : '');

    // Wiktionary кидає 429 при щільних запитах — відступаємо і повторюємо.
    // Без цього конкурентні категорії (найважливіші, бо це виключення)
    // просто не завантажуються, і модель лишається без half виключень.
    let res;
    for (let attempt = 0; attempt < 6; attempt++) {
      res = await fetch(url, { headers: { 'User-Agent': 'websearch-leadbot/0.1 (contact: vistet1428@gmail.com)' } });
      if (res.ok) break;
      if (res.status !== 429 && res.status < 500) throw new Error(`${cat}: HTTP ${res.status}`);
      const wait = 2000 * 2 ** attempt;
      process.stdout.write(`[429, чекаю ${wait / 1000}с] `);
      await new Promise((r) => setTimeout(r, wait));
    }
    if (!res?.ok) throw new Error(`${cat}: не вдалось після 6 спроб`);
    const json = await res.json();

    for (const m of json.query?.categorymembers ?? []) titles.push(m.title);

    cont = json.continue?.cmcontinue;
    if (!cont) break;
    await new Promise((r) => setTimeout(r, 1200)); // ввічливість до API
  }
  return titles;
}

mkdirSync(OUT, { recursive: true });

const summary = [];
for (const { file, cat, role } of CATEGORIES) {
  process.stdout.write(`${cat.padEnd(28)} `);
  try {
    const raw = await fetchCategory(cat);
    // Відкидаємо службові сторінки й багатослівні статті
    const clean = raw.filter((t) => !t.includes(':') && t.split(/\s/).length === 1);
    const normalized = [...new Set(clean.map(normalizeName).filter((n) => n.length >= 3))];

    writeFileSync(
      resolve(OUT, `${file}.json`),
      JSON.stringify({ category: cat, role, source: 'en.wiktionary.org (CC BY-SA)', count: normalized.length, keys: normalized.sort() }, null, 0),
      'utf8',
    );
    console.log(`${String(raw.length).padStart(5)} сторінок → ${normalized.length} унікальних ключів`);
    summary.push({ file, role, count: normalized.length });
  } catch (e) {
    console.log(`ПОМИЛКА: ${e.message}`);
  }
}

console.log('\nпідсумок:');
for (const s of summary) console.log(`  ${s.file.padEnd(14)} ${s.role.padEnd(11)} ${s.count}`);
