/**
 * Тести сигналів на реальних проблемних випадках із бази.
 * Кожен рядок тут — випадок, який колись давав хибний результат.
 *
 *   npm run test:signals
 */
import { analyzeAuthorNames, scoreAuthorNames } from '../src/detect/author-names.js';
import { nameSignal } from '../src/detect/name-signal.js';
import { detectOwnerName } from '../src/detect/owner-name.js';
import { detectSiteLanguage } from '../src/detect/site-language.js';

let failed = 0;

function check(label: string, actual: boolean, expected: boolean, detail = '') {
  const pass = actual === expected;
  if (!pass) failed++;
  console.log(
    `${pass ? '\x1b[32mOK  \x1b[0m' : '\x1b[31mFAIL\x1b[0m'} ${label.padEnd(38)} ${detail}`,
  );
}

console.log('\n── назва бізнесу ──────────────────────────────────────────');

const nameCases: [string, boolean, string][] = [
  // Польська громада Чикаго більша за українську — не має протікати
  ['Baranowski Bakery & Deli', false, 'польське -owski'],
  ["Wiklanski's Bakery", false, 'польське -anski'],
  ['Kurowski Sausage Shop', false, 'польське -owski'],
  ['Pulaski Roofing & Engineering', false, 'топонім Pulaski (вулиця в Чикаго)'],
  ['TrueSky Shingle Roofers', false, 'англійське Sky'],
  ['Polish & Slavic Federal Credit Union', false, 'явно польське'],
  ['Smith Auto Repair', false, 'нейтральна назва'],
  // Справжні
  ['Dovbenko Insurance Agency', true, '-енко'],
  ['Irina Shevchenko, Realtor', true, '-енко'],
  ['Khrystyna Savchuk, MD', true, '-чук'],
  ['Sverdloff Law Group, P.C.', true, '-офф'],
  ['Dr. Alexander Reznikov', true, '-ов'],
  ['Boris Sagalovich, MD', true, '-ович'],
  ['Oleg Baliuk Realtor', true, '-юк'],
  ['Ukraine Express Chicago', true, 'бренд ukrainian'],
];

for (const [name, expected, label] of nameCases) {
  const r = nameSignal(name);
  check(
    label,
    r.score > 0,
    expected,
    r.exclusion ? `виключено: ${r.exclusion}` : `${r.score} балів`,
  );
}

console.log('\n── месенджери у HTML ──────────────────────────────────────');

const htmlCases: [string, boolean, string][] = [
  ['<a href="https://t.me/mybiz">Telegram</a>', true, 'реальне посилання t.me'],
  ['<a href="viber://chat?number=%2B1312">Viber</a>', true, 'протокол viber://'],
  ['<i class="fa fa-telegram"></i>', false, 'іконковий шрифт fa-telegram'],
  ['<p>Follow us on Telegram and Viber</p>', false, 'просто текст у футері'],
  ['<script>var s=["telegram","viber"]</script>', false, 'віджет шеру'],
];

for (const [html, expected, label] of htmlCases) {
  const r = detectSiteLanguage({ html, text: '', host: 'example.com' });
  const fired = r.evidence.some((e) => e.signal === 'viber_contact' || e.signal === 'telegram_contact');
  check(label, fired, expected, `${r.score} балів`);
}

console.log('\n── телефони ───────────────────────────────────────────────');

const phoneCases: [string, boolean, string][] = [
  ['Call us: 847-925-1234', false, 'номер Чикаго (847) — не російський'],
  ['Phone 773-919-5500', false, 'номер Чикаго (773)'],
  ['Тел: +7 925 123 4567', true, 'справжній російський'],
  ['Київ: +380 44 123 4567', true, 'справжній український'],
  ['Order #7925336 shipped', false, 'номер замовлення'],
];

for (const [text, expected, label] of phoneCases) {
  const r = detectSiteLanguage({ html: text, text, host: 'example.com' });
  const fired = r.evidence.some((e) => e.signal === 'ru_phone' || e.signal === 'ua_phone');
  check(label, fired, expected, r.evidence.map((e) => e.signal).join(',') || '—');
}

console.log('\n── виключення інших слов\'ян ───────────────────────────────');

const exclCases: [string, string | null, string][] = [
  ['Београд Grill ђевапи', 'serbian_glyphs', 'сербські гліфи'],
  ['Магазин продукти Київ', null, 'українська — не виключати'],
];

for (const [text, expectedExcl, label] of exclCases) {
  const r = detectSiteLanguage({ html: text, text, host: 'example.com' });
  check(label, r.hardExclusion === expectedExcl, true, r.hardExclusion ?? 'без виключення');
}

console.log('\n── імена рецензентів ──────────────────────────────────────');

const authorCases: [string[], boolean, string][] = [
  [['Oksana Kovalenko', 'Dmytro Shevchenko', 'Iryna Bondar', 'John Smith', 'Mary Lee'],
    true, 'три слов\'янські з п\'яти'],
  [['Олена Ткаченко', 'Сергій Мороз', 'Mike Brown'],
    true, 'кирилиця в іменах'],
  [['John Smith', 'Mary Johnson', 'Robert Lee', 'Emily Davis', 'Chris Moore'],
    false, 'суто американські'],
  [['Baranowski Jan', 'Kowalczyk Anna', 'Nowak Piotr'],
    false, 'польські — не наші'],
  [['Martin Garcia', 'Robin Williams', 'Justin Marin'],
    false, 'латинські на -in, не -ін'],
  [['Aleksandr Petrov', 'Elena Sidorova', 'Dmitriy Volkov'],
    true, 'російські транслітерації'],
];

for (const [names, expected, label] of authorCases) {
  const stats = analyzeAuthorNames(names);
  const score = scoreAuthorNames(stats);
  check(label, score > 0, expected, `${stats.slavic}/${stats.total} → ${score} балів`);
}

console.log('\n── прізвища на приголосний (суфікси їх не ловлять) ────────');

const consonantSurnames: [string, boolean, string][] = [
  ['Ivan Melnyk', true, 'Мельник — найпоширеніше українське'],
  ['Petro Boyko', true, 'Бойко'],
  ['Olena Moroz', true, 'Мороз'],
  ['Vasyl Bondar', true, 'Бондар'],
  ['Taras Kravets', true, 'Кравець'],
  ['Andriy Tkach', true, 'Ткач'],
  ['Mykola Koval', true, 'Коваль'],
  ['Oleh Kushnir', true, 'Кушнір'],
  ['Ihor Oliynyk', true, 'Олійник'],
  ['Yuriy Shvets', true, 'Швець'],
  ['John Baker', false, 'англійське прізвище'],
  ['Mike Fisher', false, 'англійське прізвище'],
];

for (const [name, expected, label] of consonantSurnames) {
  const s = analyzeAuthorNames([name]);
  check(label, s.slavic > 0, expected, `${s.slavic}/${s.total}`);
}

console.log('\n── прізвище власника на сайті ─────────────────────────────');

const ownerCases: [string, string[], boolean, string][] = [
  // ── має спрацювати
  ['<p>Owner: Dmytro Kovalenko</p>', [], true, 'роль перед іменем'],
  ['<h2>Dr. Alexander Reznikov, DDS</h2>', [], true, 'лікар + звання'],
  ['<span>Anna Bondarchuk, Realtor</span>', [], true, 'ім\'я перед посадою'],
  ['<footer>© 2019 Sverdloff Enterprises LLC</footer>', [], true, 'копірайт'],
  [
    '<script type="application/ld+json">{"@type":"LocalBusiness","founder":{"@type":"Person","name":"Iryna Tkachenko"}}</script>',
    [], true, 'JSON-LD founder',
  ],
  ['<p>власник: Дмитро Коваленко</p>', [], true, 'кирилиця поруч з роллю'],
  ['', ['okovalenko@brightsmile.com'], true, 'прізвище в email'],

  // ── НЕ має спрацювати
  ['<p>"Great service!" — Oksana K., customer review</p>', [], false, 'відгук клієнта, не власник'],
  ['<p>Owner: Jan Baranowski</p>', [], false, 'польський власник'],
  ['<p>Owner: John Smith</p>', [], false, 'нейтральне ім\'я'],
  ['<p>We offer effective and innovative solutions</p>', [], false, 'англійські слова на -ive'],
  ['<p>Free estimates — no cutoff, no tradeoff</p>', [], false, 'слова на -off'],
  ['<p>Our team serves Chicago Avenue and Pulaski Road</p>', [], false, 'назви вулиць'],
  ['<p>Kovalenko Street is nearby</p>', [], false, 'прізвище без ролі — ігноруємо'],
  // знайдено прогоном по 1996 реальних сторінках
  ['<p>Our Honda Hummer service team</p>', [], false, 'марки авто поруч зі словом service'],
  ['<p>Agent Login Register here</p>', [], false, 'інтерфейс сайту'],
  ['<p>Owner: De Tan</p>', [], false, 'короткі токени'],
  ['<script type="application/ld+json">{"@type":"Person","name":"admin"}</script>', [], false, 'автор WordPress'],
  ['<p>Director Casey Tobin</p>', [], false, 'англійське прізвище на -in'],
  ['<p>Owner Julia Vanina</p>', [], false, 'слабкий суфікс -ina більше не рахується'],
  ['<p>Realtor Max Gorenyuk</p>', [], true, 'справжня знахідка з прогону'],
  ['<p>Dr. Myroslav Mykytyuk</p>', [], true, 'справжня знахідка з прогону'],
];

for (const [html, emails, expected, label] of ownerCases) {
  const r = detectOwnerName(html, emails);
  check(label, r.score > 0, expected, r.detail ?? `${r.score} балів`);
}

console.log(
  failed === 0
    ? '\n\x1b[32mусі тести пройшли\x1b[0m\n'
    : `\n\x1b[31m${failed} тестів не пройшло\x1b[0m\n`,
);
process.exitCode = failed ? 1 : 0;
