/**
 * Тести розпізнавання імен: нормалізація, словник, виключення.
 *
 * Негативні тести тут ВАЖЛИВІШІ за позитивні. Пропущений український лід —
 * втрачена можливість; хибно зарахований американець — продажник дзвонить
 * не туди, витрачає час і перестає довіряти таблиці.
 *
 *   npm run test:names
 */
import { indexStatus } from '../src/detect/name-index.js';
import { isSlavicName } from '../src/detect/slavic-names.js';
import { cyrillicToLatin, normalizeName } from '../src/detect/translit.js';

let failed = 0;
let passed = 0;

function check(label: string, actual: boolean, expected: boolean, detail = '') {
  const ok = actual === expected;
  ok ? passed++ : failed++;
  if (!ok) console.log(`  \x1b[31mFAIL\x1b[0m ${label.padEnd(30)} ${detail}`);
}

function section(title: string) {
  console.log(`\n── ${title} ${'─'.repeat(Math.max(0, 56 - title.length))}`);
}

const st = indexStatus();
console.log(
  `\nсловник: ${st.target} цільових ключів, ${st.competitor} конкурентних` +
    (st.ready ? '' : '  \x1b[31m(НЕ ЗАВАНТАЖЕНО — запусти scripts/fetch-names.mjs)\x1b[0m'),
);

/* ─────────── 1. Нормалізатор: варіанти дають один ключ ─────────── */
section('нормалізація: варіанти написання → один ключ');

const variantGroups: [string, string[]][] = [
  ['Віталій', ['Vitalii', 'Vitaliy', 'Vitaly', 'Vitali', 'Віталій']],
  // Kowalenko через w навмисно НЕ входить: w — польська орфографія, і зливання
  // її з v втрачало справжні прізвища на -ovskii через збіг з польськими
  ['Коваленко', ['Kovalenko', 'Коваленко']],
  // Sverdlow через w навмисно не входить — див. коментар про Kowalenko вище
  ['Свердлов', ['Sverdlov', 'Sverdloff', 'Свердлов']],
  ['Мельник', ['Melnyk', 'Melnik', "Mel'nyk", 'Мельник']],
  ['Шевченко', ['Shevchenko', 'Ševčenko', 'Шевченко']],
  ['Щербак', ['Shcherbak', 'Scherbak', 'Щербак']],
  ['Юрій', ['Yurii', 'Yuriy', 'Jurij', 'Юрій']],
];

for (const [canonical, variants] of variantGroups) {
  const keys = variants.map(normalizeName);
  const allSame = new Set(keys).size === 1;
  check(canonical, allSame, true, `${variants.join(' / ')} → ${[...new Set(keys)].join(' ≠ ')}`);
}

/* ─────────── 2. Кирилиця розпізнається так само, як латиниця ─────────── */
section('кирилиця = латиниця');

const cyrPairs: [string, string][] = [
  ['Коваленко', 'Kovalenko'],
  ['Шевчук', 'Shevchuk'],
  ['Мельник', 'Melnyk'],
  ['Бондаренко', 'Bondarenko'],
];

for (const [cyr, lat] of cyrPairs) {
  const a = isSlavicName(cyr);
  const b = isSlavicName(lat);
  check(`${cyr} = ${lat}`, a.ok === b.ok, true, `${cyr}:${a.ok}(${a.via}) vs ${lat}:${b.ok}(${b.via})`);
}

/* ─────────── 3. НЕГАТИВНІ: американські прізвища ─────────── */
section('НЕ ловимо американські прізвища');

const american = [
  'Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Miller', 'Davis', 'Wilson',
  'Anderson', 'Thomas', 'Taylor', 'Moore', 'Jackson', 'White', 'Harris', 'Clark',
  'Lewis', 'Robinson', 'Walker', 'Young', 'Allen', 'King', 'Wright', 'Scott',
  'Hill', 'Green', 'Adams', 'Nelson', 'Baker', 'Hall', 'Campbell', 'Mitchell',
  'Carter', 'Roberts', 'Turner', 'Phillips', 'Parker', 'Evans', 'Edwards',
  'Collins', 'Stewart', 'Morris', 'Murphy', 'Kelly', 'Brady', 'Kennedy',
  'Grady', 'Cook', 'Bailey', 'Reed', 'Cooper', 'Richardson', 'Cox', 'Howard',
  'Ward', 'Peterson', 'Gray', 'Ramirez', 'James', 'Watson', 'Sanders', 'Price',
  'Bennett', 'Wood', 'Barnes', 'Ross', 'Henderson', 'Coleman', 'Jenkins',
  'Perry', 'Powell', 'Long', 'Patterson', 'Hughes', 'Flores', 'Washington',
  'Butler', 'Simmons', 'Foster', 'Gonzales', 'Bryant', 'Alexander', 'Russell',
  'Griffin', 'Diaz', 'Hayes', 'Myers', 'Ford', 'Hamilton', 'Graham', 'Sullivan',
];

let americanHits = 0;
for (const name of american) {
  const r = isSlavicName(name);
  if (r.ok) {
    americanHits++;
    console.log(`  \x1b[31mFAIL\x1b[0m американське спрацювало: ${name} (${r.via})`);
    failed++;
  } else passed++;
}
console.log(`  американських перевірено: ${american.length}, хибних: ${americanHits}`);

/* ─────────── 4. НЕГАТИВНІ: сусідні слов'яни ─────────── */
section("НЕ ловимо поляків, чехів, сербів");

const neighbours = [
  'Nowak', 'Kowalski', 'Wojcik', 'Wisniewski', 'Dabrowski', 'Lewandowski',
  'Zielinski', 'Szymanski', 'Wozniak', 'Kozlowski', 'Jankowski', 'Kwiatkowski',
  'Krawczyk', 'Piotrowski', 'Grabowski', 'Pawlowski', 'Michalski', 'Nowicki',
  'Adamczyk', 'Dudek', 'Baranowski', 'Kurowski', 'Wiklanski',
  'Jovanovic', 'Petrovic', 'Nikolic', 'Markovic',
  'Novotny', 'Svoboda', 'Dvorak', 'Cerny', 'Prochazka',
];

for (const name of neighbours) {
  const r = isSlavicName(name);
  check(name, r.ok, false, `спрацювало через ${r.via}`);
}

/* ─────────── 5. ПОЗИТИВНІ: наші прізвища ─────────── */
section('ЛОВИМО українські та російські');

const ours = [
  // на -енко / -чук — суфікси мали б упоратись
  'Shevchenko', 'Kovalenko', 'Bondarenko', 'Tkachenko', 'Kravchenko',
  'Kovalchuk', 'Shevchuk', 'Polishchuk', 'Savchuk', 'Melnychuk',
  // на приголосний — тільки список або словник
  'Melnyk', 'Boyko', 'Moroz', 'Bondar', 'Kravets', 'Tkach', 'Koval',
  'Kushnir', 'Oliynyk', 'Shvets',
  // російські
  'Ivanov', 'Petrov', 'Sokolov', 'Reznikov', 'Tsyrulnikov', 'Sverdloff',
  // імена
  'Oksana', 'Dmytro', 'Volodymyr', 'Svitlana', 'Aleksandr', 'Ekaterina',
];

let missed = 0;
for (const name of ours) {
  const r = isSlavicName(name);
  if (!r.ok) {
    missed++;
    console.log(`  \x1b[33mПРОПУСК\x1b[0m ${name}`);
    failed++;
  } else passed++;
}
console.log(`  наших перевірено: ${ours.length}, пропущено: ${missed}`);

/* ─────────── 6. З ЖИВОГО прогону відгуків ─────────── */
section('реальні імена рецензентів (прогін 50 викликів)');

const liveReviewers: [string, boolean, string][] = [
  // мають спрацювати — реальні знахідки
  ['Oksana Curran', true, 'Galaxy Banquets'],
  ['Марта Матвійчук', true, 'кирилиця'],
  ['Nazar Khudoba', true, 'Galaxy Banquets'],
  ['Andrian Treshchuk', true, 'USKO Shipping'],
  ['Andrey Losetskiy', true, 'USKO Shipping'],
  ['Khrystyna Zakharuk', true, 'VarenychOK'],
  ['Lesia Vasylynchuk', true, 'VarenychOK'],
  ['Olha Lukianchuk', true, 'Nakone Law'],
  ['Anton Timofeyev', true, 'Dr. Lev Elterman'],
  ['Valeriia Buchkovska', true, 'NovaMed'],
  // пропускались через нормалізацію суфікса — тепер мають ловитись
  ['Igor Gordovskiy', true, 'був хибний пропуск'],
  ['Nikita Sladkovskii', true, 'був хибний пропуск'],
  ['Evaa Sokolovska', true, 'був хибний пропуск'],
  ['Denis Zazulka', false, 'відомий пропуск: -ka не покрито'],
  // хибні спрацювання — НЕ мають
  ['Charlotte Renfrow', false, 'американка, ловилась через w→v'],
  ['Dhroov Patel', false, 'індієць, ловився через імʼя'],
  ['Jonathan Lee', false, 'американець'],
  ['Heather K', false, 'американка'],
  ['Cathy Baechle', false, 'американка'],
  ['Massoud Formuly', false, 'афганець'],
  ['Yousef Popalzai', false, 'афганець'],
  ['Uros Prodanovic', false, 'серб'],
  ['Ann Marie Carlson', false, 'американка'],
];

for (const [name, expected, label] of liveReviewers) {
  const r = isSlavicName(name);
  check(`${name} — ${label}`, r.ok, expected, `via ${r.via}`);
}

/* ─────────── підсумок ─────────── */
console.log(
  failed === 0
    ? `\n\x1b[32mусі ${passed} тестів пройшли\x1b[0m\n`
    : `\n\x1b[31m${failed} не пройшло\x1b[0m, ${passed} пройшло\n`,
);
process.exitCode = failed ? 1 : 0;

// Тримаємо посилання, щоб лінтер не викинув імпорт
void cyrillicToLatin;
