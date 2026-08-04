/**
 * Кольори статусів — одне джерело для всієї панелі.
 *
 * Той самий колір використовують бейдж на картці, смуга зліва й воронка на
 * графіку. Якби кожне місце фарбувалось окремо, «зелене» на діаграмі й
 * «зелене» на картці означали б різне, і продажник перестав би довіряти
 * кольору взагалі.
 *
 * Логіка шкали: холодне — робота триває, тепле — потрібна дія, зелене —
 * виграли, червоне — програли, сіре — вибуло.
 */
export interface StatusStyle {
  /** HEX для графіків і смуги на картці */
  color: string;
  /** Варіант Badge з XDS */
  badge: 'blue' | 'cyan' | 'yellow' | 'orange' | 'purple' | 'green' | 'red' | 'neutral';
}

const STYLES: Record<string, StatusStyle> = {
  'Новий': { color: '#2563eb', badge: 'blue' },
  'В роботі': { color: '#0891b2', badge: 'cyan' },
  'Дзвонив, не відповів': { color: '#d97706', badge: 'yellow' },
  'Зацікавлений': { color: '#7c3aed', badge: 'purple' },
  'Відправив пропозицію': { color: '#ea580c', badge: 'orange' },
  'Угода': { color: '#059669', badge: 'green' },
  'Відмова': { color: '#dc2626', badge: 'red' },
  'Не наш профіль': { color: '#64748b', badge: 'neutral' },
};

const UNPROCESSED: StatusStyle = { color: '#94a3b8', badge: 'neutral' };

export function statusStyle(status: string | null | undefined): StatusStyle {
  const s = String(status ?? '').trim();
  if (!s) return UNPROCESSED;
  // Невідомий статус (наприклад, сміття, що заїхало з сусідньої колонки)
  // навмисно червоний: це не нормальний стан і має впадати в око.
  return STYLES[s] ?? { color: '#dc2626', badge: 'red' };
}

export const UNPROCESSED_COLOR = UNPROCESSED.color;
