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

/**
 * Кирилиця прямо в назві — найсильніший можливий сигнал.
 *
 * Google віддає назву так, як її зареєстрував власник. Якщо там кирилиця
 * («NE VKUSNO И TOCHKA», «Посилки В Україну»), сумніватись нема в чому.
 * Виняток — сербські гліфи, їх ловить окреме виключення нижче.
 */
const CYRILLIC_RE = /[Ѐ-ӿ]/;

/**
 * Явні етнічні маркери в назві бізнесу.
 *
 * Лексикон побудований з реальних назв у базі, а не з уяви. Головна знахідка:
 * діаспорні бізнеси в США масово беруть за назву звичайне побутове слово в
 * транслітерації — Stolovaya, Skovorodka, Gastronom, Selo. Носій англійської
 * так свій бізнес не назве, тому сигнал дуже чистий.
 */
const BRAND_MARKERS: { re: RegExp; weight: number; label: string }[] = [
  { re: /\b(ukrain\w*|ukr)\b/i,                       weight: 30, label: 'ukrainian' },
  { re: /\b(russian|russia)\b/i,                      weight: 26, label: 'russian' },
  { re: /\bslavic\b/i,                                weight: 26, label: 'slavic' },
  { re: /\b(kyiv|kiev|odessa|odesa|lviv|kharkiv|dnipro|poltava|vinnytsia|chernivtsi)\b/i,
    weight: 28, label: 'укр місто в назві' },
  { re: /\b(moscow|moskow|siberia|volga|baikal|samara|sochi|rostov)\b/i, weight: 20, label: 'рос топонім' },

  /*
   * «European deli/market» — стандартне брендування слов'янських продуктових
   * у США. Раніше правило вимагало буквального «euro market», тож повз нього
   * проходили Stefania's European Food Market (243 відгуки), Selo European
   * Deli (177), Berëzka European Market (156) — по базі таких 58.
   *
   * Вага помірна: під «European» іноді ховається італійська чи грецька
   * гастрономія, тому сам по собі маркер ліда не робить.
   */
  { re: /\b(eastern\s+european|europ\w*\s+(market|deli|food|bakery|grocer|kitchen)|euro\s?(market|deli|food|mix))\b/i,
    weight: 22, label: 'європейська гастрономія' },

  /*
   * Побутові слова в транслітерації. Найцінніша група — англомовний власник
   * такого не вигадає.
   */
  { re: /\b(stolovaya|stolovaia|skovorodka|gastronom|produkty|magazin|traktir|kulinaria)\b/i,
    weight: 30, label: 'побутове слово (їдальня/гастроном)' },
  { re: /\b(ber[eyëij]{1,2}[oz]?zka|beriozka|berjozka|kalyna|kalinka|veselka|troyanda|smachno|privet|babushka|matr[ye]shka|matryoshka|samovar|selo|sadko|troika|teremok|kolos|landish|ryabina|zhuravli|vasilki|vasylky)\b/i,
    weight: 28, label: 'слов. бренд' },
  { re: /\b(hetman|kozak|kazak|cossack|chumak|bandura|trembita|karpaty|dnister|str[ei]{1,2}cha|zustrich|kolyba|vatra|khata|puzata|smak)\b/i,
    weight: 28, label: 'укр культурний маркер' },
  { re: /\b(pyrohy|varenyk\w*|vareniki|borscht|borsch|pelmeni|shashlik|blini|blintz|syrniki|golubtsi|kholodets|kvas|halva|zefir|pastila)\b/i,
    weight: 24, label: 'страва' },

  /*
   * Імена в транслітерації. Навмисно ЛИШЕ ті написання, яких немає в
   * англійській: Aleksandr, а не Alexander; Dmitriy, а не Dmitri. Інакше
   * ловилися б «Roman Auto Body» та «Aaron's Movers».
   */
  { re: /\b(aleksandr|alexandr|dmitriy|dmitry|dmytro|lyudmila|liudmyla|yevgeni\w*|evgeni\w*|svitlana|svetlana|oksana|tetyana|tatyana|nadezhda|lyubov|raisa|zinaida|inessa|alla|galina|valentina|volodymyr|vyacheslav|anatoliy|gennadiy|arkady|arkadiy|vitaliy|mykola|taras|bohdan|ostap|yaroslav|ruslan|vadim|igor|iryna|irina|nataliya|nataliia)\b/i,
    weight: 22, label: 'імʼя в транслітерації' },

  /*
   * Пострадянські, але російськомовні громади: Центральна Азія, Кавказ.
   *
   * Для продажу це та сама аудиторія — бізнес у Брукліні з узбецькою чи
   * грузинською кухнею веде справи російською і сайт замовлятиме російською.
   * Вага нижча, а мітка явна, щоб продажник бачив, з ким має справу.
   */
  { re: /\b(tashkent|uzbek\w*|samarqand|samarkand|bukhara|chayhana|chaikhana|chayxona|ustaxona|lagman|somsa|plov)\b/i,
    weight: 16, label: 'Центральна Азія (російськомовні)' },
  { re: /\b(georgian|sakartvelo|genatsvale|khachapuri|khinkali|mtskheta|tbilisi|berikoni|oda\s+house|supra)\b/i,
    weight: 14, label: 'Грузія (російськомовні)' },
  { re: /\b(armenian|yerevan|azerbaijan|baku)\b/i, weight: 12, label: 'Кавказ (російськомовні)' },

  { re: /\b(baltic|belarus\w*|moldova|caucasus)\b/i, weight: 16, label: 'сусідній регіон' },
];

/** Жорсткі виключення — інші слов'яни, які теж дадуть кирилицю/патерни. */
const EXCLUDE = [
  /*
   * Польські маркери. Список поповнено зі справжніх назв у базі: sklep,
   * pączki, przychodnia, Lajkonik, Podkarpacie. У Чикаго польська громада
   * більша за українську, тож ціна помилки тут висока.
   */
  { re: /\b(polish|poland|polska|polski|sklep|paczki|pączki|przychodnia|lajkonik|podkarpacie|piekarnia|kielbasa|zakopane|krakow|warszawa)\b/i, label: 'polish' },
  { re: /\b(serbian|croatian|bosnian|balkan|cevapi|prodavnica|kulinarija|beograd|srpsk\w*)\b/i, label: 'balkan' },
  { re: /\b(bulgarian|bulgaria|banitsa)\b/i, label: 'bulgarian' },
  { re: /\b(czech|slovak|prague|praha)\b/i, label: 'czech' },
  { re: /\b(romanian|romania|mamaliga|bucuresti)\b/i, label: 'romanian' },
  { re: POLISH_SURNAME_RE, label: 'polish surname' },
  /*
   * «Russian River» — річка й виноробний регіон у Каліфорнії, за годину їзди
   * від Сакраменто. Без цього виключення кожна тамтешня автомайстерня
   * отримувала б 26 балів за слово «Russian».
   */
  { re: /\brussian\s+river\b/i, label: 'Russian River (топонім Каліфорнії)' },
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

  /*
   * Кирилиця в самій назві. Власник зареєстрував бізнес так, як говорить, —
   * сперечатись нема з чим. Сербські гліфи вже відсіяні виключенням вище.
   */
  if (CYRILLIC_RE.test(businessName)) {
    score += 35;
    evidence.push({ signal: 'cyrillic_in_name', weight: 35, detail: 'кирилиця в назві бізнесу' });
  }

  /*
   * Беремо НАЙСИЛЬНІШИЙ маркер, а не перший-ліпший.
   *
   * Раніше цикл зупинявся на першому збігу, тож результат залежав від порядку
   * в масиві: «European Market & Deli "Beryozka"» отримував 22 за загальне
   * «європейська гастрономія» і ніколи не доходив до «Beryozka» вагою 28.
   * Складати ваги теж не можна — назва з трьома маркерами вистрелила б у стелю
   * на порожньому місці.
   */
  let best: (typeof BRAND_MARKERS)[number] | null = null;
  for (const m of BRAND_MARKERS) {
    if (m.re.test(haystack) && (!best || m.weight > best.weight)) best = m;
  }
  if (best) {
    score += best.weight;
    evidence.push({ signal: 'brand_marker', weight: best.weight, detail: `назва: ${best.label}` });
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
