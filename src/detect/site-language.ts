import type { Evidence, LangSignal } from '../types.js';
import {
  BG_HINT_RE,
  countMatches,
  CYRILLIC_RE,
  RU_GLYPHS_RE,
  SR_GLYPHS_RE,
  UK_GLYPHS_RE,
} from '../util/text.js';

/**
 * Viber — найкращий «прихований» сигнал для діаспори в США.
 * Проникнення Viber серед американців ~0%, серед пострадянської діаспори — тотальне.
 * Спрацьовує навіть на повністю англомовному сайті.
 */
/*
 * Вимагаємо САМЕ ПОСИЛАННЯ, не згадку слова.
 *
 * Попередня версія ловила голе слово "viber"/"telegram" будь-де в коді — і
 * спрацьовувала на іконкових шрифтах (fa-telegram), шаблонних списках соцмереж
 * і віджетах шеру, які стоять у половини сайтів незалежно від того, чи бізнес
 * ними користується. Перевірка показала 96% хибних: реальне посилання t.me
 * було лише в 10 випадках із 224. Американські home care агенції отримували
 * +20 балів за іконку в футері шаблону.
 *
 * Тепер потрібен або протокол (viber://, tg://), або домен-посилання (t.me/),
 * або href, що веде на профіль.
 */
const VIBER_RE = /viber:\/\/|(?:href|data-href)=["'][^"']*viber[^"']*["']|(?:chat\.)?viber\.com\/[a-z0-9]/i;
const TELEGRAM_RE = /t\.me\/[a-z0-9_]|telegram\.me\/[a-z0-9_]|tg:\/\/|(?:href|data-href)=["'][^"']*t\.me\/[^"']*["']/i;
const WHATSAPP_RE = /wa\.me\/\d|api\.whatsapp\.com\/send/i;

/*
 * Обов'язковий «+» перед кодом країни.
 *
 * Без нього патерн «7 925 123» збігався зі звичайними американськими номерами,
 * записаними через дефіс: у «847-925-1234» фрагмент «7-925-123» виглядає точно
 * як російський мобільний. Чиказькі коди 847, 773, 917, 347 усі закінчуються
 * на 7, тож хибних спрацювань було б багато саме в цільовому регіоні.
 * Номер з-за кордону на сайті майже завжди пишуть із «+».
 */
const PHONE_UA_RE = /\+\s?380[\s\-(]?\d{2}/;
const PHONE_RU_RE = /\+\s?7[\s\-(]?9\d{2}[\s\-)]?\d{3}/;
const UAH_RE = /₴|\bгрн\b/i;

export interface SiteLangInput {
  html: string;
  text: string;
  host: string;
}

/** Стеля обсягу — та сама причина, що в detectTech і extractEmails. */
const MAX_SCAN = 400_000;

export function detectSiteLanguage(input: SiteLangInput): LangSignal {
  const html = input.html.length > MAX_SCAN ? input.html.slice(0, MAX_SCAN) : input.html;
  const text = input.text.length > MAX_SCAN ? input.text.slice(0, MAX_SCAN) : input.text;
  const { host } = input;
  const evidence: Evidence[] = [];
  const push = (signal: string, weight: number, detail?: string) =>
    evidence.push({ signal, weight, detail });

  // ── жорсткі виключення першими: дешевий вихід
  if (SR_GLYPHS_RE.test(text)) {
    return {
      score: 0, lang: null, hardExclusion: 'serbian_glyphs',
      evidence: [{ signal: 'exclusion', weight: 0, detail: 'сербські гліфи ђјљњћџ' }],
    };
  }
  const bgHits = countMatches(text, BG_HINT_RE);
  const ruHits = countMatches(text, RU_GLYPHS_RE);
  if (bgHits > 5 && ruHits === 0) {
    return {
      score: 0, lang: null, hardExclusion: 'bulgarian',
      evidence: [{ signal: 'exclusion', weight: 0, detail: `болгарський патерн ъ (${bgHits}×)` }],
    };
  }
  if (/\.(ru|by|su)$/i.test(host)) {
    return {
      score: 0, lang: null, hardExclusion: 'ru_by_domain',
      evidence: [{ signal: 'exclusion', weight: 0, detail: `домен ${host}` }],
    };
  }

  const cyrCount = countMatches(text, CYRILLIC_RE);
  const cyrRatio = cyrCount / Math.max(text.length, 1);
  const ukHits = countMatches(text, UK_GLYPHS_RE);

  // Абсолютної кількості гліфів мало: у російському тексті теж трапляється
  // кілька «і» чи «є» (імена, реклама, цитати). У справжньому українському
  // тексті і/ї/є/ґ — це ~8-10% усієї кирилиці, у російському менше 0.5%.
  // Тому вирішує ЧАСТКА, а не абсолютне число.
  const ukRatio = ukHits / Math.max(cyrCount, 1);
  const ruRatio = ruHits / Math.max(cyrCount, 1);

  if (ukHits > 3 && ukRatio >= 0.02) push('ukrainian_glyphs', 40, `${ukHits}× і/ї/є/ґ (${(ukRatio * 100).toFixed(1)}% кирилиці)`);
  else if (ukHits > 3) push('ukrainian_glyphs_trace', 8, `поодинокі укр гліфи (${ukHits}×, лише ${(ukRatio * 100).toFixed(1)}%)`);

  if (ruHits > 3 && ruRatio >= 0.01) push('russian_glyphs', 35, `${ruHits}× ы/э/ъ/ё (${(ruRatio * 100).toFixed(1)}% кирилиці)`);
  else if (ruHits > 3) push('russian_glyphs_trace', 8, `поодинокі рос гліфи (${ruHits}×)`);
  if (cyrRatio > 0.15 && ukHits <= 3 && ruHits <= 3) {
    push('cyrillic_content', 20, `${(cyrRatio * 100).toFixed(0)}% тексту кирилиця`);
  } else if (cyrCount >= 30 && cyrRatio <= 0.15 && ukHits <= 3 && ruHits <= 3) {
    // Англомовний сайт із вкрапленнями кирилиці — «Ласкаво просимо» в шапці,
    // назва послуги, підпис під фото. Для діаспори це характерний патерн:
    // сайт англійською, бо клієнти різні, але власник свій.
    push('cyrillic_fragments', 15, `кирилиця фрагментами (${cyrCount} символів)`);
  }

  if (VIBER_RE.test(html)) push('viber_contact', 35, 'Viber у контактах');
  if (TELEGRAM_RE.test(html)) push('telegram_contact', 20, 'Telegram у контактах');
  // WhatsApp сам по собі нейтральний, але разом з Viber підсилює
  if (WHATSAPP_RE.test(html) && VIBER_RE.test(html)) {
    push('messenger_combo', 5, 'Viber + WhatsApp');
  }

  if (PHONE_UA_RE.test(text)) push('ua_phone', 45, 'телефон +380');
  if (PHONE_RU_RE.test(text)) push('ru_phone', 15, 'телефон +7');
  if (UAH_RE.test(text)) push('uah_currency', 25, 'ціни в гривні');
  if (/\.(ua|com\.ua|kiev\.ua|kyiv\.ua|lviv\.ua)$/i.test(host)) {
    push('ua_domain', 50, `домен ${host}`);
  }

  const score = Math.max(0, Math.min(100, evidence.reduce((s, e) => s + e.weight, 0)));
  const lang: LangSignal['lang'] =
    ukHits > ruHits ? 'uk' : ruHits > 0 ? 'ru' : cyrCount > 30 ? 'cyr' : null;

  return { score, lang, evidence, hardExclusion: null };
}
