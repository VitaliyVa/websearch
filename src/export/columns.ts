/**
 * ЖОРСТКЕ ПРАВИЛО: колонки A..V — машинні, скрипт їх перезаписує.
 * Колонки W.. — людські (продажники), скрипт їх НІКОЛИ не читає і не пише.
 * Експорт працює через діапазон A:V, тому нотатки продажників фізично
 * не можуть бути затерті навіть при повному перепрогоні.
 */

export const MACHINE_COLUMNS = [
  'place_id',            // A
  'Назва компанії',      // B
  'Тип діяльності',      // C
  'Тир',                 // D
  'Місто / район',       // E
  'Сайт',                // F
  'Google Maps',         // G
  'Телефон',             // H
  'Email',               // I
  'Соцмережі',           // J
  'Оцінка сайту 1-10',   // K
  'Причини оцінки',      // L
  'Годин розробки',      // M
  'Мовний скор',         // N
  'Мова',                // O
  'Докази мови',         // P
  'Техстек',             // Q
  'PSI моб / деск',      // R
  'Адаптивний',          // S
  'HTTPS',               // T
  'Рейтинг / відгуки',   // U
  'Скрін + PSI звіт',    // V
] as const;

export const HUMAN_COLUMNS = [
  'Статус',              // W
  'Хто веде',            // X
  'Дата контакту',       // Y
  'Коментар',            // Z
] as const;

export const MACHINE_COL_COUNT = MACHINE_COLUMNS.length; // 22 → A..V
export const ALL_COLUMNS = [...MACHINE_COLUMNS, ...HUMAN_COLUMNS];

export const TABS = {
  leads: 'Leads',
  manual: 'Manual review',
  noSite: 'NO_SITE',
  rejected: 'Rejected',
  meta: 'Meta',
} as const;

export type TabKey = keyof typeof TABS;
