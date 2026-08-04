import { parseArgs } from 'node:util';
import { audit } from './commands/audit.js';
import { discover } from './commands/discover.js';
import { doctor } from './commands/doctor.js';
import { enrich } from './commands/enrich.js';
import { exportSheets } from './commands/export.js';
import { inspect } from './commands/inspect.js';
import { quota } from './commands/quota.js';
import { refilter } from './commands/refilter.js';
import { rescore } from './commands/rescore.js';
import { reviews } from './commands/reviews.js';
import { run } from './commands/run.js';
import { stats } from './commands/stats.js';
import { log } from './util/log.js';

const HELP = `
  websearch — пайплайн лідів: діаспорні бізнеси США з укр/рос власниками і застарілими сайтами

  ВИКОРИСТАННЯ
    npm run lead -- <команда> [опції]

  КОМАНДИ
    discover     L0  пошук у Google Places за етнічними та гео-щільними запитами
    audit        L2  фетч сайтів, мовні сигнали, техстек, оцінка 1-10, години
    reviews      L3  мовний сигнал з Google-відгуків (лише для невизначених)
    enrich       L4  PageSpeed Insights + скріншоти
    export       L5  вивантаження в Google Sheets
    run              усе підряд: discover → audit → reviews → enrich → export
    stats            стан бази, розподіл скорів, витрати квоти
    inspect <url>    розібрати один сайт вручну (0 викликів Google, нічого не пише в базу)
    quota            скільки безкоштовних запитів лишилось і чи вміститься прогін
    doctor           перевірити ключі й доступи живими запитами
    refilter         перепрогнати дешеві фільтри по вже зібраній базі (0 викликів Google)
    rescore          переоцінити скоринг із кешу HTML (0 мережевих запитів)

  ОПЦІЇ
    --preset <name>   пресет з config/presets (за замовчуванням us-diaspora-pilot)
    --limit <n>       обмежити кількість елементів у стадії (для тестів)
    --dry-run         (discover) показати запити без викликів Google
    --allow-paid      дозволити вихід за безкоштовні ліміти Google.
                      Сам по собі НЕ діє — потрібна ще змінна ALLOW_PAID_SPEND=yes у .env.
                      Це навмисно: один випадковий прапорець не має коштувати грошей.
    --force           (audit) переаудитити навіть уже оброблені
    --with-rejected   (export) вивантажити ще й вкладку Rejected
    --skip-psi        (enrich) без PageSpeed — найповільніша стадія
    --skip-shots      (enrich) без скріншотів
    --include-manual  (enrich) охопити ще й вкладку Manual review, не лише Leads
    --skip-export     (run) не чіпати Google Sheets
    --help            ця довідка

  ТИПОВИЙ ПЕРШИЙ ЗАПУСК
    npm run lead -- discover --dry-run        # подивитись, які запити підуть
    npm run lead -- discover --limit 20       # обережний старт, 20 задач
    npm run lead -- audit
    npm run lead -- stats                     # подивитись розподіл ДО порогів
    npm run lead -- reviews
    npm run lead -- enrich
    npm run lead -- export
`;

async function main() {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    allowPositionals: true,
    strict: false,
    options: {
      preset: { type: 'string', default: 'us-diaspora-pilot' },
      name: { type: 'string' },
      limit: { type: 'string' },
      'dry-run': { type: 'boolean', default: false },
      'allow-paid': { type: 'boolean', default: false },
      force: { type: 'boolean', default: false },
      'with-rejected': { type: 'boolean', default: false },
      'skip-psi': { type: 'boolean', default: false },
      'skip-shots': { type: 'boolean', default: false },
      'include-manual': { type: 'boolean', default: false },
      'skip-export': { type: 'boolean', default: false },
      help: { type: 'boolean', default: false },
    },
  });

  const command = positionals[0];
  if (!command || values.help) {
    console.log(HELP);
    return;
  }

  const preset = String(values.preset ?? 'us-diaspora-pilot');
  const limit = values.limit ? Number(values.limit) : null;
  if (limit !== null && (!Number.isFinite(limit) || limit <= 0)) {
    throw new Error('--limit має бути додатним числом');
  }

  switch (command) {
    case 'discover':
      await discover({
        preset,
        dryRun: !!values['dry-run'],
        allowPaid: !!values['allow-paid'],
        limit,
      });
      break;

    case 'audit':
      await audit({ preset, limit, force: !!values.force });
      break;

    case 'reviews':
      await reviews({ preset, limit, allowPaid: !!values['allow-paid'] });
      break;

    case 'enrich':
      await enrich({
        preset,
        limit,
        skipPsi: !!values['skip-psi'],
        skipScreenshots: !!values['skip-shots'],
        includeManual: !!values['include-manual'],
      });
      break;

    case 'export':
      await exportSheets({ preset, includeRejected: !!values['with-rejected'] });
      break;

    case 'run':
      await run({
        preset,
        allowPaid: !!values['allow-paid'],
        skipExport: !!values['skip-export'],
        limit,
      });
      break;

    case 'stats':
      stats(preset);
      break;

    case 'doctor':
      await doctor();
      break;

    case 'refilter':
      refilter(preset, !!values.force);
      break;

    case 'rescore':
      rescore(preset, limit);
      break;

    case 'quota':
      quota(preset);
      break;

    case 'inspect': {
      const url = positionals[1];
      if (!url) throw new Error('вкажи URL: npm run lead -- inspect https://example.com [--name "Назва бізнесу"]');
      await inspect(url, String(values.name ?? ''), preset);
      break;
    }

    default:
      log.err(`невідома команда: ${command}`);
      console.log(HELP);
      process.exitCode = 1;
  }
}

main().catch((e) => {
  log.err(e instanceof Error ? e.message : String(e));
  if (process.env.DEBUG) console.error(e);
  process.exitCode = 1;
});
