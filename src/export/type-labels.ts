/**
 * Українські назви типів бізнесу.
 *
 * Google повертає primaryTypeDisplayName англійською (ми самі просимо en, бо
 * локалізовані назви ламали б порівняння в фільтрах). Продажнику ж уся панель
 * подається українською, і «Banking and finance» посеред українського речення
 * читається як недоробка.
 *
 * Список закритий і короткий навмисно: типів у наших нішах близько трьох
 * десятків, і краще чесно не перекласти рідкісний, ніж машинно спотворити.
 */
const MAP: Record<string, string> = {
  'lawyer': 'юрист',
  'services': 'послуги',
  'medical clinic': 'медична клініка',
  'medical center': 'медичний центр',
  'grocery store': 'продуктовий магазин',
  'consultant': 'консалтинг',
  'car repair and maintenance service': 'автосервіс',
  'insurance agency': 'страхова агенція',
  'doctor': 'лікар',
  'real estate agency': 'агенція нерухомості',
  'health': 'сфера здоров\'я',
  'ukrainian restaurant': 'український ресторан',
  'eastern european restaurant': 'східноєвропейський ресторан',
  'restaurant': 'ресторан',
  'shipping service': 'служба доставки',
  'wholesaler': 'оптова торгівля',
  'travel agency': 'турагенція',
  'store': 'магазин',
  'roofing contractor': 'покрівельні роботи',
  'general contractor': 'будівельний підрядник',
  'government office': 'державна установа',
  'gift shop': 'магазин подарунків',
  'educational institution': 'навчальний заклад',
  'book store': 'книгарня',
  'banquet hall': 'банкетна зала',
  'banking and finance': 'фінанси',
  'bakery': 'пекарня',
  'dentist': 'стоматологія',
  'beauty salon': 'салон краси',
  'hair salon': 'перукарня',
  'pharmacy': 'аптека',
  'moving company': 'вантажні перевезення',
  'trucking company': 'вантажоперевезення',
  'auto body shop': 'кузовний ремонт',
  'accountant': 'бухгалтерія',
  'insurance broker': 'страховий брокер',
  'construction company': 'будівельна компанія',
  'cafe': 'кафе',
  'deli': 'делікатеси',
  'supermarket': 'супермаркет',
};

/** Типи, де інтернет-магазин — норма. Для решти мітку подаємо обережніше. */
const RETAIL = new Set([
  'grocery store', 'store', 'gift shop', 'book store', 'bakery', 'pharmacy',
  'wholesaler', 'supermarket', 'deli', 'restaurant', 'ukrainian restaurant',
  'eastern european restaurant', 'cafe',
]);

export function typeLabelUk(raw: string | null | undefined): string {
  if (!raw) return '';
  const key = raw.trim().toLowerCase();
  return MAP[key] ?? raw.trim();
}

export function isRetail(raw: string | null | undefined): boolean {
  return !!raw && RETAIL.has(raw.trim().toLowerCase());
}
