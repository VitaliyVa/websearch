import { env } from '../config.js';
import { openDoc } from '../export/sheets.js';
import { log } from '../util/log.js';

type Check = { name: string; ok: boolean; detail: string };

/**
 * Перевіряє кожне з'єднання ЖИВИМ запитом, а не наявністю змінної в .env.
 * Порожній ключ і ключ без потрібного рестрикшена виглядають однаково,
 * поки не спробуєш ним скористатись.
 */
export async function doctor() {
  log.step('Перевірка налаштувань');
  const checks: Check[] = [];

  // ── .env
  const required = [
    ['GOOGLE_PLACES_KEY', env.placesKey],
    ['GOOGLE_PSI_KEY', env.psiKey],
    ['GOOGLE_SA_EMAIL', env.saEmail],
    ['GOOGLE_SA_PRIVATE_KEY', env.saPrivateKey],
    ['GOOGLE_SHEET_ID', env.sheetId],
  ] as const;

  for (const [name, value] of required) {
    checks.push({
      name: `.env ${name}`,
      ok: !!value,
      detail: value ? 'заповнено' : 'ПОРОЖНЄ',
    });
  }

  // ── Places API (New): один найдешевший запит
  if (env.placesKey) {
    try {
      const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': env.placesKey,
          'X-Goog-FieldMask': 'places.id',
        },
        body: JSON.stringify({ textQuery: 'coffee in Chicago', pageSize: 1 }),
        signal: AbortSignal.timeout(20_000),
      });
      const text = await res.text();
      checks.push({
        name: 'Places API (New)',
        ok: res.ok,
        detail: res.ok
          ? `HTTP 200, повернув ${(JSON.parse(text).places ?? []).length} результат`
          : `HTTP ${res.status}: ${extractMsg(text)}`,
      });
    } catch (e) {
      checks.push({ name: 'Places API (New)', ok: false, detail: msg(e) });
    }
  }

  // ── PageSpeed Insights
  if (env.psiKey) {
    try {
      const url = `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=https://example.com&strategy=mobile&category=performance&key=${env.psiKey}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(75_000) });
      const text = await res.text();
      checks.push({
        name: 'PageSpeed Insights',
        ok: res.ok,
        detail: res.ok ? 'HTTP 200' : `HTTP ${res.status}: ${extractMsg(text)}`,
      });
    } catch (e) {
      checks.push({ name: 'PageSpeed Insights', ok: false, detail: msg(e) });
    }
  }

  // ── Google Sheets: реальне відкриття документа
  if (env.saEmail && env.saPrivateKey && env.sheetId) {
    try {
      const doc = await openDoc();
      checks.push({
        name: 'Google Sheets',
        ok: true,
        detail: `відкрито "${doc.title}", вкладок: ${doc.sheetCount}`,
      });

      // Право на запис перевіряємо окремо — Viewer теж дає прочитати
      try {
        const title = doc.title;
        await doc.updateProperties({ title });
        checks.push({ name: 'Sheets — право запису', ok: true, detail: 'Editor підтверджено' });
      } catch (e) {
        checks.push({
          name: 'Sheets — право запису',
          ok: false,
          detail: `тільки читання. Розшар таблицю на ${env.saEmail} з правами Editor`,
        });
      }
    } catch (e) {
      const m = msg(e);
      checks.push({
        name: 'Google Sheets',
        ok: false,
        detail: /403|permission/i.test(m)
          ? `доступу нема. Розшар таблицю на ${env.saEmail} з правами Editor`
          : m,
      });
    }
  }

  console.log('');
  let failed = 0;
  for (const c of checks) {
    if (!c.ok) failed++;
    console.log(`  ${c.ok ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${c.name.padEnd(28)} ${c.detail}`);
  }
  console.log('');

  if (failed) {
    log.err(`${failed} перевірок не пройшло — виправ їх до першого прогону`);
    process.exitCode = 1;
  } else {
    log.ok('усе на місці. Можна запускати: npm run lead -- discover --limit 20');
  }
}

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

function extractMsg(body: string): string {
  try {
    const j = JSON.parse(body);
    return String(j?.error?.message ?? body).slice(0, 200);
  } catch {
    return body.slice(0, 200);
  }
}
