import { env } from '../config.js';
import { bumpUsage } from '../db/index.js';
import { chargeOrThrow } from '../quota.js';
import type { RawPlace } from '../types.js';
import { sleep } from '../util/text.js';

const ENDPOINT = 'https://places.googleapis.com/v1/places:searchText';
const DETAILS = 'https://places.googleapis.com/v1/places';

/**
 * SKU-нота (перевірено по Place Data Fields (New)):
 *   websiteUri, nationalPhoneNumber, rating, userRatingCount → Enterprise
 *   displayName, primaryType, businessStatus                  → Pro
 *   id, formattedAddress, location, types                     → Essentials
 * Білять по НАЙВИЩОМУ SKU в масці ⇒ цей пошук = Text Search Enterprise
 * ($35/1000, 1000 безкоштовних/міс). Жодного зайвого поля тут бути не повинно.
 */
const SEARCH_FIELD_MASK = [
  'places.id',
  'places.displayName',
  'places.formattedAddress',
  'places.location',
  'places.primaryType',
  'places.primaryTypeDisplayName',
  'places.types',
  'places.websiteUri',
  'places.nationalPhoneNumber',
  'places.rating',
  'places.userRatingCount',
  'places.businessStatus',
  'nextPageToken',
].join(',');

/**
 * Тільки відгуки — Enterprise + Atmosphere, ~$40/1000, 1000 безкоштовних/міс.
 *
 * `authorAttribution.displayName` входить у той самий `reviews` і НЕ підвищує
 * SKU — тобто імена рецензентів дістаються безкоштовно разом із мовою. Це
 * важливо, бо саме імена ловлять асимільований бізнес: клієнти пишуть
 * англійською, але звуть їх Оксана Коваленко.
 */
const REVIEWS_FIELD_MASK = [
  'id',
  'reviews.originalText.languageCode',
  'reviews.authorAttribution.displayName',
  'reviews.rating',
  'reviews.publishTime',
].join(',');

export { QuotaExceeded } from '../quota.js';

interface SearchTextResponse {
  places?: {
    id: string;
    displayName?: { text?: string };
    formattedAddress?: string;
    location?: { latitude: number; longitude: number };
    primaryType?: string;
    primaryTypeDisplayName?: { text?: string };
    types?: string[];
    websiteUri?: string;
    nationalPhoneNumber?: string;
    rating?: number;
    userRatingCount?: number;
    businessStatus?: string;
  }[];
  nextPageToken?: string;
}

export interface SearchParams {
  textQuery: string;
  includedType: string | null;
  lat: number;
  lng: number;
  radiusM: number;
  maxPages: number;
  quotaCap: number;
  allowPaid: boolean;
}

export interface SearchOutcome {
  places: RawPlace[];
  pagesFetched: number;
  hitPageCap: boolean;
}

export async function searchText(p: SearchParams): Promise<SearchOutcome> {
  const out: RawPlace[] = [];
  let pageToken: string | undefined;
  let pages = 0;

  for (let i = 0; i < p.maxPages; i++) {
    // Списуємо ДО мережевого виклику: краще порахувати зайвий запит,
    // ніж недорахувати вже оплачений через падіння процесу.
    chargeOrThrow('text_search', p.quotaCap, p.allowPaid);

    const body: Record<string, unknown> = {
      textQuery: p.textQuery,
      pageSize: 20,
      languageCode: 'en',
      regionCode: 'US',
      locationBias: {
        circle: {
          center: { latitude: p.lat, longitude: p.lng },
          // Google приймає radius 0..50000 м
          radius: Math.min(Math.max(p.radiusM, 1), 50_000),
        },
      },
    };
    if (p.includedType) body.includedType = p.includedType;
    if (pageToken) body.pageToken = pageToken;

    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': env.placesKey,
        'X-Goog-FieldMask': SEARCH_FIELD_MASK,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
    });

    bumpUsage('text_search');
    pages++;

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      // 429 — притормозити і спробувати ще раз один раз
      if (res.status === 429) {
        await sleep(3000);
        continue;
      }
      throw new Error(`Places searchText ${res.status}: ${text.slice(0, 400)}`);
    }

    const json = (await res.json()) as SearchTextResponse;
    for (const raw of json.places ?? []) {
      out.push({
        placeId: raw.id,
        name: raw.displayName?.text ?? '',
        address: raw.formattedAddress ?? '',
        lat: raw.location?.latitude ?? 0,
        lng: raw.location?.longitude ?? 0,
        primaryType: raw.primaryType ?? null,
        primaryTypeLabel: raw.primaryTypeDisplayName?.text ?? null,
        types: raw.types ?? [],
        website: raw.websiteUri ?? null,
        phone: raw.nationalPhoneNumber ?? null,
        rating: raw.rating ?? null,
        userRatingCount: raw.userRatingCount ?? null,
        businessStatus: raw.businessStatus ?? null,
      });
    }

    pageToken = json.nextPageToken;
    if (!pageToken) break;
    // Google просить паузу перед використанням pageToken
    await sleep(1200);
  }

  return { places: out, pagesFetched: pages, hitPageCap: !!pageToken };
}

export interface RawReview {
  languageCode: string | null;
  authorName: string | null;
  rating: number | null;
  publishTime: string | null;
}

/** Повертає МЕТАдані відгуків. Тексти не запитуємо і не зберігаємо. */
export async function fetchReviewMeta(
  placeId: string,
  quotaCap: number,
  allowPaid = false,
): Promise<RawReview[]> {
  chargeOrThrow('place_details', quotaCap, allowPaid);

  const res = await fetch(`${DETAILS}/${encodeURIComponent(placeId)}`, {
    headers: {
      'X-Goog-Api-Key': env.placesKey,
      'X-Goog-FieldMask': REVIEWS_FIELD_MASK,
    },
    signal: AbortSignal.timeout(20_000),
  });

  bumpUsage('place_details');

  if (!res.ok) {
    if (res.status === 404) return [];
    const text = await res.text().catch(() => '');
    throw new Error(`Places details ${res.status}: ${text.slice(0, 300)}`);
  }

  const json = (await res.json()) as {
    reviews?: {
      originalText?: { languageCode?: string };
      authorAttribution?: { displayName?: string };
      rating?: number;
      publishTime?: string;
    }[];
  };

  return (json.reviews ?? []).map((r) => ({
    languageCode: r.originalText?.languageCode ?? null,
    authorName: r.authorAttribution?.displayName ?? null,
    rating: r.rating ?? null,
    publishTime: r.publishTime ?? null,
  }));
}

/** Офіційно дозволений спосіб лінкувати на картку. */
export const mapsUrl = (placeId: string) =>
  `https://www.google.com/maps/place/?q=place_id:${placeId}`;
