import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { paths } from '../config.js';

let unavailable = false;
let warned = false;

export interface ShotPaths {
  desktop: string | null;
  mobile: string | null;
}

/**
 * Скріншот 1440 (desktop) + 390 (mobile). Мобільний — головний аргумент
 * у продажу: продажник показує клієнту, як його сайт виглядає на телефоні.
 */
export async function captureScreenshots(url: string, placeId: string): Promise<ShotPaths> {
  if (unavailable) return { desktop: null, mobile: null };

  const desktopPath = resolve(paths.screenshots, `${placeId}-desktop.jpg`);
  const mobilePath = resolve(paths.screenshots, `${placeId}-mobile.jpg`);

  // Ідемпотентність: не перезнімаємо те, що вже є
  if (existsSync(desktopPath) && existsSync(mobilePath)) {
    return { desktop: desktopPath, mobile: mobilePath };
  }

  try {
    const { chromium } = await import('playwright');
    const browser = await chromium.launch({ headless: true });
    try {
      const ctx = await browser.newContext({
        userAgent:
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      });
      const page = await ctx.newPage();

      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20_000 }).catch(() => undefined);
      await page.waitForTimeout(2000);
      await page.screenshot({ path: desktopPath, type: 'jpeg', quality: 72 }).catch(() => undefined);

      // Мобільний вигляд — саме те, що ламається у старих сайтів
      await page.setViewportSize({ width: 390, height: 844 });
      await page.waitForTimeout(1200);
      await page.screenshot({ path: mobilePath, type: 'jpeg', quality: 72 }).catch(() => undefined);

      await ctx.close();
    } finally {
      await browser.close();
    }

    return {
      desktop: existsSync(desktopPath) ? desktopPath : null,
      mobile: existsSync(mobilePath) ? mobilePath : null,
    };
  } catch (e) {
    unavailable = true;
    if (!warned) {
      warned = true;
      console.log(
        `  ! Скріншоти вимкнено: playwright недоступний (${e instanceof Error ? e.message.split('\n')[0] : e}).\n` +
          `    Встанови: npm i playwright && npx playwright install chromium`,
      );
    }
    return { desktop: null, mobile: null };
  }
}

/** Горизонтальний скрол на 390px — прямий доказ «не адаптивний». */
export async function checkMobileOverflow(url: string): Promise<boolean | null> {
  if (unavailable) return null;
  try {
    const { chromium } = await import('playwright');
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20_000 });
      await page.waitForTimeout(1200);
      // Вираз рядком, а не колбеком: колбек виконується в браузері й вимагав би
      // DOM-типів у tsconfig, які тут зайві (це Node-проєкт).
      return (await page.evaluate<boolean>(
        'document.documentElement.scrollWidth > document.documentElement.clientWidth + 8',
      )) as boolean;
    } finally {
      await browser.close();
    }
  } catch {
    return null;
  }
}
