import { createHash } from 'node:crypto';

export const sha1 = (s: string) => createHash('sha1').update(s).digest('hex');

/** Нормалізація HTML перед порівнянням: без скриптів, коментарів і зайвих пробілів. */
export const normalizeHtml = (html: string) =>
  html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 20_000);

export const CYRILLIC_RE = /[Ѐ-ӿ]/g;
export const UK_GLYPHS_RE = /[іїєґІЇЄҐ]/g;
export const RU_GLYPHS_RE = /[ыэъёЫЭЪЁ]/g;
export const SR_GLYPHS_RE = /[ђјљњћџЂЈЉЊЋЏ]/g;
/** `ъ` між малими літерами — характерна болгарська риса (в рос. ъ лише розділовий). */
export const BG_HINT_RE = /\p{Ll}ъ\p{Ll}/gu;

export const countMatches = (s: string, re: RegExp) => (s.match(re) ?? []).length;

/** Текст сторінки без тегів — для мовного аналізу. */
export function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/\s+/g, ' ')
    .trim();
}

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

export function safeUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  try {
    const u = new URL(raw.startsWith('http') ? raw : `https://${raw}`);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return u.toString();
  } catch {
    return null;
  }
}

export const chunk = <T>(arr: T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
};

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
