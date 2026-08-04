import type { HoursEstimate, SiteAudit } from '../types.js';

/**
 * Оцінка годин фронтендера на самописний сайт «з нуля» за структурою старого.
 * Віддаємо ДІАПАЗОН — точна цифра тут була б фальшивою точністю, а продажнику
 * діапазон корисніший для торгу.
 */
export function estimateHours(a: SiteAudit | null): HoursEstimate {
  const breakdown: string[] = [];
  let h = 0;

  const add = (hours: number, label: string) => {
    h += hours;
    breakdown.push(`${label}: ${hours}г`);
  };

  add(10, 'база (setup, layout, header/footer, деплой)');

  if (!a) {
    // Сайту нема / не відкрився — рахуємо типовий лендінг малого бізнесу
    add(9, 'типова структура (3 сторінки)');
    add(4, 'адаптив + QA');
    add(3, 'контент з нуля');
    return finalize(h, breakdown);
  }

  const types = Math.min(a.uniquePageTypes, 8);
  add(3 * types, `типи сторінок (${types} унікальних макетів)`);

  if (a.hasCatalog) add(6, 'каталог / меню / прайс');
  if (a.hasEcommerce) add(8, 'e-commerce (кошик, checkout)');
  if (a.languages > 1) add(4, `мультимовність (${a.languages} мови)`);
  if (a.hasForms) add(3, 'форми / інтеграції');

  add(4, 'адаптив 3 брейкпоінти + QA');

  const migration = Math.ceil(Math.min(a.pageCount, 60) / 5) * 1.5;
  add(Math.round(migration), `контент-міграція (~${Math.min(a.pageCount, 60)} сторінок)`);

  return finalize(h, breakdown);
}

function finalize(h: number, breakdown: string[]): HoursEstimate {
  return {
    min: Math.round(h * 0.85),
    max: Math.round(h * 1.25),
    breakdown,
  };
}

export const formatHours = (e: HoursEstimate) => `${e.min}-${e.max} год`;
