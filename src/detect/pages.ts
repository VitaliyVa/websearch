import { fetchText } from '../util/http.js';

export interface StructureResult {
  pageCount: number;
  uniquePageTypes: number;
  hasCatalog: boolean;
  hasEcommerce: boolean;
  hasForms: boolean;
  languages: number;
  sitemapFound: boolean;
}

const CATALOG_RE = /\/(menu|shop|store|catalog|catalogue|products?|services?|prices?|pricing|portfolio|gallery)\b/i;
const ECOM_RE =
  /(add[- _]?to[- _]?cart|\/cart\b|\/checkout\b|woocommerce|shopping[- _]?cart|data-product-id|snipcart)/i;
const FORM_RE = /<form[^>]*>[\s\S]{0,3000}?<(?:input|textarea)/i;

/**
 * Кількість і типи сторінок. Спершу sitemap (1 запит, точні дані),
 * інакше — внутрішні посилання з головної.
 * Ці ж числа потім живлять формулу оцінки годин розробки.
 */
export async function detectStructure(baseUrl: string, html: string): Promise<StructureResult> {
  const urls = new Set<string>();
  let sitemapFound = false;

  const origin = (() => {
    try {
      return new URL(baseUrl).origin;
    } catch {
      return null;
    }
  })();

  if (origin) {
    for (const candidate of ['/sitemap.xml', '/sitemap_index.xml', '/sitemap-index.xml']) {
      const xml = await fetchText(`${origin}${candidate}`);
      if (!xml || !/<(?:urlset|sitemapindex)/i.test(xml)) continue;
      sitemapFound = true;

      // sitemap index → тягнемо перші 3 дочірні, далі сенсу нема
      if (/<sitemapindex/i.test(xml)) {
        const children = [...xml.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/gi)]
          .map((m) => m[1]!)
          .slice(0, 3);
        for (const child of children) {
          const childXml = await fetchText(child);
          if (!childXml) continue;
          for (const m of childXml.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/gi)) urls.add(m[1]!);
        }
      } else {
        for (const m of xml.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/gi)) urls.add(m[1]!);
      }
      break;
    }
  }

  // Fallback: внутрішні посилання з головної
  if (urls.size === 0) {
    for (const m of html.matchAll(/href=["']([^"'#]+)["']/gi)) {
      const href = m[1]!;
      if (/^(mailto:|tel:|javascript:|data:)/i.test(href)) continue;
      try {
        const u = new URL(href, baseUrl);
        if (origin && u.origin !== origin) continue;
        if (/\.(jpg|jpeg|png|gif|svg|webp|pdf|zip|doc|docx|xls|mp4|css|js)$/i.test(u.pathname)) continue;
        urls.add(u.toString());
      } catch {
        /* ignore */
      }
    }
  }

  const paths = [...urls]
    .map((u) => {
      try {
        return new URL(u).pathname.replace(/\/+$/, '') || '/';
      } catch {
        return null;
      }
    })
    .filter((p): p is string => !!p);

  // Тип сторінки = перший сегмент шляху. /services/roofing і /services/siding —
  // один тип (шаблон), а не два окремі макети.
  const types = new Set(paths.map((p) => p.split('/')[1] ?? 'root'));

  const langSegments = new Set(
    paths
      .map((p) => /^\/(ru|uk|ua|en|es|pl)(\/|$)/i.exec(p)?.[1]?.toLowerCase())
      .filter((x): x is string => !!x),
  );

  return {
    pageCount: Math.max(1, paths.length),
    uniquePageTypes: Math.max(1, types.size),
    hasCatalog: paths.some((p) => CATALOG_RE.test(p)) || CATALOG_RE.test(html.slice(0, 30_000)),
    hasEcommerce: ECOM_RE.test(html),
    hasForms: FORM_RE.test(html),
    languages: Math.max(1, langSegments.size),
    sitemapFound,
  };
}
