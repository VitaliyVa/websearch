import type { PsiResult, SiteAudit } from '../types.js';

const YEAR = new Date().getFullYear();

export interface QualityScore {
  /** 1..10, де 1 = найгірший сайт = найкращий лід */
  score10: number;
  raw: number;
  reasons: string[];
  status: 'ok' | 'dead' | 'blocked' | 'no_site';
  /**
   * Ознаки застарілості, які НЕ залежать від швидкості.
   *
   * Швидкість — асиметричний доказ: повільний сайт точно поганий, а швидкий
   * не доводить нічого. Примітивна сторінка 2012 року без зображень вантажиться
   * за 0.4 с і отримує PSI 95 — за одним лише числом вона виглядає «сучасною»
   * і вилітала б з лідів, хоча саме її і треба переробляти.
   *
   * Тому рішення «чи вартий сайт заміни» спирається на ці маркери, а не на
   * підсумковий бал. Наявність хоч одного означає: сайт застарілий незалежно
   * від того, як швидко він вантажиться.
   */
  datedMarkers: string[];
}

/** Bot-protection (Cloudflare тощо). Сайт може бути будь-яким — ми його не бачили. */
const BLOCKED_STATUSES = new Set([401, 403, 406, 429, 451]);

/**
 * Детермінована формула замість «AI на око»: продажник має бачити стабільну
 * цифру і причини, інакше не довірятиме. 100 балів мінус штрафи.
 */
export function scoreSite(a: SiteAudit | null, psi: PsiResult | null, hasWebsite: boolean): QualityScore {
  if (!hasWebsite) {
    return { score10: 1, raw: 0, reasons: ['сайту нема взагалі'], status: 'no_site', datedMarkers: ['сайту нема'] };
  }
  // Заблокований ≠ мертвий. Сайт може бути ідеальним — ми його просто не бачили,
  // тому оцінку не вигадуємо, а відправляємо на ручну перевірку.
  if (a && a.httpStatus != null && BLOCKED_STATUSES.has(a.httpStatus)) {
    return {
      score10: 5,
      raw: 50,
      reasons: [`сайт закритий bot-protection (HTTP ${a.httpStatus}) — потрібна ручна перевірка`],
      status: 'blocked',
      datedMarkers: [],
    };
  }

  if (!a || a.fetchError || !a.httpStatus || a.httpStatus >= 500 || a.httpStatus === 0) {
    return {
      score10: 1,
      raw: 0,
      reasons: [`сайт не відкривається (${a?.fetchError ?? a?.httpStatus ?? 'no response'})`],
      status: 'dead',
      datedMarkers: ['сайт не відкривається'],
    };
  }

  let s = 100;
  const reasons: string[] = [];
  const hit = (cond: boolean, pts: number, why: string) => {
    if (cond) {
      s -= pts;
      reasons.push(`−${pts} ${why}`);
    }
  };

  // ── адаптивність: найсильніший аргумент у продажу
  hit(!a.hasViewportMeta, 25, 'нема viewport meta — не адаптивний');

  // ── безпека
  hit(!a.https, 15, 'нема HTTPS');
  hit(a.mixedContent, 8, 'mixed content');
  hit(a.tlsExpired, 10, 'прострочений SSL');

  /*
   * ── швидкість: головний ваговий блок
   *
   * Ваги підняті після заміру на реальних лідах. Galaxy Banquets вантажиться
   * 18.7 секунди на мобільному — і за старою шкалою отримував лише −15, бо мав
   * viewport і мета-теги. Виходило «сайт нормальний», хоч він непридатний.
   *
   * Швидкість — це і є аргумент у продажу. «Ваш сайт вантажиться 18 секунд»
   * переконує клієнта, а відсутність og:title — ні. Тому шкала градуйована,
   * а не бінарна: катастрофічний LCP має коштувати більше за всю гігієну разом.
   */
  if (psi?.mobileScore != null) {
    hit(psi.mobileScore < 30, 25, `PSI mobile ${psi.mobileScore} — критично`);
    hit(psi.mobileScore >= 30 && psi.mobileScore < 50, 18, `PSI mobile ${psi.mobileScore}`);
    hit(psi.mobileScore >= 50 && psi.mobileScore < 80, 8, `PSI mobile ${psi.mobileScore}`);
  }
  if (psi?.lcpMs != null) {
    const s = (psi.lcpMs / 1000).toFixed(1);
    hit(psi.lcpMs > 10_000, 30, `LCP ${s}s — сайт практично не відкривається`);
    hit(psi.lcpMs > 6000 && psi.lcpMs <= 10_000, 20, `LCP ${s}s`);
    hit(psi.lcpMs > 4000 && psi.lcpMs <= 6000, 12, `LCP ${s}s`);
    hit(psi.lcpMs > 2500 && psi.lcpMs <= 4000, 5, `LCP ${s}s`);
  }
  if (psi?.cls != null) {
    hit(psi.cls > 0.5, 10, `CLS ${psi.cls.toFixed(2)} — верстка стрибає`);
    hit(psi.cls > 0.25 && psi.cls <= 0.5, 5, `CLS ${psi.cls.toFixed(2)}`);
  }

  // ── вік стеку
  hit(a.jqueryVersion != null && Number(a.jqueryVersion.split('.')[0]) <= 2, 8, `jQuery ${a.jqueryVersion}`);
  hit(a.hasFlash, 15, 'Flash / Silverlight');
  hit(a.tableLayout, 10, 'верстка таблицями');
  hit(a.bootstrapMajor != null && a.bootstrapMajor <= 3, 6, `Bootstrap ${a.bootstrapMajor}`);
  hit(!a.charsetDeclared, 3, 'нема meta charset');
  hit(a.footerYear != null && YEAR - a.footerYear >= 3, 10, `копірайт ${a.footerYear}`);

  // ── SEO / базова гігієна
  hit(!a.title || !a.metaDescription, 5, 'нема title або description');
  hit(!a.h1, 3, 'нема H1');
  hit(!a.ogTags, 4, 'нема OpenGraph');
  hit(!a.favicon, 2, 'нема favicon');

  // ── анти-лід
  if (a.modernFramework) {
    s += 25;
    reasons.push(`+25 сучасний стек (${a.modernFramework}) — НЕ наш лід`);
  }

  /* ── ознаки застарілості, незалежні від швидкості ─────────────────── */
  const dated: string[] = [];
  if (!a.hasViewportMeta) dated.push('не адаптивний');
  if (a.tableLayout) dated.push('верстка таблицями');
  if (a.hasFlash) dated.push('Flash');
  if (!a.https) dated.push('нема HTTPS');
  if (a.jqueryVersion && Number(a.jqueryVersion.split('.')[0]) <= 2) dated.push(`jQuery ${a.jqueryVersion}`);
  if (a.bootstrapMajor != null && a.bootstrapMajor <= 3) dated.push(`Bootstrap ${a.bootstrapMajor}`);
  if (a.footerYear != null && YEAR - a.footerYear >= 3) dated.push(`копірайт ${a.footerYear}`);
  if (a.tlsExpired) dated.push('прострочений SSL');
  if (DATED_BUILDERS.test(a.builder ?? '')) dated.push(`конструктор ${a.builder}`);
  if (!a.charsetDeclared) dated.push('нема meta charset');

  const raw = Math.max(0, Math.min(100, s));
  return {
    score10: Math.max(1, Math.min(10, Math.round(raw / 10))),
    raw,
    reasons,
    status: 'ok',
    datedMarkers: dated,
  };
}

/** Конструктори, чиї шаблони вже виглядають застарілими незалежно від швидкості. */
const DATED_BUILDERS = /GoDaddy|Weebly|Site123|Jimdo|Web\.com|Network Solutions|Wix/i;
