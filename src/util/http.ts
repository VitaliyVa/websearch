import { env } from '../config.js';
import { hostOf, sleep } from './text.js';

const UA =
  `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) ` +
  `Chrome/131.0.0.0 Safari/537.36 (+leadbot; ${env.crawlerContact})`;

export interface FetchResult {
  ok: boolean;
  status: number | null;
  finalUrl: string | null;
  body: string;
  headers: Record<string, string>;
  error: string | null;
  bytes: number;
  redirectedToDifferentHost: boolean;
}

const EMPTY: FetchResult = {
  ok: false, status: null, finalUrl: null, body: '', headers: {},
  error: 'not-attempted', bytes: 0, redirectedToDifferentHost: false,
};

/**
 * Ввічливість: один активний запит на хост + пауза між запитами до того ж хоста.
 * Без цього пробінг 5 неіснуючих шляхів підряд виглядає як сканер і ловить 403.
 */
const hostQueue = new Map<string, Promise<unknown>>();

function perHost<T>(host: string, fn: () => Promise<T>, delayMs: number): Promise<T> {
  const prev = hostQueue.get(host) ?? Promise.resolve();
  const next = prev.then(async () => {
    const result = await fn();
    await sleep(delayMs);
    return result;
  });

  const tail = next.catch(() => undefined);
  hostQueue.set(host, tail);

  /*
   * Прибираємо запис, коли черга по цьому хосту спорожніла.
   * Без цього Map росте на кожен унікальний хост і тримає ланцюжок промісів
   * із замиканнями живим до кінця процесу — на прогоні в 3500 сайтів це давало
   * стабільний ріст пам'яті (568 → 1149 МБ). Перевірка `=== tail` потрібна, щоб
   * не видалити запис, який уже перезаписав інший запит до того самого хоста.
   */
  void tail.then(() => {
    if (hostQueue.get(host) === tail) hostQueue.delete(host);
  });

  return next;
}

export interface FetchOpts {
  timeoutMs?: number;
  maxBytes?: number;
  acceptLanguage?: string;
  perHostDelayMs?: number;
  retries?: number;
}

export async function fetchPage(url: string, opts: FetchOpts = {}): Promise<FetchResult> {
  const {
    timeoutMs = 12_000,
    maxBytes = 1_500_000,
    acceptLanguage = 'en-US,en;q=0.9',
    perHostDelayMs = 300,
    retries = 1,
  } = opts;

  const host = hostOf(url);
  if (!host) return { ...EMPTY, error: 'bad-url' };

  return perHost(host, () => attempt(url, timeoutMs, maxBytes, acceptLanguage, retries), perHostDelayMs);
}

async function attempt(
  url: string,
  timeoutMs: number,
  maxBytes: number,
  acceptLanguage: string,
  retriesLeft: number,
): Promise<FetchResult> {
  const startHost = hostOf(url);
  try {
    const res = await fetch(url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        'User-Agent': UA,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': acceptLanguage,
        'Accept-Encoding': 'gzip, deflate, br',
        'Cache-Control': 'no-cache',
      },
    });

    const headers: Record<string, string> = {};
    res.headers.forEach((v, k) => (headers[k.toLowerCase()] = v));

    // Не тягнемо не-HTML (pdf, зображення) — тільки марна трата трафіку.
    const ctype = headers['content-type'] ?? '';
    if (ctype && !/text\/html|application\/xhtml|text\/xml|application\/xml|text\/plain/i.test(ctype)) {
      return {
        ok: false, status: res.status, finalUrl: res.url, body: '', headers,
        error: `non-html:${ctype.split(';')[0]}`, bytes: 0,
        redirectedToDifferentHost: hostOf(res.url) !== startHost,
      };
    }

    const body = await readCapped(res, maxBytes);

    return {
      ok: res.ok,
      status: res.status,
      finalUrl: res.url,
      body,
      headers,
      error: res.ok ? null : `http-${res.status}`,
      bytes: body.length,
      redirectedToDifferentHost: hostOf(res.url) !== startHost,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.name === 'TimeoutError' ? 'timeout' : e.message : String(e);
    // Повторюємо тільки мережеві збої, не 4xx/5xx.
    if (retriesLeft > 0 && /timeout|ECONNRESET|ENOTFOUND|EAI_AGAIN|socket|fetch failed/i.test(msg)) {
      await sleep(800);
      return attempt(url, timeoutMs, maxBytes, acceptLanguage, retriesLeft - 1);
    }
    return { ...EMPTY, error: msg, finalUrl: url };
  }
}

/** Читає тіло з жорстким лімітом байтів — захист від 200МБ-сторінок. */
async function readCapped(res: Response, maxBytes: number): Promise<string> {
  if (!res.body) return '';
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      chunks.push(value);
      total += value.byteLength;
      if (total >= maxBytes) {
        await reader.cancel().catch(() => undefined);
        break;
      }
    }
  } catch {
    /* обірваний стрім — повертаємо що встигли */
  }
  const buf = Buffer.concat(chunks.map((c) => Buffer.from(c)), Math.min(total, maxBytes));
  return decodeBody(buf);
}

/** Старі сайти часто у windows-1251 / koi8-r — інакше кирилиця перетвориться на кракозябри. */
function decodeBody(buf: Buffer): string {
  const head = buf.subarray(0, 2048).toString('latin1');
  const m =
    /charset\s*=\s*["']?\s*([\w-]+)/i.exec(head)?.[1]?.toLowerCase() ?? 'utf-8';

  const alias: Record<string, string> = {
    'utf-8': 'utf-8', utf8: 'utf-8',
    'windows-1251': 'win1251', cp1251: 'win1251', 'x-cp1251': 'win1251',
    'koi8-r': 'koi8-r', 'koi8-u': 'koi8-r',
    'iso-8859-5': 'iso-8859-5',
    'windows-1252': 'latin1', 'iso-8859-1': 'latin1', ascii: 'utf-8',
  };
  const enc = alias[m] ?? 'utf-8';

  try {
    if (enc === 'utf-8') return buf.toString('utf8');
    if (enc === 'latin1') return buf.toString('latin1');
    return new TextDecoder(enc === 'win1251' ? 'windows-1251' : enc).decode(buf);
  } catch {
    return buf.toString('utf8');
  }
}

/** Легкий GET для sitemap/robots — без per-host черги, бо це один запит. */
export async function fetchText(url: string, timeoutMs = 8000): Promise<string | null> {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: { 'User-Agent': UA },
      redirect: 'follow',
    });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.byteLength > 5_000_000) return null;
    return decodeBody(buf);
  } catch {
    return null;
  }
}
