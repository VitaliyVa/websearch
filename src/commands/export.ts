import { loadNiches, loadPreset, requireEnv } from '../config.js';
import {
  allSheetRows, allUsage, countPlaces, getAudit, getOwnerScore, getPlaces, getPsi,
  getReviewSignal, getScreenshots, saveSheetRow, setStage, type PlaceRow,
} from '../db/index.js';
import { cityOf, stateOf } from '../filters/address.js';
import { mapsUrl } from '../sources/places.js';
import { formatEvidence } from '../score/owner.js';
import { difficultyFromHours, formatStars } from '../score/difficulty.js';
import { buildBrief } from '../score/brief.js';
import { typeLabelUk } from '../export/type-labels.js';
import { scoreSite } from '../score/quality.js';
import type { Evidence, PsiResult, SiteAudit } from '../types.js';
import { log } from '../util/log.js';
import {
  clearStaleRows,
  collectHumanNotes,
  openDoc,
  reconcileTab,
  restoreHumanNotes,
  syncTab,
  writeMeta,
  type HumanNotes,
  type SheetRow,
} from '../export/sheets.js';
import { TABS, type TabKey } from '../export/columns.js';

export interface ExportOpts {
  preset: string;
  includeRejected: boolean;
}

export async function exportSheets(opts: ExportOpts) {
  const preset = loadPreset(opts.preset);
  requireEnv(['saEmail', 'saPrivateKey', 'sheetId'], 'export');

  log.step('L5 Export → Google Sheets');

  const buckets: { key: TabKey; where: string }[] = [
    { key: 'leads', where: "WHERE bucket = 'leads'" },
    { key: 'manual', where: "WHERE bucket IN ('manual','pending')" },
    { key: 'noSite', where: "WHERE bucket = 'no_site'" },
  ];
  if (opts.includeRejected) buckets.push({ key: 'rejected', where: "WHERE bucket = 'rejected'" });

  const doc = await openDoc();
  log.dim(`таблиця: "${doc.title}"`);

  const totals: Record<string, number> = {};

  // Спершу збираємо, хто де МАЄ бути зараз
  const target = new Map<string, { key: TabKey; places: PlaceRow[] }>();
  for (const b of buckets) {
    const places = getPlaces(
      `${b.where} ORDER BY
        COALESCE((SELECT site_score FROM site_audits sa WHERE sa.place_id = places.place_id), 5) ASC,
        COALESCE(user_rating_count, 0) DESC`,
    );
    target.set(TABS[b.key], { key: b.key, places });
  }

  const placeTab = new Map<string, string>();
  for (const [tabName, t] of target) {
    for (const p of t.places) placeTab.set(p.place_id, tabName);
  }

  /*
   * Нотатки продажників зчитуємо ПЕРЕД будь-якими змінами.
   *
   * Лід може переїхати між вкладками після переоцінки, і без цього кроку його
   * статус та коментар лишились би на старому місці, а нова картка з'явилась би
   * порожньою — тобто робота продажника губилась би при кожному прогоні.
   */
  const humanNotes = await collectHumanNotes(doc);
  log.dim(`нотаток продажників знайдено: ${humanNotes.size}`);

  /*
   * Повністю очищаємо рядки, що покинули вкладку — разом із place_id.
   *
   * Раніше ключ лишався, і панель показувала «привидів»: вона виводить кожен
   * рядок із заповненим place_id, тож продажник бачив десятки карток
   * «більше не лід» замість реальних лідів.
   */
  const staleByTab = new Map<TabKey, number[]>();
  for (const row of allSheetRows()) {
    const nowIn = placeTab.get(row.place_id);
    if (nowIn === row.tab) continue;

    const key = (Object.keys(TABS) as TabKey[]).find((k) => TABS[k] === row.tab);
    if (!key) continue;

    const list = staleByTab.get(key) ?? [];
    list.push(row.row_index);
    staleByTab.set(key, list);
  }

  for (const [key, stale] of staleByTab) {
    const n = await clearStaleRows(doc, key, stale);
    if (n) log.dim(`${TABS[key]}: очищено ${n} рядків, що переїхали в іншу вкладку`);
  }

  /*
   * Повне звірення кожної вкладки з фактом.
   *
   * Крок вище спирається на sheet_rows, а вона знає лише про поточне
   * розташування ліда. Осиротілі рядки з минулих прогонів там не значаться,
   * тому потрібен окремий прохід по реальному вмісту аркуша.
   */
  for (const [tabName, t] of target) {
    const expected = new Set(t.places.map((p) => p.place_id));
    const n = await reconcileTab(doc, t.key, expected);
    if (n) log.warn(`${tabName}: прибрано ${n} застарілих рядків`);
  }

  // ── Синхронізація
  for (const [tabName, t] of target) {
    if (!t.places.length) {
      log.dim(`${tabName}: порожньо`);
      continue;
    }

    const rows = t.places.map(buildRow);
    const res = await syncTab(doc, t.key, rows);
    totals[tabName] = t.places.length;
    log.ok(`${res.tab}: +${res.inserted} нових, ${res.updated} оновлено`);

    // Повертаємо нотатки тим, хто переїхав сюди з іншої вкладки
    const toRestore: { rowIndex: number; notes: HumanNotes }[] = [];
    for (const p of t.places) {
      const idx = res.rows.get(p.place_id);
      if (idx === undefined) continue;
      saveSheetRow(p.place_id, tabName, idx);
      setStage(p.place_id, 'exported');

      const notes = humanNotes.get(p.place_id);
      if (notes) toRestore.push({ rowIndex: idx, notes });
    }

    const restored = await restoreHumanNotes(doc, t.key, toRestore);
    if (restored) log.dim(`${tabName}: збережено нотатки для ${restored} лідів`);
  }

  const usage = allUsage();
  await writeMeta(doc, [
    ['Останній прогін', new Date().toLocaleString('uk-UA')],
    ['Пресет', preset.name],
    ['Метро', preset.metros.join(', ')],
    ['—', '—'],
    ['Місць у базі всього', countPlaces()],
    ['Leads', countPlaces("WHERE bucket = 'leads'")],
    ['Manual review', countPlaces("WHERE bucket IN ('manual','pending')")],
    ['NO_SITE', countPlaces("WHERE bucket = 'no_site'")],
    ['Rejected', countPlaces("WHERE bucket = 'rejected'")],
    ['—', '—'],
    ['Поріг мовного скору (Leads)', preset.thresholds.ownerScoreLead],
    ['Поріг мовного скору (Manual)', preset.thresholds.ownerScoreManual],
    ['Макс. оцінка сайту для ліда', preset.thresholds.siteScoreMaxForLead],
    ['Мін. кількість відгуків', preset.filters.minUserRatingCount],
    ['—', '—'],
    ...usage.map((u) => [`API ${u.api} (${u.month})`, u.count] as [string, number]),
  ]);

  log.ok(`експортовано: ${Object.entries(totals).map(([k, v]) => `${k}=${v}`).join(', ')}`);
  log.dim('Колонки X..AA (Статус / Хто веде / Дата / Коментар) скрипт не чіпає — це поле продажників.');
}

const nicheLabels = (() => {
  const map = new Map<string, string>();
  for (const n of loadNiches().niches) map.set(n.key, n.label);
  return map;
})();

function buildRow(p: PlaceRow): SheetRow {
  const auditRow = getAudit(p.place_id);
  const a: SiteAudit | null = auditRow ? JSON.parse(auditRow.audit_json) : null;
  const owner = getOwnerScore(p.place_id);
  const rev = getReviewSignal(p.place_id);
  const psi = getPsi(p.place_id);
  const shots = getScreenshots(p.place_id);

  const evidence: Evidence[] = owner ? JSON.parse(owner.evidence_json) : [];
  const revEvidence: Evidence[] = rev?.evidence_json ? JSON.parse(rev.evidence_json) : [];

  const langLabel =
    owner?.lang === 'uk' ? 'українська'
    : owner?.lang === 'ru' ? 'російська'
    : owner?.lang === 'cyr' ? 'кирилиця (не визначено)'
    : rev?.preferred_lang === 'uk' ? 'українська'
    : rev?.preferred_lang === 'ru' ? 'російська'
    : '—';

  /*
   * Складність у зірках замість годин.
   *
   * Години лишаються в БД для внутрішнього планування, але продажнику вони
   * шкодили: «22-33 год» у розмові миттєво перетворюється на ціну, якої ще
   * ніхто не рахував, і зводить розмову до трудовитрат замість цінності.
   */
  const diff = difficultyFromHours(auditRow?.hours_min ?? null, auditRow?.hours_max ?? null);
  const difficultyCell = diff ? `${formatStars(diff)} ${diff.label}` : '—';

  const psiCell =
    psi && (psi.mobile_score != null || psi.desktop_score != null)
      ? `${psi.mobile_score ?? '?'} / ${psi.desktop_score ?? '?'}`
      : p.website
        ? 'не заміряно'
        : '—';

  const adaptive = !a ? '—' : a.fetchError ? 'сайт не відкрився' : a.hasViewportMeta ? 'так' : 'НІ';
  const https = !a ? '—' : a.fetchError ? '—' : a.https ? 'так' : 'НІ';

  const techCell = a
    ? [a.builder, a.cms, ...a.techStack].filter(Boolean).filter((v, i, arr) => arr.indexOf(v) === i).join(', ')
    : p.website ? 'не вдалось прочитати' : '—';

  const socials = a ? Object.values(a.socials).join(' ') : '';
  const email = a?.emails?.[0] ?? '';

  /*
   * Місто беремо з АДРЕСИ, а не з metro_key.
   * locationBias у Places — м'яка підказка: запит з біасом на Чикаго спокійно
   * повертає бізнес із Каліфорнії. metro_key показує, ЯКИЙ запит його знайшов,
   * а не де він насправді. Продажнику потрібне друге.
   */
  const city = cityOf(p.address);
  const state = stateOf(p.address);
  const realLocation = [city, state].filter(Boolean).join(', ');
  const foundVia = p.hood_name ?? p.metro_key;
  // Якщо знайдений район не збігається з реальним містом — показуємо обидва
  const location =
    realLocation && foundVia && city && !foundVia.toLowerCase().includes(city.toLowerCase())
      ? `${realLocation}  (знайдено через ${foundVia})`
      : realLocation || foundVia || '—';

  /*
   * Бриф для продажника.
   *
   * Маркери застарілості беремо з перерахунку, а не з БД: зберігається лише
   * підсумковий бал і причини, а маркери — окрема, незалежна від швидкості
   * ознака. scoreSite чиста, тож перерахунок нічого не коштує.
   */
  const psiTyped: PsiResult | null = psi
    ? {
        mobileScore: psi.mobile_score,
        desktopScore: psi.desktop_score,
        lcpMs: psi.lcp_ms,
        cls: psi.cls,
        fetchedAt: psi.fetched_at,
      }
    : null;

  const quality = scoreSite(a, psiTyped, !!p.website);

  const brief = buildBrief({
    name: p.name,
    typeLabel: p.primary_type_label ?? nicheLabels.get(p.niche_key ?? '') ?? p.primary_type ?? '',
    location,
    rating: p.rating ?? null,
    reviews: p.user_rating_count ?? null,
    website: p.website ?? null,
    audit: a,
    psi: psiTyped,
    langLabel,
    datedMarkers: quality.datedMarkers,
    difficultyLabel: diff?.label ?? null,
    siteStatus: quality.status,
  });

  const screenshotCell = p.website
    // Sheets API приймає формули в US-локалі — розділювач аргументів кома, не крапка з комою
    ? `=HYPERLINK("https://pagespeed.web.dev/analysis?url=${encodeURIComponent(p.website)}","${
        shots?.mobile_path ? 'PSI звіт + скрін' : 'PSI звіт'
      }")`
    : '—';

  return [
    p.place_id,                                              // A
    p.name,                                                  // B
    typeLabelUk(p.primary_type_label) || nicheLabels.get(p.niche_key ?? '') || p.primary_type || '—', // C
    p.tier ?? '—',                                           // D
    location || '—',                                         // E
    p.website ?? '—',                                        // F
    mapsUrl(p.place_id),                                     // G
    p.phone ?? '—',                                          // H
    email || '—',                                            // I
    socials || '—',                                          // J
    auditRow?.site_score ?? (p.website ? '' : 1),            // K
    auditRow?.site_reasons ?? (p.website ? '' : 'сайту нема взагалі'), // L
    difficultyCell,                                          // M
    owner?.score ?? '',                                      // N
    langLabel,                                               // O
    formatEvidence([...evidence, ...revEvidence]) || '—',    // P
    techCell || '—',                                         // Q
    psiCell,                                                 // R
    adaptive,                                                // S
    https,                                                   // T
    p.rating != null ? `${p.rating} / ${p.user_rating_count ?? 0}` : `— / ${p.user_rating_count ?? 0}`, // U
    screenshotCell,                                          // V
    brief,                                                   // W
  ];
}

export { saveSheetRow };
