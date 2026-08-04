import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import type { Metro, Niche } from './types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const ROOT = resolve(__dirname, '..');

export const paths = {
  root: ROOT,
  config: resolve(ROOT, 'config'),
  data: resolve(ROOT, 'data'),
  cache: resolve(ROOT, 'cache'),
  screenshots: resolve(ROOT, 'screenshots'),
  db: resolve(ROOT, 'data', 'leads.db'),
};

for (const dir of [paths.data, paths.cache, paths.screenshots]) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

/* ────────────────────────────  .env  ──────────────────────────── */

function loadDotEnv() {
  const envPath = resolve(ROOT, '.env');
  if (!existsSync(envPath)) return;
  const raw = readFileSync(envPath, 'utf8').replace(/^﻿/, '');
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}
loadDotEnv();

export const env = {
  placesKey: process.env.GOOGLE_PLACES_KEY ?? '',
  psiKey: process.env.GOOGLE_PSI_KEY ?? '',
  saEmail: process.env.GOOGLE_SA_EMAIL ?? '',
  saPrivateKey: (process.env.GOOGLE_SA_PRIVATE_KEY ?? '').replace(/\\n/g, '\n'),
  sheetId: process.env.GOOGLE_SHEET_ID ?? '',
  fetchConcurrency: Number(process.env.FETCH_CONCURRENCY ?? 8),
  crawlerContact: process.env.CRAWLER_CONTACT ?? 'contact@example.com',
};

export function requireEnv(keys: (keyof typeof env)[], command: string) {
  const missing = keys.filter((k) => !env[k]);
  if (missing.length) {
    const names: Record<string, string> = {
      placesKey: 'GOOGLE_PLACES_KEY',
      psiKey: 'GOOGLE_PSI_KEY',
      saEmail: 'GOOGLE_SA_EMAIL',
      saPrivateKey: 'GOOGLE_SA_PRIVATE_KEY',
      sheetId: 'GOOGLE_SHEET_ID',
    };
    throw new Error(
      `Команда "${command}" потребує змінних у .env: ${missing.map((m) => names[m] ?? m).join(', ')}\n` +
        `Скопіюй .env.example у .env і заповни.`,
    );
  }
}

/* ────────────────────────────  presets  ──────────────────────────── */

const PresetSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  metros: z.array(z.string()).min(1),
  tiers: z.array(z.enum(['A', 'B', 'C'])).min(1),
  discovery: z.object({
    ethnicMode: z.boolean(),
    geoDenseMode: z.boolean(),
    maxPagesPerQuery: z.number().int().min(1).max(3),
    ethnicMarkersLimit: z.number().int().min(1).max(20).default(4),
    ethnicNicheTiers: z.array(z.enum(['A', 'B', 'C'])).default(['A', 'B']),
    geoDenseTiers: z.array(z.enum(['A', 'B', 'C'])),
  }),
  filters: z.object({
    minUserRatingCount: z.number().int().min(0),
    requireUsAddress: z.boolean(),
    excludeCountryTlds: z.array(z.string()),
    excludePhonePrefixes: z.array(z.string()),
    excludeTypes: z.array(z.string()).default([]),
    modernStackIsRejection: z.boolean(),
  }),
  thresholds: z.object({
    ownerScoreLead: z.number().int(),
    ownerScoreManual: z.number().int(),
    siteScoreMaxForLead: z.number().int().min(1).max(10),
  }),
  budget: z.object({
    maxTextSearchRequests: z.number().int().min(1),
    maxPlaceDetailsRequests: z.number().int().min(0),
  }),
  audit: z.object({
    fetchTimeoutMs: z.number().int(),
    maxHtmlBytes: z.number().int(),
    perHostDelayMs: z.number().int(),
    enableLangProbe: z.boolean(),
    enableAcceptLanguageProbe: z.boolean(),
    enablePlaywrightFallback: z.boolean(),
    enableScreenshots: z.boolean(),
    enablePsi: z.boolean(),
  }),
});

export type Preset = z.infer<typeof PresetSchema>;

const stripComments = <T>(obj: T): T => {
  if (Array.isArray(obj)) return obj.map(stripComments) as T;
  if (obj && typeof obj === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      if (k.startsWith('_')) continue;
      out[k] = stripComments(v);
    }
    return out as T;
  }
  return obj;
};

const readJson = <T>(file: string): T => {
  // Windows-редактори (Notepad, PowerShell Set-Content -Encoding utf8) додають
  // BOM, на якому JSON.parse падає з нечитабельним "Unexpected token '﻿'".
  const raw = readFileSync(file, 'utf8').replace(/^﻿/, '');
  try {
    return stripComments(JSON.parse(raw) as T);
  } catch (e) {
    throw new Error(`Не вдалось прочитати ${file}: ${e instanceof Error ? e.message : e}`);
  }
};

export function loadPreset(name: string): Preset {
  const file = resolve(paths.config, 'presets', `${name}.json`);
  if (!existsSync(file)) throw new Error(`Пресет не знайдено: ${file}`);
  return PresetSchema.parse(readJson(file));
}

export function loadMetros(): Record<string, Metro> {
  return readJson<Record<string, Metro>>(resolve(paths.config, 'metros.json'));
}

export function loadNiches(): {
  niches: Niche[];
  ethnicMarkers: string[];
  ethnicStandaloneQueries: string[];
} {
  return readJson(resolve(paths.config, 'niches.json'));
}
