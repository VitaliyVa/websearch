/**
 * Клієнт до Apps Script.
 *
 * У браузері НЕМА жодного ключа Google — тільки код доступу продажника,
 * який перевіряється на боці Apps Script. Тому навіть повний дамп бандла
 * нічого не дає стороннім.
 */

const API_URL = import.meta.env.VITE_API_URL as string | undefined;

export interface Lead extends Record<string, unknown> {
  place_id: string;
  'Назва компанії': string;
  'Тип діяльності': string;
  Тир: string;
  'Місто / район': string;
  Сайт: string;
  'Google Maps': string;
  Телефон: string;
  Email: string;
  Соцмережі: string;
  'Оцінка сайту 1-10': number | string;
  'Причини оцінки': string;
  'Годин розробки': string;
  'Мовний скор': number | string;
  Мова: string;
  'Докази мови': string;
  Техстек: string;
  'PSI моб / деск': string;
  Адаптивний: string;
  HTTPS: string;
  'Рейтинг / відгуки': string;
  'Скрін + PSI звіт': string;
  Статус: string;
  'Хто веде': string;
  'Дата контакту': string;
  Коментар: string;
  __tab: string;
}

export interface Payload {
  leads: Lead[];
  manual: Lead[];
  noSite: Lead[];
  statuses: string[];
}

export class ApiError extends Error {}

function requireUrl(): string {
  if (!API_URL) {
    throw new ApiError(
      'Не задано VITE_API_URL. Створи web/.env із адресою веб-застосунку Apps Script.',
    );
  }
  return API_URL;
}

export async function fetchLeads(code: string): Promise<{ user: string; data: Payload }> {
  const url = `${requireUrl()}?action=leads&code=${encodeURIComponent(code)}`;
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new ApiError(`Сервер відповів ${res.status}`);

  const json = await res.json();
  if (!json.ok) throw new ApiError(json.error ?? 'Невідома помилка');
  return { user: json.user, data: json.data };
}

/**
 * Content-Type навмисно text/plain.
 *
 * Apps Script не відповідає на CORS-preflight, а браузер шле OPTIONS для
 * будь-якого application/json. text/plain вважається «простим» запитом,
 * preflight не викликається — і запит проходить. Тіло однаково парситься
 * як JSON на боці скрипта.
 */
export async function updateLead(
  code: string,
  placeId: string,
  patch: { status?: string; note?: string },
): Promise<void> {
  const res = await fetch(requireUrl(), {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ action: 'update', code, placeId, ...patch }),
    redirect: 'follow',
  });
  if (!res.ok) throw new ApiError(`Сервер відповів ${res.status}`);

  const json = await res.json();
  if (!json.ok) throw new ApiError(json.error ?? 'Не вдалось зберегти');
}

/* ── зберігання коду: sessionStorage, не localStorage ──────────────
 * Закрив вкладку — вийшов. На спільному комп'ютері в офісі це має значення. */

const KEY = 'websearch.code';
export const saveCode = (c: string) => sessionStorage.setItem(KEY, c);
export const loadCode = () => sessionStorage.getItem(KEY) ?? '';
export const clearCode = () => sessionStorage.removeItem(KEY);
