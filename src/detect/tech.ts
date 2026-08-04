/**
 * Легкий tech-детектор. Wappalyzer з серпня 2023 closed-source (npm-пакет
 * депрекейтнутий), тому тримаємо власний набір фінгерпринтів — його достатньо,
 * бо нас цікавить не «яка технологія», а «наскільки старий стек».
 */

export interface TechResult {
  cms: string | null;
  builder: string | null;
  jqueryVersion: string | null;
  jqueryMajor: number | null;
  bootstrapMajor: number | null;
  hasFlash: boolean;
  tableLayout: boolean;
  modernFramework: string | null;
  stack: string[];
}

const CMS: { name: string; re: RegExp }[] = [
  { name: 'WordPress', re: /wp-content\/|wp-includes\/|<meta[^>]+generator[^>]+WordPress/i },
  { name: 'Joomla', re: /\/media\/jui\/|<meta[^>]+generator[^>]+Joomla/i },
  { name: 'Drupal', re: /\/sites\/default\/files\/|Drupal\.settings|<meta[^>]+generator[^>]+Drupal/i },
  { name: 'Magento', re: /\/skin\/frontend\/|Mage\.Cookies|static\/version\d+\/frontend/i },
  { name: 'PrestaShop', re: /prestashop/i },
  { name: 'DotNetNuke', re: /dnn(core|_)|DotNetNuke/i },
  { name: 'Bitrix', re: /bitrix\/(js|templates|cache)/i },
];

const BUILDERS: { name: string; re: RegExp }[] = [
  { name: 'Wix', re: /static\.wixstatic\.com|wix-code|_wixCssStates|X-Wix-/i },
  { name: 'Squarespace', re: /squarespace\.com|static1\.squarespace|Static\.SQUARESPACE_CONTEXT/i },
  { name: 'GoDaddy Website Builder', re: /websitebuilder\.godaddy|img1\.wsimg\.com/i },
  { name: 'Weebly', re: /weebly\.com|editmysite\.com/i },
  { name: 'Shopify', re: /cdn\.shopify\.com|Shopify\.theme/i },
  { name: 'Tilda', re: /tilda(cdn|\.cc)/i },
  { name: 'Duda', re: /dudamobile|dudaone|irp-cdn\.multiscreensite/i },
  { name: 'Webflow', re: /webflow\.(com|io)|data-wf-page/i },
  { name: 'Site123', re: /site123\.me/i },
  { name: 'Jimdo', re: /jimdo(static)?\.com/i },
  { name: 'Web.com / Network Solutions', re: /web\.com\/builder|netsol/i },
];

/** Наявність сучасного фреймворку = це НЕ наш лід. */
const MODERN: { name: string; re: RegExp }[] = [
  { name: 'Next.js', re: /\/_next\/static\/|__NEXT_DATA__/i },
  { name: 'Nuxt', re: /\/_nuxt\/|__NUXT__/i },
  { name: 'Astro', re: /astro-island|data-astro-cid/i },
  { name: 'Remix', re: /__remixContext|\/build\/manifest-/i },
  { name: 'SvelteKit', re: /\/_app\/immutable\/|__sveltekit/i },
  { name: 'Gatsby', re: /___gatsby|page-data\.json/i },
  { name: 'Tailwind (JIT build)', re: /class=["'][^"']*\b(?:md|lg):(?:flex|grid|hidden|w-|px-|py-)/i },
];

const OLD_STACK: { name: string; re: RegExp }[] = [
  { name: 'AngularJS 1.x', re: /angular\.min\.js|ng-app=/i },
  { name: 'Prototype.js', re: /prototype\.js/i },
  { name: 'MooTools', re: /mootools/i },
  { name: 'Flash', re: /\.swf\b|application\/x-shockwave-flash|<embed[^>]+swf/i },
  { name: 'Silverlight', re: /\.xap\b|application\/x-silverlight/i },
  { name: 'Font Awesome 4', re: /font-awesome\/4\.|fa-fw["' ]/i },
  { name: 'Google Fonts (legacy)', re: /fonts\.googleapis\.com\/css\?family=/i },
  { name: 'jQuery UI', re: /jquery-ui/i },
];

/**
 * Стеля обсягу для повнотекстових сканів.
 *
 * Ознаки стеку (CMS, jQuery, білдер) сидять у head і перших екранах розмітки —
 * далі йде контент. Обмеження прибирає цілий клас ризиків: будь-який регекс із
 * відкатом на сторінці в кілька мегабайт може підвісити прогін, і шукати їх
 * поодинці марно.
 */
const MAX_SCAN = 400_000;

export function detectTech(fullHtml: string): TechResult {
  const html = fullHtml.length > MAX_SCAN ? fullHtml.slice(0, MAX_SCAN) : fullHtml;
  const stack: string[] = [];

  const cms = CMS.find((c) => c.re.test(html))?.name ?? null;
  if (cms) stack.push(cms);

  const builder = BUILDERS.find((b) => b.re.test(html))?.name ?? null;
  if (builder) stack.push(builder);

  const modernFramework = MODERN.find((m) => m.re.test(html))?.name ?? null;
  if (modernFramework) stack.push(modernFramework);

  // jQuery: з імені файлу або з рядка версії
  const jqueryVersion =
    /jquery[.-](\d+\.\d+(?:\.\d+)?)(?:\.min)?\.js/i.exec(html)?.[1] ??
    /jQuery\s+v?(\d+\.\d+(?:\.\d+)?)/i.exec(html)?.[1] ??
    /jquery\/(\d+\.\d+(?:\.\d+)?)\//i.exec(html)?.[1] ??
    null;
  const jqueryMajor = jqueryVersion ? Number(jqueryVersion.split('.')[0]) : null;
  if (jqueryVersion) stack.push(`jQuery ${jqueryVersion}`);
  else if (/jquery(\.min)?\.js/i.test(html)) stack.push('jQuery (версія невідома)');

  const bootstrapVersion =
    /bootstrap[.-](\d+)\.\d+(?:\.\d+)?(?:\.min)?\.(?:js|css)/i.exec(html)?.[1] ??
    /Bootstrap\s+v(\d+)\./i.exec(html)?.[1] ??
    /bootstrap\/(\d+)\.\d+/i.exec(html)?.[1] ??
    null;
  const bootstrapMajor = bootstrapVersion ? Number(bootstrapVersion) : null;
  if (bootstrapMajor) stack.push(`Bootstrap ${bootstrapMajor}`);

  for (const o of OLD_STACK) if (o.re.test(html)) stack.push(o.name);

  const hasFlash = /\.swf\b|application\/x-shockwave-flash|<embed[^>]+swf/i.test(html);

  /*
   * Вкладеність таблиць рахуємо за позиціями, а не регексом.
   *
   * Було: /<table[\s\S]{0,4000}?<table\b/i — лінивий квантифікатор пробує кожну
   * позицію в документі, розгортаючись до 4000 символів. На сторінці в 1.5 МБ
   * це мільярди операцій, і прогін зависав назовсім. Індекси дають той самий
   * результат за один прохід.
   */
  const tablePositions: number[] = [];
  for (const m of html.matchAll(/<table\b/gi)) {
    tablePositions.push(m.index ?? 0);
    if (tablePositions.length > 200) break; // більше рахувати нема сенсу
  }
  const closePositions = [...html.matchAll(/<\/table\s*>/gi)].slice(0, 200).map((m) => m.index ?? 0);

  // Вкладена, якщо друга <table> відкривається раніше, ніж закривається перша
  const nestedTable =
    tablePositions.length >= 2 &&
    closePositions.length >= 1 &&
    tablePositions[1]! < closePositions[0]!;

  const tableCount = tablePositions.length;
  const tableLayout = tableCount >= 3 && nestedTable;
  if (tableLayout) stack.push('верстка таблицями');

  return {
    cms, builder, jqueryVersion, jqueryMajor, bootstrapMajor,
    hasFlash, tableLayout, modernFramework,
    stack: [...new Set(stack)],
  };
}

/** Рік з копірайту у футері — найпростіший індикатор «сайт кинули». */
export function footerYear(html: string): number | null {
  const tail = html.slice(-12_000);
  const years: number[] = [];
  for (const m of tail.matchAll(/(?:©|&copy;|copyright|\(c\))[^<>]{0,60}?((?:19|20)\d{2})/gi)) {
    years.push(Number(m[1]));
  }
  for (const m of tail.matchAll(/((?:19|20)\d{2})\s*(?:—|-|–)\s*((?:19|20)\d{2})/g)) {
    years.push(Number(m[2]));
  }
  if (!years.length) return null;
  const current = new Date().getFullYear();
  const plausible = years.filter((y) => y >= 1995 && y <= current + 1);
  return plausible.length ? Math.max(...plausible) : null;
}
