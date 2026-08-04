const US_STATES = new Set([
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD',
  'MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC',
  'SD','TN','TX','UT','VT','VA','WA','WV','WI','WY','DC','PR','VI','GU','AS','MP',
]);

/**
 * Places API з `regionCode: 'US'` НЕ додає «USA» до formattedAddress — країна
 * опускається для результатів усередині регіону. Тому перевіряємо структуру
 * американської адреси: «..., <Місто>, <ШТАТ> <ZIP>».
 *
 * Приклад: «2242 W Chicago Ave Unit 1, Chicago, IL 60622»
 */
export function isUsAddress(address: string | null | undefined): boolean {
  if (!address) return false;
  if (/\bUSA\b|\bUnited States\b/i.test(address)) return true;

  // ", IL 60622" або ", IL 60622-1234"
  const m = /,\s*([A-Z]{2})\s+\d{5}(?:-\d{4})?\b/.exec(address);
  if (m && US_STATES.has(m[1]!)) return true;

  // Іноді ZIP відсутній: "..., Chicago, IL"
  const tail = /,\s*([A-Z]{2})\s*$/.exec(address.trim());
  return !!tail && US_STATES.has(tail[1]!);
}

/** Штат із адреси — для колонки «Місто / район» і для сегментації. */
export function stateOf(address: string | null | undefined): string | null {
  if (!address) return null;
  const m = /,\s*([A-Z]{2})\s+\d{5}(?:-\d{4})?\b/.exec(address) ?? /,\s*([A-Z]{2})\s*$/.exec(address.trim());
  return m && US_STATES.has(m[1]!) ? m[1]! : null;
}

/** Місто з адреси США: передостанній компонент перед «ШТАТ ZIP». */
export function cityOf(address: string | null | undefined): string | null {
  if (!address) return null;
  const parts = address.split(',').map((p) => p.trim());
  for (let i = parts.length - 1; i >= 0; i--) {
    if (/^[A-Z]{2}\s+\d{5}/.test(parts[i]!) || /^[A-Z]{2}$/.test(parts[i]!)) {
      return parts[i - 1] ?? null;
    }
  }
  return null;
}
