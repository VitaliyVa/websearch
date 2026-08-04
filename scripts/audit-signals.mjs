/**
 * Самоперевірка сигналів: чи не спрацьовують вони на тому, на що не мали.
 * Той самий метод, яким знайшли 96% хибних telegram_contact.
 */
import { DatabaseSync } from 'node:sqlite';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const db = new DatabaseSync(resolve(ROOT, 'data', 'leads.db'), { readOnly: true });

const line = (s) => console.log('\n' + '─'.repeat(72) + '\n' + s);

/* ─── 1. ru_phone проти РЕАЛЬНИХ американських номерів із Google ─────────── */
const RU_PHONE_RE = /\+?\s?7[\s\-(]?9\d{2}[\s\-)]?\d{3}/;
const UA_PHONE_RE = /\+?\s?380[\s\-(]?\d{2}/;

line('1. ru_phone / ua_phone проти телефонів, які Google дав як США');
{
  const rows = db.prepare('SELECT name, phone, address FROM places WHERE phone IS NOT NULL').all();
  const ruHits = rows.filter((r) => RU_PHONE_RE.test(r.phone));
  const uaHits = rows.filter((r) => UA_PHONE_RE.test(r.phone));
  console.log(`  американських номерів у базі: ${rows.length}`);
  console.log(`  з них ловить ru_phone:  ${ruHits.length}  (${Math.round((ruHits.length / rows.length) * 100)}%)`);
  console.log(`  з них ловить ua_phone:  ${uaHits.length}`);
  console.log('  приклади хибних (це нормальні номери США):');
  for (const r of ruHits.slice(0, 8)) console.log(`     ${r.phone.padEnd(18)} ${r.name.slice(0, 40)}`);
}

/* ─── 2. surname_pattern проти назв бізнесів ─────────────────────────────── */
const SURNAMES = [
  [/\b\w{3,}(enko|chenko)\b/i, '-енко'],
  [/\b\w{3,}(chuk|tchouk|czuk)\b/i, '-чук'],
  [/\b\w{3,}(shyn|yshyn|ishin)\b/i, '-ишин'],
  [/\b\w{3,}(uk|yuk|iuk)\b/i, '-ук/-юк'],
  [/\b\w{3,}(sky|skiy|ski|skyy|skaya)\b/i, '-ський'],
  [/\b\w{3,}(ovich|ovych|evich|evych)\b/i, '-ович'],
  [/\b\w{3,}(nyuk|niuk|liuk)\b/i, '-нюк'],
  [/\b\w{4,}(ov|ev|off|eff)\b/i, '-ов/-ев'],
  [/\b\w{3,}(itsky|itskiy|nitsky)\b/i, '-ицький'],
];

line('2. surname_pattern — на що саме спрацьовує');
{
  const rows = db.prepare('SELECT name FROM places').all();
  const byPattern = new Map();
  for (const r of rows) {
    for (const [re, label] of SURNAMES) {
      const m = re.exec(r.name);
      if (m) {
        const list = byPattern.get(label) ?? [];
        list.push(`${m[0]}  ←  ${r.name.slice(0, 45)}`);
        byPattern.set(label, list);
        break;
      }
    }
  }
  for (const [label, list] of [...byPattern.entries()].sort((a, b) => b[1].length - a[1].length)) {
    console.log(`  ${label.padEnd(10)} ${String(list.length).padStart(4)} спрацювань`);
    for (const s of list.slice(0, 6)) console.log(`      ${s}`);
  }
}

/* ─── 3. brand_marker ────────────────────────────────────────────────────── */
const BRANDS = [
  [/\b(ukrain\w*|ukr)\b/i, 'ukrainian'],
  [/\b(russian|russia)\b/i, 'russian'],
  [/\bslavic\b/i, 'slavic'],
  [/\b(kyiv|kiev|odessa|odesa|lviv|kharkiv|dnipro)\b/i, 'укр місто'],
  [/\b(moscow|siberia|volga|baikal)\b/i, 'рос топонім'],
  [/\b(eastern european|euro\s?market|euro\s?deli|euro\s?food)\b/i, 'euro market'],
  [/\b(kalyna|veselka|troyanda|smachno|nasha|nashe|privet|babushka|matryoshka|samovar|kalinka|berezka)\b/i, 'слов. бренд'],
  [/\b(pyrohy|pierogi|varenyky|borscht|borsch|pelmeni|shashlik|blini)\b/i, 'страва'],
  [/\b(baltic|belarus|moldova|caucasus)\b/i, 'сусідній регіон'],
];

line('3. brand_marker — на що саме спрацьовує');
{
  const rows = db.prepare('SELECT name FROM places').all();
  const byPattern = new Map();
  for (const r of rows) {
    for (const [re, label] of BRANDS) {
      const m = re.exec(r.name);
      if (m) {
        const list = byPattern.get(label) ?? [];
        list.push(`${m[0]}  ←  ${r.name.slice(0, 45)}`);
        byPattern.set(label, list);
        break;
      }
    }
  }
  for (const [label, list] of [...byPattern.entries()].sort((a, b) => b[1].length - a[1].length)) {
    console.log(`  ${label.padEnd(16)} ${String(list.length).padStart(4)}`);
    for (const s of list.slice(0, 4)) console.log(`      ${s}`);
  }
}

db.close();
