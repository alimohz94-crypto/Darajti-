import {
  Category,
  IRAQI_GOVERNORATES,
  Listing,
  SearchSuggestionResponse,
  SliderItem,
  SmartSearchChip,
  SmartSearchResponse,
} from '../types';

const PUBLIC_OFFLINE_CACHE_KEY = 'darajati_public_cache_v1';
const MAX_CACHED_LISTINGS = 150;

export interface PublicOfflineCache {
  categories: Category[];
  sliders: SliderItem[];
  listings: Listing[];
  detailIds: number[];
  savedAt: number;
}

export interface OfflineListingsQuery {
  q?: string;
  governorate?: string;
  categoryId?: number | null;
  minPrice?: string;
  maxPrice?: string;
  sort?: 'newest' | 'price_asc' | 'price_desc';
  hideDemo?: boolean;
  ignoredChips?: string[];
  condition?: 'new' | 'used' | '';
  brand?: string;
}

function isPublicListingStatus(status: unknown): boolean {
  return status === 'approved' || status === 'sold';
}

function sanitizePublicListing(item: Listing): Listing | null {
  if (!item || !isPublicListingStatus(item.status)) return null;
  return {
    id: Number(item.id),
    title: String(item.title || ''),
    brand: String(item.brand || ''),
    category_id: Number(item.category_id),
    category_name: String(item.category_name || ''),
    category_slug: String(item.category_slug || ''),
    is_parts_or_accessories: Boolean(item.is_parts_or_accessories),
    governorate: String(item.governorate || ''),
    area: String(item.area || ''),
    model_year: item.model_year ?? null,
    engine_cc: item.engine_cc ?? null,
    motor_watts: item.motor_watts ?? null,
    condition: item.condition === 'new' ? 'new' : 'used',
    price_iqd: Number(item.price_iqd) || 0,
    negotiable: Boolean(item.negotiable),
    description: String(item.description || ''),
    keywords: String(item.keywords || ''),
    images: Array.isArray(item.images) ? item.images : [],
    video_url: item.video_url || null,
    status: item.status,
    is_demo: Boolean(item.is_demo),
    is_hidden: Boolean(item.is_hidden),
    created_at: String(item.created_at || ''),
    updated_at: String(item.updated_at || ''),
  };
}

export function loadPublicOfflineCache(): PublicOfflineCache | null {
  try {
    const raw = localStorage.getItem(PUBLIC_OFFLINE_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    const listings = Array.isArray(parsed.listings)
      ? parsed.listings
          .map(sanitizePublicListing)
          .filter((x: Listing | null): x is Listing => x !== null)
      : [];
    const categories = Array.isArray(parsed.categories) ? parsed.categories : [];
    const sliders = Array.isArray(parsed.sliders)
      ? parsed.sliders.filter((s: SliderItem) => s && s.is_active !== false)
      : [];
    const detailIds = Array.isArray(parsed.detailIds)
      ? parsed.detailIds.map((id: any) => Number(id)).filter((id: number) => id > 0)
      : [];
    return {
      categories,
      sliders,
      listings,
      detailIds,
      savedAt: Number(parsed.savedAt) || 0,
    };
  } catch {
    return null;
  }
}

function writePublicOfflineCache(cache: PublicOfflineCache): void {
  try {
    localStorage.setItem(PUBLIC_OFFLINE_CACHE_KEY, JSON.stringify(cache));
  } catch {
    // If storage quota is tight, trim cached listings and retry once
    try {
      const trimmed: PublicOfflineCache = {
        ...cache,
        listings: cache.listings.slice(0, 50),
      };
      localStorage.setItem(PUBLIC_OFFLINE_CACHE_KEY, JSON.stringify(trimmed));
    } catch {
      // ignore quota failures gracefully
    }
  }
}

export function hasSavedOfflineBrowseData(): boolean {
  const cache = loadPublicOfflineCache();
  return Boolean(cache && (cache.categories.length > 0 || cache.listings.length > 0));
}

export function savePublicCategoriesOffline(categories: Category[]): void {
  const existing = loadPublicOfflineCache() || {
    categories: [],
    sliders: [],
    listings: [],
    detailIds: [],
    savedAt: Date.now(),
  };
  writePublicOfflineCache({
    ...existing,
    categories: Array.isArray(categories) ? categories : [],
    savedAt: Date.now(),
  });
}

export function savePublicSlidersOffline(sliders: SliderItem[]): void {
  const existing = loadPublicOfflineCache() || {
    categories: [],
    sliders: [],
    listings: [],
    detailIds: [],
    savedAt: Date.now(),
  };
  writePublicOfflineCache({
    ...existing,
    sliders: Array.isArray(sliders)
      ? sliders.filter((s) => s && s.is_active !== false)
      : [],
    savedAt: Date.now(),
  });
}

export function savePublicListingsOffline(items: Listing[], replaceUnfiltered = false): void {
  const existing = loadPublicOfflineCache() || {
    categories: [],
    sliders: [],
    listings: [],
    detailIds: [],
    savedAt: Date.now(),
  };

  const cleanIncoming = items
    .map(sanitizePublicListing)
    .filter((x): x is Listing => x !== null);

  let merged: Listing[];
  if (replaceUnfiltered) {
    // Keep newly synced unfiltered listings first, preserve any other previously cached approved listings up to limit
    const incomingIds = new Set(cleanIncoming.map((i) => i.id));
    const others = existing.listings.filter((i) => !incomingIds.has(i.id));
    merged = [...cleanIncoming, ...others].slice(0, MAX_CACHED_LISTINGS);
  } else {
    const map = new Map<number, Listing>();
    for (const item of cleanIncoming) map.set(item.id, item);
    for (const prev of existing.listings) {
      if (!map.has(prev.id)) map.set(prev.id, prev);
    }
    merged = Array.from(map.values()).slice(0, MAX_CACHED_LISTINGS);
  }

  const detailSet = new Set(existing.detailIds);
  for (const item of cleanIncoming) {
    detailSet.add(item.id);
  }

  writePublicOfflineCache({
    ...existing,
    listings: merged,
    detailIds: Array.from(detailSet).slice(0, MAX_CACHED_LISTINGS * 2),
    savedAt: Date.now(),
  });
}

export function savePublicListingDetailOffline(listing: Listing): void {
  // Strictly ignore pending or rejected listings — never cache them offline
  const clean = sanitizePublicListing(listing);
  if (!clean) return;
  savePublicListingsOffline([clean], false);
}

export function removeListingFromOfflineCache(id: number): void {
  const existing = loadPublicOfflineCache();
  if (!existing) return;
  writePublicOfflineCache({
    ...existing,
    listings: existing.listings.filter((l) => l.id !== id),
    detailIds: existing.detailIds.filter((x) => x !== id),
  });
}

export function getCachedListingByIdOffline(id: number): Listing | null {
  const cache = loadPublicOfflineCache();
  if (!cache) return null;
  const found = cache.listings.find((l) => l.id === id);
  if (!found || !isPublicListingStatus(found.status)) return null;
  return found;
}

/**
 * Purges any legacy or accidental admin/pending/rejected data from localStorage,
 * sessionStorage, and Cache API storage.
 */
export async function purgeAdminAndSensitiveOfflineCaches(): Promise<void> {
  try {
    const lsKeys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k) lsKeys.push(k);
    }
    for (const key of lsKeys) {
      if (/admin|csrf|pending|rejected/i.test(key)) {
        localStorage.removeItem(key);
      }
    }
  } catch {
    // ignore
  }

  try {
    const ssKeys: string[] = [];
    for (let i = 0; i < sessionStorage.length; i++) {
      const k = sessionStorage.key(i);
      if (k) ssKeys.push(k);
    }
    for (const key of ssKeys) {
      if (/admin|csrf|pending|rejected/i.test(key)) {
        sessionStorage.removeItem(key);
      }
    }
  } catch {
    // ignore
  }

  // Re-sanitize public cache so pending/rejected items can never persist
  try {
    const current = loadPublicOfflineCache();
    if (current) {
      writePublicOfflineCache(current);
    }
  } catch {
    // ignore
  }

  // Remove any admin entries or admin caches in Service Worker CacheStorage
  if (typeof window !== 'undefined' && 'caches' in window) {
    try {
      const cacheNames = await window.caches.keys();
      await Promise.all(
        cacheNames.map(async (name) => {
          if (/admin/i.test(name)) {
            await window.caches.delete(name);
            return;
          }
          const cache = await window.caches.open(name);
          const requests = await cache.keys();
          await Promise.all(
            requests.map(async (req) => {
              const url = req.url;
              if (
                /\/(admin|api\/admin|api\/health)(\/|$|\?)/i.test(url) ||
                /AdminDashboard/i.test(url)
              ) {
                await cache.delete(req);
              }
            })
          );
        })
      );
    } catch {
      // ignore Cache API errors
    }
  }
}

// ================= OFFLINE SMART SEARCH & FILTERING =================

function normalizeArabicOffline(input: string): string {
  const arabicDigits = '٠١٢٣٤٥٦٧٨٩';
  const persianDigits = '۰۱۲۳۴۵۶۷۸۹';
  let out = String(input || '').trim().toLowerCase();
  for (let i = 0; i < 10; i++) {
    out = out.replaceAll(arabicDigits[i], String(i)).replaceAll(persianDigits[i], String(i));
  }
  out = out
    .replace(/[\u064B-\u065F\u0670]/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/گ/g, 'ك')
    .replace(/پ/g, 'ب')
    .replace(/چ/g, 'ج')
    .replace(/\s+/g, ' ')
    .trim();
  return out;
}

const OFFLINE_BRAND_SYNONYMS: Record<string, string[]> = {
  Honda: ['هوندا', 'honda', 'هونداي'],
  Yamaha: ['ياماها', 'يماها', 'yamaha'],
  Suzuki: ['سوزوكي', 'سزوكي', 'suzuki'],
  Kawasaki: ['كاواساكي', 'كواساكي', 'kawasaki'],
  Bajaj: ['باجاج', 'bajaj', 'بجاج'],
  Dayun: ['دايون', 'ديون', 'dayun'],
  Hogan: ['هوجان', 'هوغن', 'hogan'],
  Benelli: ['بينلي', 'بنلي', 'benelli'],
  TVS: ['تي في اس', 'tvs'],
  Hawa: ['حوا', 'هوا', 'hawa'],
};

const OFFLINE_FILLERS = new Set(
  [
    'اريد',
    'ادور',
    'على',
    'علي',
    'محتاج',
    'عايز',
    'بدور',
    'ابحث',
    'عن',
    'في',
    'ب',
    'من',
    'الى',
    'من فضلك',
    'لو سمحت',
    'دراجه',
    'دراجات',
    'موتر',
    'موتور',
    'موتوسيكل',
  ].map(normalizeArabicOffline)
);

export function runOfflineSmartSearch(query: OfflineListingsQuery): SmartSearchResponse {
  const cache = loadPublicOfflineCache();
  const categories = cache?.categories || [];
  const allListings = (cache?.listings || []).filter((l) => isPublicListingStatus(l.status));

  const rawQ = String(query.q || '').trim();
  const normQ = normalizeArabicOffline(rawQ);
  const ignored = new Set(query.ignoredChips || []);
  const chips: SmartSearchChip[] = [];

  let inferredGov: string | null = null;
  let inferredCategoryId: number | null = null;
  let inferredCondition: 'new' | 'used' | '' = '';
  let inferredMaxPrice: number | null = null;
  let inferredMinPrice: number | null = null;
  let inferredCc: number | null = null;
  let inferredBrand: string | null = null;

  if (normQ) {
    // Governorate extraction
    if (!ignored.has('governorate')) {
      for (const gov of IRAQI_GOVERNORATES) {
        const ng = normalizeArabicOffline(gov);
        const ngNoAl = ng.replace(/^ال/, '');
        if (normQ.includes(ng) || (ngNoAl.length >= 3 && normQ.includes(ngNoAl))) {
          inferredGov = gov;
          chips.push({
            key: 'governorate',
            label: `المحافظة: ${gov}`,
            kind: 'governorate',
            source: 'query',
          });
          break;
        }
      }
    }

    // Condition extraction (JS \b fails on Arabic letters, so use whitespace boundaries)
    if (!ignored.has('condition')) {
      if (/(?:^|\s)(مستعمل|مستعمله)(?=\s|$)/.test(normQ)) {
        inferredCondition = 'used';
        chips.push({
          key: 'condition',
          label: 'الحالة: مستعملة',
          kind: 'condition',
          source: 'query',
        });
      } else if (/(?:^|\s)(جديد|جديده|زيرو)(?=\s|$)/.test(normQ)) {
        inferredCondition = 'new';
        chips.push({
          key: 'condition',
          label: 'الحالة: جديدة',
          kind: 'condition',
          source: 'query',
        });
      }
    }

    // Engine CC extraction
    if (!ignored.has('cc')) {
      const ccMatch = normQ.match(/(\d{2,4})\s*(?:cc|سي سي|سيسي|سي)/i);
      if (ccMatch) {
        inferredCc = Number(ccMatch[1]);
        chips.push({
          key: 'cc',
          label: `المحرك: ${inferredCc} سي سي`,
          kind: 'engine_cc',
          source: 'query',
        });
      }
    }

    // Price extraction (Arabic local phrases)
    if (!ignored.has('price')) {
      if (/(?:اقل من|باقل من|تحت|بحدود|دون)\s*مليون(?=\s|$)/.test(normQ)) {
        inferredMaxPrice = 1000000;
        chips.push({
          key: 'price',
          label: 'السعر: أقل من 1,000,000 د.ع',
          kind: 'price',
          source: 'query',
        });
      } else {
        const milMatch = normQ.match(/(?:اقل من|باقل من|تحت|دون|بحدود)\s*(\d+(?:\.\d+)?)\s*(?:مليون|ملايين)/);
        const alfMatch = normQ.match(/(?:اقل من|باقل من|تحت|دون|بحدود)\s*(\d+)\s*(?:الف|الاف)/);
        if (milMatch) {
          inferredMaxPrice = Math.round(Number(milMatch[1]) * 1_000_000);
          chips.push({
            key: 'price',
            label: `السعر: أقل من ${inferredMaxPrice.toLocaleString('en-US')} د.ع`,
            kind: 'price',
            source: 'query',
          });
        } else if (alfMatch) {
          inferredMaxPrice = Math.round(Number(alfMatch[1]) * 1_000);
          chips.push({
            key: 'price',
            label: `السعر: أقل من ${inferredMaxPrice.toLocaleString('en-US')} د.ع`,
            kind: 'price',
            source: 'query',
          });
        }
      }
    }

    // Category extraction (compare against normalized forms where ئ->ي and ة->ه)
    if (!ignored.has('category')) {
      if (normQ.includes('سكوتر كهرباي') || normQ.includes('كهرباي')) {
        const cat = categories.find(
          (c) => c.slug === 'ebikes' || normalizeArabicOffline(c.name_ar).includes('كهرباي')
        );
        if (cat) {
          inferredCategoryId = cat.id;
          chips.push({
            key: 'category',
            label: `القسم: ${cat.name_ar}`,
            kind: 'category',
            source: 'query',
          });
        }
      } else if (normQ.includes('سكوتر')) {
        const cat = categories.find((c) => c.slug === 'scooters' || normalizeArabicOffline(c.name_ar).includes('سكوتر'));
        if (cat) {
          inferredCategoryId = cat.id;
          chips.push({
            key: 'category',
            label: `القسم: ${cat.name_ar}`,
            kind: 'category',
            source: 'query',
          });
        }
      } else if (normQ.includes('قطع غيار') || normQ.includes('غيار')) {
        const cat = categories.find((c) => c.slug === 'parts' || normalizeArabicOffline(c.name_ar).includes('غيار'));
        if (cat) {
          inferredCategoryId = cat.id;
          chips.push({
            key: 'category',
            label: `القسم: ${cat.name_ar}`,
            kind: 'category',
            source: 'query',
          });
        }
      } else if (normQ.includes('اكسسوار') || normQ.includes('خوذه')) {
        const cat = categories.find((c) => c.slug === 'accessories' || normalizeArabicOffline(c.name_ar).includes('اكسسوار'));
        if (cat) {
          inferredCategoryId = cat.id;
          chips.push({
            key: 'category',
            label: `القسم: ${cat.name_ar}`,
            kind: 'category',
            source: 'query',
          });
        }
      } else if (normQ.includes('هواي') || normQ.includes('بايسكل')) {
        const cat = categories.find((c) => c.slug === 'bicycles' || normalizeArabicOffline(c.name_ar).includes('هواي'));
        if (cat) {
          inferredCategoryId = cat.id;
          chips.push({
            key: 'category',
            label: `القسم: ${cat.name_ar}`,
            kind: 'category',
            source: 'query',
          });
        }
      }
    }

    // Brand extraction
    if (!ignored.has('brand')) {
      for (const [canonical, aliases] of Object.entries(OFFLINE_BRAND_SYNONYMS)) {
        if (aliases.some((al) => normQ.includes(normalizeArabicOffline(al)))) {
          inferredBrand = canonical;
          chips.push({
            key: 'brand',
            label: `الماركة: ${canonical}`,
            kind: 'brand',
            source: 'query',
          });
          break;
        }
      }
    }
  }

  const effectiveGov =
    query.governorate && query.governorate !== 'جميع المحافظات'
      ? query.governorate
      : inferredGov;
  const effectiveCatId = query.categoryId || inferredCategoryId;
  const effectiveCond = query.condition || inferredCondition;
  const effectiveBrand = query.brand || inferredBrand;
  const effectiveMinPrice = query.minPrice ? Number(query.minPrice) : inferredMinPrice;
  const effectiveMaxPrice = query.maxPrice ? Number(query.maxPrice) : inferredMaxPrice;

  // Remaining text tokens that aren't fillers or already extracted entities
  const effectiveGovNorm = effectiveGov ? normalizeArabicOffline(effectiveGov) : '';
  const residualTokens = normQ
    .split(/\s+/)
    .filter((tok) => {
      if (!tok || OFFLINE_FILLERS.has(tok)) return false;
      if (
        ['مستعمل', 'مستعمله', 'جديد', 'جديده', 'زيرو'].includes(tok) ||
        ['اقل', 'باقل', 'تحت', 'دون', 'بحدود', 'مليون', 'ملايين', 'الف', 'الاف', 'دينار', 'سعر', 'سعرها'].includes(tok) ||
        ['سكوتر', 'سكوترات', 'كهربايي', 'كهرباييه', 'ناريه', 'ناري', 'هواييه', 'هوايي', 'بايسكل', 'قطع', 'غيار', 'اكسسوارات', 'سي', 'سيسي', 'cc', 'واط'].includes(tok)
      ) {
        return false;
      }
      if (inferredCc && tok.includes(String(inferredCc))) return false;
      if (effectiveGovNorm) {
        const bareTok = tok.replace(/^(ب|ل|ك|بال|فال|لل)/, '');
        if (
          effectiveGovNorm.includes(tok) ||
          (bareTok.length >= 3 && effectiveGovNorm.includes(bareTok))
        ) {
          return false;
        }
      }
      if (effectiveBrand) {
        const als = OFFLINE_BRAND_SYNONYMS[effectiveBrand] || [effectiveBrand];
        if (als.some((a) => normalizeArabicOffline(a) === tok)) return false;
      }
      return tok.length >= 2;
    });

  const filtered = allListings.filter((item) => {
    if (query.hideDemo && item.is_demo) return false;
    if (effectiveGov && item.governorate !== effectiveGov) return false;
    if (effectiveCatId && item.category_id !== effectiveCatId) return false;
    if (effectiveCond && item.condition !== effectiveCond) return false;
    if (effectiveBrand) {
      const itemBrandNorm = normalizeArabicOffline(item.brand || '');
      const itemTitleNorm = normalizeArabicOffline(item.title || '');
      const targetNorm = normalizeArabicOffline(effectiveBrand);
      if (!itemBrandNorm.includes(targetNorm) && !itemTitleNorm.includes(targetNorm)) {
        const aliases = OFFLINE_BRAND_SYNONYMS[effectiveBrand] || [];
        if (!aliases.some((a) => itemTitleNorm.includes(normalizeArabicOffline(a)))) {
          return false;
        }
      }
    }
    if (effectiveMinPrice && item.price_iqd < effectiveMinPrice) return false;
    if (effectiveMaxPrice && item.price_iqd > effectiveMaxPrice) return false;
    if (inferredCc && item.engine_cc !== inferredCc) {
      const hay = normalizeArabicOffline(`${item.title} ${item.description}`);
      if (!hay.includes(String(inferredCc))) return false;
    }

    if (residualTokens.length > 0) {
      const hay = normalizeArabicOffline(
        `${item.title} ${item.brand} ${item.category_name} ${item.governorate} ${item.area} ${item.description} ${item.keywords || ''}`
      );
      for (const tok of residualTokens) {
        if (!hay.includes(tok)) return false;
      }
    }
    return true;
  });

  const sorted = [...filtered].sort((a, b) => {
    if (query.sort === 'price_asc') return a.price_iqd - b.price_iqd;
    if (query.sort === 'price_desc') return b.price_iqd - a.price_iqd;
    return b.id - a.id;
  });

  const matchedCatObj = effectiveCatId
    ? categories.find((c) => c.id === effectiveCatId) || null
    : null;

  return {
    items: sorted,
    nearResults: [],
    chips,
    conflicts: [],
    clarifications: [],
    parsedIntent: {
      governorate: effectiveGov || null,
      categoryIds: effectiveCatId ? [effectiveCatId] : [],
      categoryLabel: matchedCatObj ? matchedCatObj.name_ar : null,
      brand: effectiveBrand || null,
      condition: (effectiveCond || null) as 'new' | 'used' | null,
      engineCc: inferredCc || null,
      motorWatts: null,
      modelYear: null,
      minPrice: effectiveMinPrice || null,
      maxPrice: effectiveMaxPrice || null,
      keywords: residualTokens,
    },
  };
}

export function getOfflineSuggestions(q: string): SearchSuggestionResponse {
  const cache = loadPublicOfflineCache();
  const norm = normalizeArabicOffline(q);
  if (!cache || !norm) {
    return { categories: [], brands: [], listings: [], clarifications: [] };
  }

  const matchedCats = cache.categories.filter((c) =>
    normalizeArabicOffline(c.name_ar).includes(norm)
  );

  const brandSet = new Set<string>();
  for (const l of cache.listings) {
    if (l.brand && normalizeArabicOffline(l.brand).includes(norm)) {
      brandSet.add(l.brand);
    }
  }

  const matchedListings = cache.listings
    .filter((l) => {
      if (!isPublicListingStatus(l.status)) return false;
      const hay = normalizeArabicOffline(
        `${l.title} ${l.brand} ${l.category_name} ${l.governorate} ${l.description}`
      );
      return hay.includes(norm);
    })
    .slice(0, 6)
    .map((l) => ({
      id: l.id,
      title: l.title,
      brand: l.brand,
      category_name: l.category_name,
      governorate: l.governorate,
      price_iqd: l.price_iqd,
      engine_cc: l.engine_cc ?? null,
      image_url: l.images.find((i) => i.isCover)?.url || l.images[0]?.url || null,
    }));

  return {
    categories: matchedCats.slice(0, 4),
    brands: Array.from(brandSet).slice(0, 4),
    listings: matchedListings,
    clarifications: [],
  };
}
