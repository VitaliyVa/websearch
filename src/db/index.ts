import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { paths } from '../config.js';
import type {
  Evidence,
  HoursEstimate,
  LangSignal,
  PsiResult,
  RawPlace,
  ReviewSignal,
  SearchTask,
  SiteAudit,
} from '../types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

let _db: DatabaseSync | null = null;

export function db(): DatabaseSync {
  if (_db) return _db;
  _db = new DatabaseSync(paths.db);
  _db.exec('PRAGMA journal_mode = WAL;');
  _db.exec('PRAGMA foreign_keys = ON;');
  _db.exec(readFileSync(resolve(__dirname, 'schema.sql'), 'utf8'));
  migrate(_db);
  return _db;
}

/** CREATE TABLE IF NOT EXISTS не додає колонки в уже створені таблиці. */
function migrate(d: DatabaseSync) {
  const columns = (table: string) =>
    new Set(
      (d.prepare(`PRAGMA table_info(${table})`).all() as unknown as { name: string }[]).map((c) => c.name),
    );

  if (!columns('site_audits').has('version_evidence_json')) {
    d.exec('ALTER TABLE site_audits ADD COLUMN version_evidence_json TEXT');
  }

  const rev = columns('review_signals');
  if (!rev.has('author_slavic_ratio')) {
    d.exec('ALTER TABLE review_signals ADD COLUMN author_slavic_ratio REAL');
  }
  if (!rev.has('author_cyrillic')) {
    d.exec('ALTER TABLE review_signals ADD COLUMN author_cyrillic INTEGER NOT NULL DEFAULT 0');
  }
}

const now = () => new Date().toISOString();
const month = () => new Date().toISOString().slice(0, 7);

/* ─────────────────────────────  places  ───────────────────────────── */

/** Повертає true, якщо місце нове (а не оновлення існуючого). */
export function upsertPlace(p: RawPlace, task: SearchTask, tier: string | null): boolean {
  const d = db();
  const existing = d.prepare('SELECT place_id FROM places WHERE place_id = ?').get(p.placeId);

  if (existing) {
    d.prepare(
      `UPDATE places SET
         name = ?, address = ?, lat = ?, lng = ?, primary_type = ?, primary_type_label = ?,
         types_json = ?, website = ?, phone = ?, rating = ?, user_rating_count = ?,
         business_status = ?, google_fetched_at = ?, updated_at = ?
       WHERE place_id = ?`,
    ).run(
      p.name, p.address, p.lat, p.lng, p.primaryType, p.primaryTypeLabel,
      JSON.stringify(p.types), p.website, p.phone, p.rating, p.userRatingCount,
      p.businessStatus, now(), now(), p.placeId,
    );
    return false;
  }

  d.prepare(
    `INSERT INTO places (
       place_id, name, address, lat, lng, primary_type, primary_type_label, types_json,
       website, phone, rating, user_rating_count, business_status, google_fetched_at,
       metro_key, hood_name, niche_key, tier, found_via,
       stage, bucket, created_at, updated_at
     ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'discovered','pending',?,?)`,
  ).run(
    p.placeId, p.name, p.address, p.lat, p.lng, p.primaryType, p.primaryTypeLabel,
    JSON.stringify(p.types), p.website, p.phone, p.rating, p.userRatingCount,
    p.businessStatus, now(),
    task.metroKey, task.hoodName, task.nicheKey, tier, task.mode,
    now(), now(),
  );
  return true;
}

export interface PlaceRow {
  place_id: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
  primary_type: string | null;
  primary_type_label: string | null;
  types_json: string;
  website: string | null;
  phone: string | null;
  rating: number | null;
  user_rating_count: number | null;
  business_status: string | null;
  google_fetched_at: string;
  metro_key: string | null;
  hood_name: string | null;
  niche_key: string | null;
  tier: string | null;
  found_via: string | null;
  stage: string;
  bucket: string;
  reject_reason: string | null;
}

export function setStage(placeId: string, stage: string) {
  db().prepare('UPDATE places SET stage = ?, updated_at = ? WHERE place_id = ?')
    .run(stage, now(), placeId);
}

export function setBucket(placeId: string, bucket: string, reason: string | null = null) {
  db().prepare('UPDATE places SET bucket = ?, reject_reason = ?, updated_at = ? WHERE place_id = ?')
    .run(bucket, reason, now(), placeId);
}

export function getPlaces(where: string, params: unknown[] = []): PlaceRow[] {
  return db().prepare(`SELECT * FROM places ${where}`).all(...(params as never[])) as unknown as PlaceRow[];
}

export function countPlaces(where = '', params: unknown[] = []): number {
  const r = db().prepare(`SELECT COUNT(*) AS c FROM places ${where}`)
    .get(...(params as never[])) as { c: number };
  return r.c;
}

/* ─────────────────────────────  audits  ───────────────────────────── */

export function saveAudit(
  placeId: string,
  audit: SiteAudit,
  lang: LangSignal | null,
  siteScore: number | null,
  reasons: string[],
  hours: HoursEstimate | null,
  versionEvidence: Evidence[] | null = null,
) {
  db().prepare(
    `INSERT INTO site_audits
       (place_id, audit_json, lang_json, version_evidence_json, site_score, site_reasons,
        hours_min, hours_max, hours_breakdown, audited_at)
     VALUES (?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(place_id) DO UPDATE SET
       audit_json = excluded.audit_json, lang_json = excluded.lang_json,
       version_evidence_json = COALESCE(excluded.version_evidence_json, site_audits.version_evidence_json),
       site_score = excluded.site_score, site_reasons = excluded.site_reasons,
       hours_min = excluded.hours_min, hours_max = excluded.hours_max,
       hours_breakdown = excluded.hours_breakdown, audited_at = excluded.audited_at`,
  ).run(
    placeId, JSON.stringify(audit), lang ? JSON.stringify(lang) : null,
    versionEvidence ? JSON.stringify(versionEvidence) : null,
    siteScore, reasons.join('; '),
    hours?.min ?? null, hours?.max ?? null, hours ? hours.breakdown.join('; ') : null,
    now(),
  );
}

export interface AuditRow {
  place_id: string;
  audit_json: string;
  lang_json: string | null;
  version_evidence_json: string | null;
  site_score: number | null;
  site_reasons: string | null;
  hours_min: number | null;
  hours_max: number | null;
  hours_breakdown: string | null;
}

export const getAudit = (placeId: string): AuditRow | null =>
  (db().prepare('SELECT * FROM site_audits WHERE place_id = ?').get(placeId) as unknown as AuditRow) ?? null;

/* ────────────────────────────  reviews  ──────────────────────────── */

export function saveReviewSignal(placeId: string, s: ReviewSignal) {
  db().prepare(
    `INSERT INTO review_signals
       (place_id, score, ratio, sample_size, preferred_lang, recent_slavic,
        author_slavic_ratio, author_cyrillic, evidence_json, checked_at)
     VALUES (?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(place_id) DO UPDATE SET
       score = excluded.score, ratio = excluded.ratio, sample_size = excluded.sample_size,
       preferred_lang = excluded.preferred_lang, recent_slavic = excluded.recent_slavic,
       author_slavic_ratio = excluded.author_slavic_ratio,
       author_cyrillic = excluded.author_cyrillic,
       evidence_json = excluded.evidence_json, checked_at = excluded.checked_at`,
  ).run(
    placeId, s.score, s.ratio, s.sampleSize, s.preferredLang, s.recentSlavic,
    s.authorSlavicRatio, s.authorCyrillicCount, JSON.stringify(s.evidence), now(),
  );
}

export interface ReviewRow {
  place_id: string;
  score: number;
  ratio: number | null;
  sample_size: number;
  preferred_lang: string | null;
  recent_slavic: number;
  author_slavic_ratio: number | null;
  author_cyrillic: number;
  evidence_json: string | null;
}

export const getReviewSignal = (placeId: string): ReviewRow | null =>
  (db().prepare('SELECT * FROM review_signals WHERE place_id = ?').get(placeId) as unknown as ReviewRow) ?? null;

/* ──────────────────────────────  psi  ────────────────────────────── */

export function savePsi(placeId: string, r: PsiResult) {
  db().prepare(
    `INSERT INTO psi_results (place_id, mobile_score, desktop_score, lcp_ms, cls, fetched_at)
     VALUES (?,?,?,?,?,?)
     ON CONFLICT(place_id) DO UPDATE SET
       mobile_score = excluded.mobile_score, desktop_score = excluded.desktop_score,
       lcp_ms = excluded.lcp_ms, cls = excluded.cls, fetched_at = excluded.fetched_at`,
  ).run(placeId, r.mobileScore, r.desktopScore, r.lcpMs, r.cls, r.fetchedAt);
}

export interface PsiRow {
  place_id: string;
  mobile_score: number | null;
  desktop_score: number | null;
  lcp_ms: number | null;
  cls: number | null;
  fetched_at: string;
}

export const getPsi = (placeId: string): PsiRow | null =>
  (db().prepare('SELECT * FROM psi_results WHERE place_id = ?').get(placeId) as unknown as PsiRow) ?? null;

/* ───────────────────────────  screenshots  ───────────────────────── */

export function saveScreenshots(
  placeId: string,
  desktopPath: string | null,
  mobilePath: string | null,
  desktopUrl: string | null = null,
  mobileUrl: string | null = null,
) {
  db().prepare(
    `INSERT INTO screenshots (place_id, desktop_path, mobile_path, desktop_url, mobile_url, taken_at)
     VALUES (?,?,?,?,?,?)
     ON CONFLICT(place_id) DO UPDATE SET
       desktop_path = excluded.desktop_path, mobile_path = excluded.mobile_path,
       desktop_url = excluded.desktop_url, mobile_url = excluded.mobile_url,
       taken_at = excluded.taken_at`,
  ).run(placeId, desktopPath, mobilePath, desktopUrl, mobileUrl, now());
}

export interface ShotRow {
  place_id: string;
  desktop_path: string | null;
  mobile_path: string | null;
  desktop_url: string | null;
  mobile_url: string | null;
}

export const getScreenshots = (placeId: string): ShotRow | null =>
  (db().prepare('SELECT * FROM screenshots WHERE place_id = ?').get(placeId) as unknown as ShotRow) ?? null;

/* ─────────────────────────  owner scores  ────────────────────────── */

export function saveOwnerScore(placeId: string, score: number, lang: string | null, ev: Evidence[]) {
  db().prepare(
    `INSERT INTO owner_scores (place_id, score, lang, evidence_json, computed_at)
     VALUES (?,?,?,?,?)
     ON CONFLICT(place_id) DO UPDATE SET
       score = excluded.score, lang = excluded.lang,
       evidence_json = excluded.evidence_json, computed_at = excluded.computed_at`,
  ).run(placeId, score, lang, JSON.stringify(ev), now());
}

export interface OwnerRow {
  place_id: string;
  score: number;
  lang: string | null;
  evidence_json: string;
}

export const getOwnerScore = (placeId: string): OwnerRow | null =>
  (db().prepare('SELECT * FROM owner_scores WHERE place_id = ?').get(placeId) as unknown as OwnerRow) ?? null;

/* ────────────────────────────  quotas  ───────────────────────────── */

export function bumpUsage(api: string, by = 1) {
  db().prepare(
    `INSERT INTO api_usage (api, month, count) VALUES (?,?,?)
     ON CONFLICT(api, month) DO UPDATE SET count = count + excluded.count`,
  ).run(api, month(), by);
}

export function getUsage(api: string): number {
  const r = db().prepare('SELECT count FROM api_usage WHERE api = ? AND month = ?')
    .get(api, month()) as { count: number } | undefined;
  return r?.count ?? 0;
}

export function allUsage(): { api: string; month: string; count: number }[] {
  return db().prepare('SELECT api, month, count FROM api_usage ORDER BY month DESC, api')
    .all() as unknown as { api: string; month: string; count: number }[];
}

/* ──────────────────────────  search runs  ───────────────────────── */

export const searchRan = (taskId: string): boolean =>
  !!db().prepare('SELECT task_id FROM search_runs WHERE task_id = ?').get(taskId);

export function markSearchRan(taskId: string, pages: number, results: number) {
  db().prepare(
    `INSERT INTO search_runs (task_id, pages, results, ran_at) VALUES (?,?,?,?)
     ON CONFLICT(task_id) DO UPDATE SET
       pages = excluded.pages, results = excluded.results, ran_at = excluded.ran_at`,
  ).run(taskId, pages, results, now());
}

/* ────────────────────────────  sheets  ──────────────────────────── */

export function saveSheetRow(placeId: string, tab: string, rowIndex: number) {
  db().prepare(
    `INSERT INTO sheet_rows (place_id, tab, row_index, synced_at) VALUES (?,?,?,?)
     ON CONFLICT(place_id) DO UPDATE SET
       tab = excluded.tab, row_index = excluded.row_index, synced_at = excluded.synced_at`,
  ).run(placeId, tab, rowIndex, now());
}

export const allSheetRows = (): { place_id: string; tab: string; row_index: number }[] =>
  db().prepare('SELECT place_id, tab, row_index FROM sheet_rows')
    .all() as unknown as { place_id: string; tab: string; row_index: number }[];

export const getSheetRow = (placeId: string): { tab: string; row_index: number } | null =>
  (db().prepare('SELECT tab, row_index FROM sheet_rows WHERE place_id = ?')
    .get(placeId) as unknown as { tab: string; row_index: number }) ?? null;
