import { env } from '../config.js';
import { bumpUsage } from '../db/index.js';
import { charge } from '../quota.js';
import type { PsiResult } from '../types.js';
import { sleep } from '../util/text.js';

const ENDPOINT = 'https://www.googleapis.com/pagespeedonline/v5/runPagespeed';

/**
 * PSI: 25 000 запитів/добу безкоштовно, але є прихований per-origin rate limit —
 * при швидкому темпі сипле 429/500 навіть у межах денної квоти. Тому послідовно,
 * з паузою і одним ретраєм.
 */
export async function runPsi(url: string): Promise<PsiResult> {
  const mobile = await one(url, 'mobile');
  await sleep(600);
  const desktop = await one(url, 'desktop');

  return {
    mobileScore: mobile?.score ?? null,
    desktopScore: desktop?.score ?? null,
    lcpMs: mobile?.lcpMs ?? desktop?.lcpMs ?? null,
    cls: mobile?.cls ?? desktop?.cls ?? null,
    fetchedAt: new Date().toISOString(),
  };
}

interface Strategy {
  score: number | null;
  lcpMs: number | null;
  cls: number | null;
}

async function one(url: string, strategy: 'mobile' | 'desktop', retry = 1): Promise<Strategy | null> {
  const qs = new URLSearchParams({
    url,
    strategy,
    category: 'performance',
  });
  if (env.psiKey) qs.set('key', env.psiKey);

  try {
    const res = await fetch(`${ENDPOINT}?${qs}`, { signal: AbortSignal.timeout(75_000) });
    bumpUsage('psi');
    charge('psi'); // PSI безкоштовний (25k/добу), рахуємо лише для видимості

    if (!res.ok) {
      if ((res.status === 429 || res.status >= 500) && retry > 0) {
        await sleep(4000);
        return one(url, strategy, retry - 1);
      }
      return null;
    }

    const json = (await res.json()) as {
      lighthouseResult?: {
        categories?: { performance?: { score?: number } };
        audits?: Record<string, { numericValue?: number }>;
      };
    };

    const lr = json.lighthouseResult;
    const score = lr?.categories?.performance?.score;
    return {
      score: typeof score === 'number' ? Math.round(score * 100) : null,
      lcpMs: lr?.audits?.['largest-contentful-paint']?.numericValue ?? null,
      cls: lr?.audits?.['cumulative-layout-shift']?.numericValue ?? null,
    };
  } catch {
    if (retry > 0) {
      await sleep(3000);
      return one(url, strategy, retry - 1);
    }
    return null;
  }
}
