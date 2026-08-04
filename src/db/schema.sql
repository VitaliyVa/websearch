-- ─────────────────────────────────────────────────────────────
-- ToS-note: place_id можна зберігати безстроково. Назва/адреса/координати
-- Google — кеш ≤30 днів, тому є google_fetched_at і команда refresh.
-- Тексти відгуків НЕ зберігаємо взагалі — тільки похідні агрегати.
-- ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS places (
  place_id            TEXT PRIMARY KEY,

  -- Google-дані, TTL 30 днів
  name                TEXT,
  address             TEXT,
  lat                 REAL,
  lng                 REAL,
  primary_type        TEXT,
  primary_type_label  TEXT,
  types_json          TEXT,
  website             TEXT,
  phone               TEXT,
  rating              REAL,
  user_rating_count   INTEGER,
  business_status     TEXT,
  google_fetched_at   TEXT NOT NULL,

  -- наш контекст пошуку
  metro_key           TEXT,
  hood_name           TEXT,
  niche_key           TEXT,
  tier                TEXT,
  found_via           TEXT,             -- ethnic | geo-dense | ethnic-standalone

  stage               TEXT NOT NULL DEFAULT 'discovered',
  bucket              TEXT NOT NULL DEFAULT 'pending',
  reject_reason       TEXT,

  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_places_stage  ON places(stage);
CREATE INDEX IF NOT EXISTS idx_places_bucket ON places(bucket);
CREATE INDEX IF NOT EXISTS idx_places_metro  ON places(metro_key);

-- Аудит сайту (L2)
CREATE TABLE IF NOT EXISTS site_audits (
  place_id        TEXT PRIMARY KEY REFERENCES places(place_id) ON DELETE CASCADE,
  audit_json      TEXT NOT NULL,        -- SiteAudit
  lang_json       TEXT,                 -- LangSignal з сайту
  -- Докази мовних версій (hreflang / пробінг / Accept-Language) зберігаємо
  -- ОКРЕМО: без них стадія reviews перерахувала б owner score без цих 45 балів
  -- і втратила б лід із найсильнішим сигналом.
  version_evidence_json TEXT,
  site_score      INTEGER,              -- 1..10
  site_reasons    TEXT,                 -- '−25 нема viewport; −10 копірайт 2013'
  hours_min       INTEGER,
  hours_max       INTEGER,
  hours_breakdown TEXT,
  audited_at      TEXT NOT NULL
);

-- Мовний сигнал з відгуків (L3) — тільки агрегати, не тексти
CREATE TABLE IF NOT EXISTS review_signals (
  place_id       TEXT PRIMARY KEY REFERENCES places(place_id) ON DELETE CASCADE,
  score          INTEGER NOT NULL,
  ratio          REAL,
  sample_size    INTEGER NOT NULL,
  preferred_lang TEXT,
  recent_slavic  INTEGER NOT NULL DEFAULT 0,
  -- Частка рецензентів зі слов'янськими іменами. САМІ ІМЕНА НЕ ЗБЕРІГАЮТЬСЯ:
  -- це і вимога ToS Google щодо контенту відгуків, і гігієна щодо персональних даних.
  author_slavic_ratio  REAL,
  author_cyrillic      INTEGER NOT NULL DEFAULT 0,
  evidence_json  TEXT,
  checked_at     TEXT NOT NULL
);

-- PSI (L4)
CREATE TABLE IF NOT EXISTS psi_results (
  place_id      TEXT PRIMARY KEY REFERENCES places(place_id) ON DELETE CASCADE,
  mobile_score  INTEGER,
  desktop_score INTEGER,
  lcp_ms        INTEGER,
  cls           REAL,
  fetched_at    TEXT NOT NULL
);

-- Скріншоти (L4)
CREATE TABLE IF NOT EXISTS screenshots (
  place_id     TEXT PRIMARY KEY REFERENCES places(place_id) ON DELETE CASCADE,
  desktop_path TEXT,
  mobile_path  TEXT,
  desktop_url  TEXT,
  mobile_url   TEXT,
  taken_at     TEXT NOT NULL
);

-- Фінальний скор власника
CREATE TABLE IF NOT EXISTS owner_scores (
  place_id       TEXT PRIMARY KEY REFERENCES places(place_id) ON DELETE CASCADE,
  score          INTEGER NOT NULL,
  lang           TEXT,
  evidence_json  TEXT NOT NULL,
  computed_at    TEXT NOT NULL
);

-- Облік квот, щоб не перевищити безкоштовні ліміти
CREATE TABLE IF NOT EXISTS api_usage (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  api        TEXT NOT NULL,             -- text_search | place_details | psi
  month      TEXT NOT NULL,             -- YYYY-MM
  count      INTEGER NOT NULL DEFAULT 0,
  UNIQUE(api, month)
);

-- Виконані пошукові запити — щоб повторний прогін не платив двічі
CREATE TABLE IF NOT EXISTS search_runs (
  task_id     TEXT PRIMARY KEY,
  pages       INTEGER NOT NULL,
  results     INTEGER NOT NULL,
  ran_at      TEXT NOT NULL
);

-- Мапа place_id -> номер рядка в Google Sheets, для ідемпотентного апдейту
CREATE TABLE IF NOT EXISTS sheet_rows (
  place_id   TEXT PRIMARY KEY REFERENCES places(place_id) ON DELETE CASCADE,
  tab        TEXT NOT NULL,
  row_index  INTEGER NOT NULL,
  synced_at  TEXT NOT NULL
);
