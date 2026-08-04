export type Tier = 'A' | 'B' | 'C';

export interface Hood {
  name: string;
  lat: number;
  lng: number;
  radiusM: number;
}

export interface Metro {
  label: string;
  state: string;
  center: { lat: number; lng: number };
  ethnicRadiusM: number;
  pilot: boolean;
  hoods: Hood[];
}

export interface Niche {
  key: string;
  tier: Tier;
  label: string;
  textQuery: string;
  includedType: string | null;
}

/** Один пошуковий запит до Places, розгорнутий із конфігу. */
export interface SearchTask {
  id: string;
  metroKey: string;
  mode: 'ethnic' | 'geo-dense' | 'ethnic-standalone';
  textQuery: string;
  includedType: string | null;
  nicheKey: string | null;
  hoodName: string | null;
  bias: { lat: number; lng: number; radiusM: number };
}

/** Сире місце з Places Text Search (L0). */
export interface RawPlace {
  placeId: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
  primaryType: string | null;
  primaryTypeLabel: string | null;
  types: string[];
  website: string | null;
  phone: string | null;
  rating: number | null;
  userRatingCount: number | null;
  businessStatus: string | null;
}

export type LeadStage =
  | 'discovered'
  | 'filtered_out'
  | 'audited'
  | 'reviews_checked'
  | 'enriched'
  | 'exported';

export type LeadBucket = 'leads' | 'manual' | 'no_site' | 'rejected' | 'pending';

export interface Evidence {
  signal: string;
  weight: number;
  detail?: string;
}

export interface SiteAudit {
  finalUrl: string | null;
  httpStatus: number | null;
  fetchError: string | null;
  redirectedToDifferentHost: boolean;

  https: boolean;
  tlsExpired: boolean;
  mixedContent: boolean;

  hasViewportMeta: boolean;
  title: string | null;
  metaDescription: string | null;
  h1: string | null;
  ogTags: boolean;
  favicon: boolean;
  charsetDeclared: boolean;

  jqueryVersion: string | null;
  bootstrapMajor: number | null;
  hasFlash: boolean;
  tableLayout: boolean;
  modernFramework: string | null;
  cms: string | null;
  builder: string | null;
  techStack: string[];

  footerYear: number | null;
  pageCount: number;
  uniquePageTypes: number;
  hasCatalog: boolean;
  hasEcommerce: boolean;
  hasForms: boolean;
  languages: number;

  emails: string[];
  socials: Record<string, string>;
  renderedWithBrowser: boolean;
  htmlBytes: number;
}

export interface LangSignal {
  score: number;
  lang: 'uk' | 'ru' | 'cyr' | null;
  evidence: Evidence[];
  hardExclusion: string | null;
}

export interface ReviewSignal {
  score: number;
  ratio: number | null;
  sampleSize: number;
  preferredLang: 'uk' | 'ru' | null;
  recentSlavic: number;
  /** Частка рецензентів зі слов'янськими іменами. Самі імена НЕ зберігаємо. */
  authorSlavicRatio: number | null;
  authorCyrillicCount: number;
  evidence: Evidence[];
}

export interface PsiResult {
  mobileScore: number | null;
  desktopScore: number | null;
  lcpMs: number | null;
  cls: number | null;
  fetchedAt: string;
}

export interface HoursEstimate {
  min: number;
  max: number;
  breakdown: string[];
}
