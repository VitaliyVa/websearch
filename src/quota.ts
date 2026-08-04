import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ROOT } from './config.js';

/**
 * ОБЛІК ВИТРАТ — ЄДИНЕ, ЩО СТОЇТЬ МІЖ НАМИ І РЕАЛЬНИМИ ГРОШИМА.
 *
 * Поставити ліміт на боці Google не можна: override квоти вимагає організації
 * (Workspace), на споживчому акаунті Google відповідає
 * COMMON_QUOTA_ORG_QUOTA_CONSUMER_NOT_ALLOWED_FOR_LOCATION. Тому цей лічильник —
 * не зручність, а єдиний бар'єр. Звідси три правила:
 *
 *  1. Лічильник живе ПОЗА data/. Видалення бази (звична дія при перезапуску
 *     з нуля) не має обнуляти пам'ять про вже витрачені запити — Google свій
 *     місячний лічильник не обнуляє.
 *  2. Інкремент ПЕРЕД запитом, не після. Якщо процес впаде посеред виклику,
 *     краще порахувати зайвий запит, ніж недорахувати оплачений.
 *  3. Fail-closed. Будь-яка помилка читання файлу — вважаємо ліміт вичерпаним.
 */

const LEDGER = resolve(ROOT, '.quota-ledger.json');

/** Безкоштовні місячні ліміти Google (per-SKU). Не змінювати без перевірки. */
export const FREE_TIER = {
  text_search: 1000, //  Text Search Enterprise (маска містить websiteUri/rating)
  place_details: 1000, //  Place Details Enterprise + Atmosphere (reviews)
  psi: 25_000, //  PageSpeed Insights — на ДОБУ, не на місяць
} as const;

export type Api = keyof typeof FREE_TIER;

type Ledger = Record<string, Record<string, number>>; // month -> api -> count

const month = () => new Date().toISOString().slice(0, 7);

function read(): Ledger {
  if (!existsSync(LEDGER)) return {};
  try {
    return JSON.parse(readFileSync(LEDGER, 'utf8')) as Ledger;
  } catch {
    // Fail-closed: пошкоджений файл не має відкривати шлюз
    throw new Error(
      `Файл обліку квоти пошкоджено: ${LEDGER}\n` +
        `Це єдиний захист від реальних витрат, тому продовжувати не можна.\n` +
        `Перевір поточні витрати в Google Cloud Console → Billing → Reports і віднови файл вручну.`,
    );
  }
}

function write(l: Ledger) {
  // Атомарний запис: спершу тимчасовий файл, потім rename.
  // Обрив на середині не залишить порожній ledger.
  const tmp = `${LEDGER}.tmp`;
  writeFileSync(tmp, JSON.stringify(l, null, 2), 'utf8');
  renameSync(tmp, LEDGER);
}

export function used(api: Api): number {
  return read()[month()]?.[api] ?? 0;
}

export function remaining(api: Api, cap: number): number {
  return Math.max(0, Math.min(cap, FREE_TIER[api]) - used(api));
}

/** Інкремент ПЕРЕД запитом. Повертає нове значення. */
export function charge(api: Api, by = 1): number {
  const l = read();
  const m = month();
  l[m] ??= {};
  l[m][api] = (l[m][api] ?? 0) + by;
  write(l);
  return l[m][api]!;
}

export class QuotaExceeded extends Error {
  constructor(public api: Api, public usedCount: number, public cap: number) {
    super(
      `Ліміт ${api} вичерпано: ${usedCount}/${cap} за ${month()}.\n` +
        `Безкоштовний тир Google для цього SKU — ${FREE_TIER[api]}/міс. ` +
        `Далі почались би реальні гроші, тому зупиняюсь.\n` +
        `Варіанти: чекати 1 числа (ліміт скидається) або свідомо дозволити оплату ` +
        `(--allow-paid + змінна ALLOW_PAID_SPEND=yes у .env).`,
    );
    this.name = 'QuotaExceeded';
  }
}

/**
 * Перевіряє І одразу списує. Викидає ДО того, як запит піде в мережу.
 * cap ніколи не може бути більшим за безкоштовний тир, якщо не дозволена оплата.
 */
export function chargeOrThrow(api: Api, cap: number, allowPaid: boolean): void {
  const effectiveCap = allowPaid ? cap : Math.min(cap, FREE_TIER[api]);
  const before = used(api);
  if (before >= effectiveCap) throw new QuotaExceeded(api, before, effectiveCap);
  charge(api);
}

/**
 * Дозвіл на платні виклики вимагає ДВОХ незалежних підтверджень: прапорця
 * і змінної в .env. Один випадковий --allow-paid у команді не може коштувати грошей.
 */
export function paidSpendAllowed(flag: boolean): boolean {
  if (!flag) return false;
  return (process.env.ALLOW_PAID_SPEND ?? '').toLowerCase() === 'yes';
}

export function snapshot(): { api: Api; used: number; free: number; left: number }[] {
  return (Object.keys(FREE_TIER) as Api[]).map((api) => ({
    api,
    used: used(api),
    free: FREE_TIER[api],
    left: Math.max(0, FREE_TIER[api] - used(api)),
  }));
}
