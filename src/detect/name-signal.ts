import type { Evidence } from '../types.js';
import { isSlavicName } from './slavic-names.js';

/**
 * Слов'янські прізвищні закінчення у латинській транслітерації.
 * Обережно з -ov/-ev: ловлять і болгарські/македонські прізвища, тому вага мала.
 * Порядок важливий — довші патерни перевіряємо першими.
 */
const SURNAME_PATTERNS: { re: RegExp; weight: number; label: string }[] = [
  { re: /\b\w{3,}(enko|chenko)\b/i,          weight: 20, label: '-енко' },
  { re: /\b\w{3,}(chuk|tchouk|czuk)\b/i,     weight: 20, label: '-чук' },
  { re: /\b\w{3,}(shyn|yshyn|ishin)\b/i,     weight: 18, label: '-ишин' },
  { re: /\b\w{3,}(uk|yuk|iuk)\b/i,           weight: 12, label: '-ук/-юк' },
  { re: /\b\w{3,}(ovich|ovych|evich|evych)\b/i, weight: 16, label: '-ович' },
  { re: /\b\w{3,}(nyuk|niuk|liuk)\b/i,       weight: 16, label: '-нюк' },
  { re: /\b\w{4,}(ov|ev|off|eff)\b/i,        weight: 8,  label: '-ов/-ев' },
  { re: /\b\w{3,}(itsky|itskiy|nitsky)\b/i,  weight: 16, label: '-ицький' },
  /*
   * Голі -ski / -sky прибрані навмисно.
   *
   * У Чикаго польська громада більша за українську, і патерн ловив саме її:
   * Baranowski, Wiklanski, Kurowski. Плюс топонім Pulaski (вулиця в Чикаго,
   * трапляється в назвах десятків бізнесів) і англійські слова —
   * TrueSky Shingle Roofers.
   * Лишаємо тільки транслітерації з кирилиці, які поляки не використовують.
   */
  { re: /\b\w{3,}(skiy|skyy|skaya|tsky)\b/i, weight: 14, label: '-ський (кирилична транслітерація)' },
];

/** Закінчення, характерні саме для польських прізвищ. */
const POLISH_SURNAME_RE = /\b\w{3,}(owski|ewski|inski|ynski|owicz|ewicz|czyk|czak|kowska|owska)\b/i;

/** Явні етнічні маркери в назві бізнесу. */
const BRAND_MARKERS: { re: RegExp; weight: number; label: string }[] = [
  { re: /\b(ukrain\w*|ukr)\b/i,                       weight: 30, label: 'ukrainian' },
  { re: /\b(russian|russia)\b/i,                      weight: 26, label: 'russian' },
  { re: /\bslavic\b/i,                                weight: 26, label: 'slavic' },
  { re: /\b(kyiv|kiev|odessa|odesa|lviv|kharkiv|dnipro)\b/i, weight: 28, label: 'укр місто в назві' },
  { re: /\b(moscow|siberia|volga|baikal)\b/i,         weight: 20, label: 'рос топонім' },
  { re: /\b(eastern european|euro\s?market|euro\s?deli|euro\s?food)\b/i, weight: 22, label: 'euro market' },
  { re: /\b(kalyna|veselka|troyanda|smachno|nasha|nashe|privet|babushka|matryoshka|samovar|kalinka|berezka)\b/i,
    weight: 26, label: 'слов. бренд' },
  { re: /\b(pyrohy|pierogi|varenyky|borscht|borsch|pelmeni|shashlik|blini)\b/i, weight: 24, label: 'страва' },
  { re: /\b(baltic|belarus|moldova|caucasus)\b/i,     weight: 14, label: 'сусідній регіон' },
];

/** Жорсткі виключення — інші слов'яни, які теж дадуть кирилицю/патерни. */
const EXCLUDE = [
  { re: /\b(polish|poland|polski|pierogi\s?polska)\b/i, label: 'polish' },
  { re: /\b(serbian|croatian|bosnian|balkan|cevapi)\b/i, label: 'balkan' },
  { re: /\b(bulgarian|bulgaria)\b/i, label: 'bulgarian' },
  { re: /\b(czech|slovak|prague)\b/i, label: 'czech' },
  { re: POLISH_SURNAME_RE, label: 'polish surname' },
];

export interface NameSignal {
  score: number;
  evidence: Evidence[];
  exclusion: string | null;
}

export function nameSignal(businessName: string, websiteHost = ''): NameSignal {
  const evidence: Evidence[] = [];
  const haystack = `${businessName} ${websiteHost.replace(/[.-]/g, ' ')}`;

  for (const ex of EXCLUDE) {
    if (ex.re.test(haystack)) {
      return { score: 0, evidence: [{ signal: 'name_exclusion', weight: 0, detail: ex.label }], exclusion: ex.label };
    }
  }

  let score = 0;

  for (const m of BRAND_MARKERS) {
    if (m.re.test(haystack)) {
      score += m.weight;
      evidence.push({ signal: 'brand_marker', weight: m.weight, detail: `назва: ${m.label}` });
      break; // один маркер достатньо, не накручуємо
    }
  }

  for (const s of SURNAME_PATTERNS) {
    if (s.re.test(businessName)) {
      score += s.weight;
      evidence.push({ signal: 'surname_pattern', weight: s.weight, detail: `прізвище ${s.label}` });
      break;
    }
  }

  /*
   * Прізвища на приголосний (Мельник, Мороз, Бондар) суфікси не ловлять —
   * тільки словник. Режим 'business' навмисний: у назві компанії повно
   * англійських слів, тому імена й слабкі суфікси там не рахуються.
   */
  if (!evidence.some((e) => e.signal === 'surname_pattern')) {
    for (const token of businessName.split(/[\s',.&/()-]+/)) {
      const v = isSlavicName(token, { context: 'business' });
      if (v.ok && v.strong) {
        score += 20;
        evidence.push({
          signal: 'surname_known',
          weight: 20,
          detail: `прізвище у назві: ${token} (${v.via})`,
        });
        break;
      }
    }
  }

  return { score: Math.min(score, 40), evidence, exclusion: null };
}
