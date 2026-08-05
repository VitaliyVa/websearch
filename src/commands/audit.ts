import pLimit from 'p-limit';
import { loadPreset } from '../config.js';
import {
  getAudit, getPlaces, getReviewSignal, saveAudit, saveOwnerScore, setBucket, setStage,
} from '../db/index.js';
import { auditSite } from '../audit/site.js';
import { nameSignal, typeSignal } from '../detect/name-signal.js';
import { estimateHours } from '../score/hours.js';
import { scoreOwner } from '../score/owner.js';
import { scoreSite } from '../score/quality.js';
import type { LangSignal, ReviewSignal, SiteAudit } from '../types.js';
import { log, progress } from '../util/log.js';
import { hostOf } from '../util/text.js';

export interface AuditOpts {
  preset: string;
  limit: number | null;
  force: boolean;
}

/**
 * Максимум від мовного сигналу з відгуків (55 за одностайність + 15 за свіжість).
 * Використовується як ворота: немає сенсу платити за Place Details, якщо навіть
 * ідеальний результат не дотягне місце до порогу.
 */
const MAX_REVIEW_BOOST = 70;

export async function audit(opts: AuditOpts) {
  const preset = loadPreset(opts.preset);

  // --force свідомо включає і вже відсіяні: коли змінюються правила вердикту,
  // треба дати їм другий шанс, інакше зміна порогів нічого не міняє для тих,
  // кого стара логіка вже викинула.
  const where = opts.force
    ? 'WHERE website IS NOT NULL'
    : "WHERE bucket IN ('pending','manual') AND website IS NOT NULL AND stage = 'discovered'";

  let places = getPlaces(where);
  if (opts.limit) places = places.slice(0, opts.limit);

  log.step(`L2 Site audit — ${places.length} сайтів`);
  if (!places.length) {
    log.info('нема чого аудитити. Спершу `npm run discover`.');
    return;
  }

  const limit = pLimit(Math.max(1, Math.min(16, preset.audit.perHostDelayMs ? 8 : 8)));
  let done = 0;
  const stats = { leads: 0, needReviews: 0, rejected: 0, dead: 0 };

  await Promise.all(
    places.map((place) =>
      limit(async () => {
        try {
          const outcome = await auditSite(place.website!, {
            fetchTimeoutMs: preset.audit.fetchTimeoutMs,
            maxHtmlBytes: preset.audit.maxHtmlBytes,
            perHostDelayMs: preset.audit.perHostDelayMs,
            enableLangProbe: preset.audit.enableLangProbe,
            enableAcceptLanguageProbe: preset.audit.enableAcceptLanguageProbe,
            enablePlaywrightFallback: preset.audit.enablePlaywrightFallback,
            cacheKey: place.place_id,
          });

          const quality = scoreSite(outcome.audit, null, true);
          const hours = estimateHours(outcome.audit.fetchError ? null : outcome.audit);
          const versionEvidence = [
            ...outcome.declaredEvidence,
            ...outcome.probeEvidence,
            ...outcome.acceptLangEvidence,
          ];
          saveAudit(
            place.place_id, outcome.audit, outcome.lang,
            quality.score10, quality.reasons, hours, versionEvidence,
          );
          setStage(place.place_id, 'audited');

          if (quality.status === 'dead') stats.dead++;

          const verdict = decide({
            place: {
              placeId: place.place_id, name: place.name, website: place.website!,
              typesJson: place.types_json, userRatingCount: place.user_rating_count,
              manualVerdict: place.manual_verdict, manualVerdictReason: place.manual_verdict_reason,
              primaryType: place.primary_type,
            },
            audit: outcome.audit,
            lang: outcome.lang,
            versionEvidence,
            siteScore10: quality.score10,
            siteStatus: quality.status,
            datedMarkers: quality.datedMarkers,
            psiDone: false,
            reviews: getReviewSignal(place.place_id)
              ? toReviewSignal(getReviewSignal(place.place_id)!)
              : null,
            preset,
          });

          if (verdict.bucket === 'leads') stats.leads++;
          else if (verdict.bucket === 'pending') stats.needReviews++;
          else stats.rejected++;
        } catch (e) {
          log.err(`${place.name}: ${e instanceof Error ? e.message : e}`);
          setStage(place.place_id, 'audited');
        } finally {
          progress('audit', ++done, places.length);
        }
      }),
    ),
  );

  console.log('');
  log.ok(`готово. Одразу в Leads: ${stats.leads}, потребують перевірки відгуків: ${stats.needReviews}`);
  log.dim(`відсіяно: ${stats.rejected}, мертвих сайтів (топ-ліди): ${stats.dead}`);
  if (stats.needReviews) log.dim(`далі: npm run reviews — витратить ~${stats.needReviews} викликів Place Details`);
}

const safeTypes = (json: string | null | undefined): string[] => {
  if (!json) return [];
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
};

export interface DecideInput {
  place: {
    placeId: string;
    name: string;
    website: string;
    typesJson?: string | null;
    /** primary_type від Google — містить етнічну мітку закладу */
    primaryType?: string | null;
    /** Потрібен, щоб переоцінка не воскрешала бізнеси, відсіяні за живістю */
    userRatingCount?: number | null;
    /** Вердикт людини. Якщо заданий — автоматика мовчить. */
    manualVerdict?: string | null;
    manualVerdictReason?: string | null;
  };
  audit: SiteAudit | null;
  lang: LangSignal | null;
  /** hreflang + пробінг + Accept-Language разом; персистяться в site_audits */
  versionEvidence: import('../types.js').Evidence[];
  siteScore10: number;
  /**
   * Вердикт про читабельність сайту з scoreSite.
   *
   * `blocked` означає, що сторінку віддав bot-protection, а не власник: або
   * статусом 403/429, або заглушкою на 168 байт з HTTP 202. Ми такий сайт НЕ
   * бачили, тож судити про нього не можна — ні хвалити, ні лаяти.
   */
  siteStatus?: 'ok' | 'dead' | 'blocked' | 'no_site';
  /** Ознаки застарілості, незалежні від швидкості. Наявність рятує лід від відсіву за балом. */
  datedMarkers?: string[];
  /** Чи вже заміряний PSI — від цього залежить, наскільки строгий поріг сайту */
  psiDone: boolean;
  reviews: ReviewSignal | null;
  preset: ReturnType<typeof loadPreset>;
}

/**
 * Рішення після аудиту сайту.
 *
 * Ключова економія квоти: якщо сайтових сигналів уже вистачає на поріг Leads —
 * відгуки НЕ запитуємо взагалі. Place Details з reviews коштує Enterprise-квоту
 * (1000/міс безкоштовно), і саме тут вона зберігається для тих, кому справді
 * потрібна — асимільованого бізнесу з англомовним сайтом.
 */
export function decide(i: DecideInput) {
  /*
   * Вердикт людини — понад усе.
   *
   * Автоматика не знає того, що знає людина: що Joong Boo Market корейський,
   * а робоча версія `?lang=ru` означає лише обслуговування російськомовних.
   * Раніше цієї перевірки не було, і `rescore` скасував 26 із 28 рішень
   * ручного розбору — сама процедура перегляду ставала безглуздою.
   *
   * Знімається через clearManualVerdict().
   */
  if (i.place.manualVerdict) {
    return { bucket: i.place.manualVerdict as 'leads', owner: null };
  }

  /*
   * Виключення за типом закладу перевіряємо ТУТ, а не лише в cheapFilter.
   *
   * Інакше будь-який шлях, що кличе decide() навпростець (rescore, reviews),
   * обходить фільтр і воскрешає відсіяне. Саме так церкви й консульство
   * України повернулись у ліди після переоцінки.
   */
  const types = safeTypes(i.place.typesJson);
  const excludedType = types.find((t) => i.preset.filters.excludeTypes.includes(t));
  if (excludedType) {
    setBucket(i.place.placeId, 'rejected', `некомерційний заклад (${excludedType})`);
    return { bucket: 'rejected' as const, owner: null };
  }

  /*
   * Поріг живості теж перевіряємо ТУТ, а не лише в cheapFilter.
   *
   * Той самий недогляд, що колись повернув церкви в Ліди: cheapFilter працює
   * при вставці, а rescore/reviews/enrich кличуть decide() навпростець і
   * воскрешають відсіяне. Так у Лідах опинились «Ukraine-Moldova American
   * Enterprise Fund» (1 відгук) і «U.S.-Ukraine Business Council» (3) —
   * некомерційні організації, яких не ловить excludeTypes, бо в Google вони
   * позначені як звичайні компанії. Саме поріг відгуків їх і відсіює.
   */
  const ratings = i.place.userRatingCount ?? 0;
  if (i.place.userRatingCount != null && ratings < i.preset.filters.minUserRatingCount) {
    setBucket(
      i.place.placeId,
      'rejected',
      `мало відгуків (${ratings} < ${i.preset.filters.minUserRatingCount})`,
    );
    return { bucket: 'rejected' as const, owner: null };
  }

  /*
   * Назва і тип від Google — незалежні сигнали, тож складаємо.
   *
   * «Veselka» словнику нічого не каже, але Google позначає її
   * `ukrainian_restaurant`. І навпаки: «Beryozka European Market» упізнається
   * за назвою, хоча тип у неї звичайний `grocery_store`.
   */
  const nmName = nameSignal(i.place.name, hostOf(i.place.website));
  const nmType = typeSignal(i.place.primaryType);
  const nm = nmName.exclusion
    ? nmName
    : {
        score: Math.min(40, nmName.score + nmType.score),
        evidence: [...nmName.evidence, ...nmType.evidence],
        exclusion: null,
      };

  const owner = scoreOwner({
    site: i.lang,
    reviews: i.reviews,
    name: nm,
    declaredEvidence: i.versionEvidence,
    thresholds: {
      lead: i.preset.thresholds.ownerScoreLead,
      manual: i.preset.thresholds.ownerScoreManual,
    },
  });

  saveOwnerScore(i.place.placeId, owner.score, owner.lang, owner.evidence);

  // ── жорсткі відсіви
  if (owner.exclusion) {
    setBucket(i.place.placeId, 'rejected', `виключення: ${owner.exclusion}`);
    return { bucket: 'rejected' as const, owner };
  }
  // Сайт, який ми не прочитали (bot-protection, таймаут, DNS), не можна судити
  // за мовними сигналами з сайту — їх просто нема. Такий лід іде на ручну
  // перевірку, а не у відсів: заблокований сайт часто і є найкращий лід.
  /*
   * `blocked` теж вважається нечитабельним.
   *
   * Раніше сюди потрапляв лише fetchError, і заглушка bot-protection з HTTP 202
   * проходила як звичайна сторінка: Moskalenko Group і Odessa Insurance лежали
   * в Лідах з оцінкою 1/10 та причинами «не адаптивний», хоча ми бачили тільки
   * JS-челендж. Продажник пішов би в дзвінок із твердженнями про сайт, якого
   * ніхто не відкривав.
   */
  const unreadable = !i.audit || !!i.audit.fetchError || i.siteStatus === 'blocked';

  /*
   * Заблокований сайт — на ручну перевірку, а не в Ліди.
   *
   * Нечитабельність буває двох різних сортів, і плутати їх дорого.
   * `fetchError` означає, що сайт справді не відкривається — це чудовий лід,
   * і він законно лишається в Лідах. `blocked` означає лише, що нас не
   * пустили: за челенджем може стояти свіжий сайт на React, і оффер «зробимо
   * вам сайт» прозвучить безглуздо.
   *
   * Мовний сигнал тут ні до чого — він рахується з назви й відгуків, а не з
   * недоступної сторінки, тому сильний скор не робить такий лід готовим.
   */
  if (i.siteStatus === 'blocked' && owner.score >= i.preset.thresholds.ownerScoreManual) {
    setBucket(
      i.place.placeId,
      'manual',
      'сайт закритий bot-protection — що там насправді, видно лише очима',
    );
    return { bucket: 'manual' as const, owner };
  }

  if (!unreadable) {
    if (i.preset.filters.modernStackIsRejection && i.audit?.modernFramework) {
      setBucket(i.place.placeId, 'rejected', `сучасний стек (${i.audit.modernFramework})`);
      return { bucket: 'rejected' as const, owner };
    }
    /*
     * Маркер застарілості РЯТУЄ лід від відсіву за балом.
     *
     * Швидкість — асиметричний доказ. Примітивна сторінка 2012 року без
     * зображень вантажиться за 0.4 с, отримує PSI 95 і за самим лише балом
     * виглядає «сучасною». Але якщо на ній верстка таблицями, немає viewport
     * або копірайт 2018 — це саме той сайт, який треба продавати заново.
     *
     * Тому відсіваємо за балом лише ті сайти, у яких НЕ знайдено жодної
     * ознаки застарілості.
     */
    if (i.datedMarkers?.length) {
      // сайт застарілий за структурою — ні бал, ні швидкість не мають права його викинути
    } else if (
      i.psiDone &&
      i.siteScore10 > i.preset.thresholds.siteScoreMaxForLead &&
      owner.score >= i.preset.thresholds.ownerScoreLead
    ) {
      /*
       * Не ВІДСІВАЄМО, а віддаємо людині.
       *
       * Візуальну застарілість із HTML не визначити: сайт може мати viewport,
       * HTTPS і свіжий копірайт, але виглядати як 2015 рік. Автоматично
       * викидати такий лід — означає втрачати мовно підтверджений бізнес через
       * ознаку, якої ми не вміємо міряти.
       *
       * Продажник має скріншот і оцінку швидкості — йому вирішувати за 5 секунд.
       */
      /*
       * Не «ручна перевірка», а окрема вкладка «Свої з сайтом».
       *
       * Раніше такі бізнеси губились у черзі на тисячі записів або взагалі
       * відсіювались як «сайт сучасний». Але це не сміття: власник свій,
       * бізнес живий, сайт просто не потребує заміни. Йому можна продати
       * SEO, рекламу, підтримку чи доробки — інший оффер, той самий клієнт.
       */
      setBucket(
        i.place.placeId,
        'upsell',
        `мова підтверджена (скор ${owner.score}), але сайт ${i.siteScore10}/10 — переробляти нема чого, заходити з інших послуг`,
      );
      return { bucket: 'upsell' as const, owner };
    }

  }

  // ── мовний вердикт
  if (owner.score >= i.preset.thresholds.ownerScoreLead) {
    setBucket(i.place.placeId, 'leads', null);
    return { bucket: 'leads' as const, owner };
  }

  // Відгуки ще не перевіряли і вони теоретично можуть витягнути — лишаємо в черзі.
  // Для нечитабельних сайтів це єдиний доступний сигнал, тому черга обов'язкова.
  if (!i.reviews && (unreadable || owner.score + MAX_REVIEW_BOOST >= i.preset.thresholds.ownerScoreManual)) {
    setBucket(i.place.placeId, 'pending', null);
    return { bucket: 'pending' as const, owner };
  }

  if (owner.score >= i.preset.thresholds.ownerScoreManual) {
    setBucket(i.place.placeId, 'manual', null);
    return { bucket: 'manual' as const, owner };
  }

  if (unreadable) {
    setBucket(i.place.placeId, 'manual', `сайт не прочитано (${i.audit?.fetchError ?? 'no response'})`);
    return { bucket: 'manual' as const, owner };
  }

  setBucket(i.place.placeId, 'rejected', `слабкий мовний сигнал (${owner.score})`);
  return { bucket: 'rejected' as const, owner };
}

export function toReviewSignal(r: NonNullable<ReturnType<typeof getReviewSignal>>): ReviewSignal {
  return {
    score: r.score,
    ratio: r.ratio,
    sampleSize: r.sample_size,
    preferredLang: (r.preferred_lang as 'uk' | 'ru' | null) ?? null,
    recentSlavic: r.recent_slavic,
    authorSlavicRatio: r.author_slavic_ratio,
    authorCyrillicCount: r.author_cyrillic ?? 0,
    evidence: r.evidence_json ? JSON.parse(r.evidence_json) : [],
  };
}

export { getAudit };
