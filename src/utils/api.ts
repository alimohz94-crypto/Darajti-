import {
  AdminAuditLog,
  AdminNotification,
  AdminOverview,
  Category,
  Listing,
  ListingImage,
  ReportItem,
  SavedOwnership,
  SearchSuggestionResponse,
  SearchSynonym,
  SliderItem,
  SmartSearchResponse,
} from '../types';
import {
  getCachedListingByIdOffline,
  getOfflineSuggestions,
  hasSavedOfflineBrowseData,
  loadPublicOfflineCache,
  purgeAdminAndSensitiveOfflineCaches,
  removeListingFromOfflineCache,
  runOfflineSmartSearch,
  savePublicCategoriesOffline,
  savePublicListingDetailOffline,
  savePublicListingsOffline,
  savePublicSlidersOffline,
} from './offlineStore';

const PREFS_GOV_KEY = 'darajati_gov_pref';
const PREFS_HIDE_DEMO_KEY = 'darajati_hide_demo';
const FAVORITES_KEY = 'darajati_favorites';
const DRAFT_KEY = 'darajati_add_draft';
const MY_POSTS_KEY = 'darajati_my_posts';
const VISIT_SESSION_KEY = 'darajati_visit_session';

// CSRF token stored strictly in memory (never in localStorage or sessionStorage!)
let adminCsrfToken = '';

export function clearAdminCsrfToken(): void {
  adminCsrfToken = '';
}

// ================= REAL SERVER CONNECTIVITY TRACKING =================

let lastKnownServerOnline: boolean =
  typeof navigator !== 'undefined' ? navigator.onLine : true;
const connectivityListeners = new Set<(online: boolean) => void>();

export function getLastKnownServerOnline(): boolean {
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return false;
  }
  return lastKnownServerOnline;
}

export function setServerConnectivityState(online: boolean): void {
  const effective =
    typeof navigator !== 'undefined' && !navigator.onLine ? false : online;
  if (lastKnownServerOnline !== effective) {
    lastKnownServerOnline = effective;
    connectivityListeners.forEach((cb) => {
      try {
        cb(effective);
      } catch {
        // ignore listener errors
      }
    });
  }
}

export function subscribeServerConnectivity(
  listener: (online: boolean) => void
): () => void {
  connectivityListeners.add(listener);
  return () => {
    connectivityListeners.delete(listener);
  };
}

/**
 * Verifies real reachability to the origin server rather than trusting navigator.onLine alone.
 */
export async function checkServerReachable(): Promise<boolean> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    setServerConnectivityState(false);
    return false;
  }

  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 3500);
  try {
    const res = await fetch(`/api/health?_t=${Date.now()}`, {
      method: 'GET',
      cache: 'no-store',
      credentials: 'include',
      headers: {
        'Cache-Control': 'no-cache',
        Pragma: 'no-cache',
      },
      signal: controller.signal,
    });
    if (!res.ok) {
      setServerConnectivityState(false);
      return false;
    }
    const liveHeader = res.headers.get('X-Darajati-Live');
    const data = await res.json().catch(() => null);
    const reachable = Boolean(liveHeader === '1' && data?.ok === true);
    setServerConnectivityState(reachable);
    return reachable;
  } catch {
    setServerConnectivityState(false);
    return false;
  } finally {
    window.clearTimeout(timeout);
  }
}

export interface AddListingDraft {
  governorate: string;
  title: string;
  brand: string;
  category_id: string;
  model_year: string;
  engine_cc: string;
  motor_watts: string;
  condition: 'new' | 'used';
  price_iqd: string;
  negotiable: boolean;
  phone: string;
  area: string;
  description: string;
  keywords: string;
  images: ListingImage[];
  video_url: string | null;
}

export class ApiError extends Error {
  status: number;
  fieldErrors?: Record<string, string>;
  isOffline?: boolean;

  constructor(
    message: string,
    status = 0,
    fieldErrors?: Record<string, string>,
    isOffline = false
  ) {
    super(message);
    this.status = status;
    this.fieldErrors = fieldErrors;
    this.isOffline = isOffline;
  }
}

async function requestJson<T>(url: string, options: RequestInit = {}): Promise<T> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    setServerConnectivityState(false);
    throw new ApiError(
      'هذا المحتوى يحتاج اتصالًا بالإنترنت',
      0,
      undefined,
      true
    );
  }

  const method = String(options.method || 'GET').toUpperCase();
  const headers = new Headers(options.headers || {});
  headers.set('X-Requested-With', 'Darajati-Client');
  if (adminCsrfToken && ['POST', 'PATCH', 'PUT', 'DELETE'].includes(method)) {
    headers.set('X-CSRF-Token', adminCsrfToken);
  }

  let res: Response;
  try {
    res = await fetch(url, {
      ...options,
      headers,
      credentials: 'include',
    });
  } catch {
    setServerConnectivityState(false);
    throw new ApiError(
      'تعذر الاتصال بالخادم. يرجى التحقق من اتصال الإنترنت.',
      0,
      undefined,
      true
    );
  }

  // Detect proxy / gateway offline responses
  if (res.status === 502 || res.status === 504) {
    setServerConnectivityState(false);
    throw new ApiError(
      'تعذر الاتصال بالخادم حالياً.',
      res.status,
      undefined,
      true
    );
  }

  setServerConnectivityState(true);

  let data: any = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }

  if (!res.ok) {
    if (res.status === 401 && url.startsWith('/api/admin')) {
      adminCsrfToken = '';
    }
    throw new ApiError(
      data?.error || `تعذّر المتابعة (${res.status}).`,
      res.status,
      data?.fieldErrors
    );
  }

  return data as T;
}

// Client-side image compression using Canvas (max 1600px, WebP/JPEG 0.82)
export async function compressImageFile(file: File): Promise<File> {
  if (!file.type.startsWith('image/')) return file;
  return new Promise((resolve) => {
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      const maxDim = 1600;
      let { width, height } = img;
      if (width > maxDim || height > maxDim) {
        const ratio = Math.min(maxDim / width, maxDim / height);
        width = Math.round(width * ratio);
        height = Math.round(height * ratio);
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve(file);
        return;
      }
      ctx.drawImage(img, 0, 0, width, height);
      const targetType = file.type === 'image/png' ? 'image/jpeg' : file.type;
      canvas.toBlob(
        (blob) => {
          if (!blob || blob.size >= file.size) {
            resolve(file);
            return;
          }
          const ext = targetType === 'image/webp' ? '.webp' : '.jpg';
          const baseName = file.name.replace(/\.[^.]+$/, '');
          resolve(new File([blob], `${baseName}${ext}`, { type: targetType }));
        },
        targetType,
        0.82
      );
    };
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(file);
    };
    img.src = objectUrl;
  });
}

export async function uploadImagesApi(files: File[]): Promise<string[]> {
  if (!(await checkServerReachable())) {
    throw new ApiError('إضافة دراجة تحتاج اتصالًا بالإنترنت', 0, undefined, true);
  }
  const compressed = await Promise.all(files.map(compressImageFile));
  const formData = new FormData();
  for (const f of compressed) {
    formData.append('images', f);
  }
  const data = await requestJson<{ urls: string[] }>('/api/upload/images', {
    method: 'POST',
    body: formData,
  });
  return data.urls;
}

export async function uploadVideoApi(file: File): Promise<string> {
  if (!(await checkServerReachable())) {
    throw new ApiError('إضافة دراجة تحتاج اتصالًا بالإنترنت', 0, undefined, true);
  }
  const formData = new FormData();
  formData.append('video', file);
  const data = await requestJson<{ url: string }>('/api/upload/video', {
    method: 'POST',
    body: formData,
  });
  return data.url;
}

// Public API (caches strictly approved/sold public content for offline browsing)
export async function fetchCategories(): Promise<Category[]> {
  try {
    const data = await requestJson<Category[]>('/api/categories');
    savePublicCategoriesOffline(data);
    return data;
  } catch (err) {
    if (err instanceof ApiError && err.isOffline) {
      const cached = loadPublicOfflineCache();
      if (cached && cached.categories.length > 0) {
        return cached.categories;
      }
      throw new ApiError(
        'يحتاج التطبيق اتصالًا بالإنترنت في المرة الأولى لحفظ الأقسام والتصفح.',
        0,
        undefined,
        true
      );
    }
    throw err;
  }
}

export async function fetchSliders(): Promise<SliderItem[]> {
  try {
    const data = await requestJson<SliderItem[]>('/api/sliders');
    savePublicSlidersOffline(data);
    return data;
  } catch (err) {
    if (err instanceof ApiError && err.isOffline) {
      const cached = loadPublicOfflineCache();
      if (cached) {
        return cached.sliders;
      }
      return [];
    }
    throw err;
  }
}

export interface ListingsQuery {
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

export async function fetchSmartSearch(
  query: ListingsQuery
): Promise<SmartSearchResponse> {
  const params = new URLSearchParams();
  if (query.q?.trim()) params.set('q', query.q.trim());
  if (query.governorate && query.governorate !== 'جميع المحافظات') {
    params.set('governorate', query.governorate);
  }
  if (query.categoryId) params.set('categoryId', String(query.categoryId));
  if (query.minPrice) params.set('minPrice', query.minPrice);
  if (query.maxPrice) params.set('maxPrice', query.maxPrice);
  if (query.sort) params.set('sort', query.sort);
  if (query.hideDemo) params.set('hideDemo', '1');
  if (query.condition) params.set('condition', query.condition);
  if (query.brand) params.set('brand', query.brand);
  if (query.ignoredChips && query.ignoredChips.length > 0) {
    params.set('ignoredChips', query.ignoredChips.join(','));
  }

  const qs = params.toString();
  const isUnfilteredHome =
    !query.q?.trim() &&
    (!query.governorate || query.governorate === 'جميع المحافظات') &&
    !query.categoryId &&
    !query.minPrice &&
    !query.maxPrice &&
    !query.condition &&
    !query.brand &&
    (!query.sort || query.sort === 'newest');

  try {
    const res = await requestJson<SmartSearchResponse>(
      `/api/search${qs ? `?${qs}` : ''}`
    );
    savePublicListingsOffline(res.items, isUnfilteredHome);
    return res;
  } catch (err) {
    if (err instanceof ApiError && err.isOffline) {
      if (hasSavedOfflineBrowseData()) {
        return runOfflineSmartSearch(query);
      }
      throw new ApiError(
        'يحتاج التطبيق اتصالًا بالإنترنت في المرة الأولى لحفظ الواجهة ومحتوى التصفح.',
        0,
        undefined,
        true
      );
    }
    throw err;
  }
}

export async function fetchSearchSuggestions(
  q: string
): Promise<SearchSuggestionResponse> {
  try {
    return await requestJson<SearchSuggestionResponse>(
      `/api/search/suggestions?q=${encodeURIComponent(q)}`
    );
  } catch (err) {
    if (err instanceof ApiError && err.isOffline) {
      return getOfflineSuggestions(q);
    }
    throw err;
  }
}

export function fetchListings(query: ListingsQuery): Promise<Listing[]> {
  const params = new URLSearchParams();
  if (query.q?.trim()) params.set('q', query.q.trim());
  if (query.governorate && query.governorate !== 'جميع المحافظات') {
    params.set('governorate', query.governorate);
  }
  if (query.categoryId) params.set('categoryId', String(query.categoryId));
  if (query.minPrice) params.set('minPrice', query.minPrice);
  if (query.maxPrice) params.set('maxPrice', query.maxPrice);
  if (query.sort) params.set('sort', query.sort);
  if (query.hideDemo) params.set('hideDemo', '1');

  const qs = params.toString();
  return requestJson<Listing[]>(`/api/listings${qs ? `?${qs}` : ''}`);
}

export async function fetchListingById(
  id: number,
  ownerToken?: string
): Promise<{ listing: Listing; isOwner: boolean; fromOfflineCache?: boolean }> {
  const headers: Record<string, string> = {};
  if (ownerToken) headers['X-Owner-Token'] = ownerToken;
  try {
    const res = await requestJson<{ listing: Listing; isOwner: boolean }>(
      `/api/listings/${id}`,
      { headers }
    );
    // Only cache publicly approved/sold listings for offline browsing
    if (res.listing.status === 'approved' || res.listing.status === 'sold') {
      savePublicListingDetailOffline(res.listing);
    }
    return { ...res, fromOfflineCache: false };
  } catch (err) {
    if (err instanceof ApiError && err.isOffline) {
      const cached = getCachedListingByIdOffline(id);
      if (cached) {
        return { listing: cached, isOwner: false, fromOfflineCache: true };
      }
      throw new ApiError('هذا المحتوى يحتاج اتصالًا بالإنترنت', 0, undefined, true);
    }
    throw err;
  }
}

export async function createListingApi(payload: {
  title: string;
  brand?: string;
  category_id: number;
  governorate: string;
  area: string;
  model_year: number | null;
  engine_cc?: number | null;
  motor_watts?: number | null;
  condition: 'new' | 'used';
  price_iqd: number;
  negotiable: boolean;
  phone: string;
  description: string;
  keywords?: string;
  images: ListingImage[];
  video_url: string | null;
}): Promise<{ listing: Listing; ownerToken: string; ownerCode: string }> {
  if (!(await checkServerReachable())) {
    throw new ApiError('إضافة دراجة تحتاج اتصالًا بالإنترنت', 0, undefined, true);
  }
  return requestJson('/api/listings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

export function verifyListingOwnerCode(
  id: number,
  ownerCode: string
): Promise<{ ownerToken: string }> {
  return requestJson(`/api/listings/${id}/verify-owner`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ownerCode }),
  });
}

export function updateListingStatus(
  id: number,
  status: 'sold' | 'approved' | 'pending' | 'rejected' | 'hidden',
  auth: { ownerToken?: string } = {}
): Promise<{ listing: Listing }> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (auth.ownerToken) headers['X-Owner-Token'] = auth.ownerToken;
  return requestJson(`/api/listings/${id}/status`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ status }),
  }).then((res: any) => {
    if (status === 'pending' || status === 'rejected' || status === 'hidden') {
      removeListingFromOfflineCache(id);
    } else if (res?.listing && status === 'approved') {
      savePublicListingDetailOffline(res.listing);
    }
    return res;
  });
}

export async function createAdminListingApi(payload: {
  title: string;
  brand: string;
  category_id: number;
  governorate: string;
  area: string;
  model_year: number | null;
  engine_cc?: number | null;
  motor_watts?: number | null;
  condition: 'new' | 'used';
  price_iqd: number;
  negotiable: boolean;
  phone: string;
  description: string;
  keywords?: string;
  images: ListingImage[];
  video_url: string | null;
  status?: string;
}): Promise<{ listing: Listing; ownerToken: string; ownerCode: string }> {
  if (!(await checkServerReachable())) {
    throw new ApiError('إضافة دراجة تحتاج اتصالًا بالإنترنت', 0, undefined, true);
  }
  const res = await requestJson<{ listing: Listing; ownerToken: string; ownerCode: string }>('/api/admin/listings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (res?.listing && res.listing.status === 'approved') {
    savePublicListingDetailOffline(res.listing);
  }
  return res;
}

export function updateListingFields(
  id: number,
  payload: Record<string, any>,
  auth: { ownerToken?: string } = {}
): Promise<{ listing: Listing }> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (auth.ownerToken) headers['X-Owner-Token'] = auth.ownerToken;
  return requestJson(`/api/listings/${id}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify(payload),
  });
}

export function deleteListingApi(
  id: number,
  auth: { ownerToken?: string } = {}
): Promise<{ ok: boolean }> {
  const headers: Record<string, string> = {};
  if (auth.ownerToken) headers['X-Owner-Token'] = auth.ownerToken;
  return requestJson(`/api/listings/${id}`, { method: 'DELETE', headers }).then(
    (res: any) => {
      removeListingFromOfflineCache(id);
      return res;
    }
  );
}

export function submitReportApi(
  listing_id: number,
  reason: string,
  details: string
): Promise<{ ok: boolean }> {
  return requestJson('/api/reports', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ listing_id, reason, details }),
  });
}

// Admin API (strictly online + HttpOnly cookie session + in-memory CSRF token)
export async function fetchAdminAuthStatus(): Promise<{
  authenticated: boolean;
  username: string | null;
  role?: string;
  csrfToken: string | null;
}> {
  const reachable = await checkServerReachable();
  if (!reachable) {
    adminCsrfToken = '';
    return { authenticated: false, username: null, csrfToken: null };
  }
  try {
    const res = await requestJson<{
      authenticated: boolean;
      username: string | null;
      role?: string;
      csrfToken: string | null;
    }>('/api/admin/auth-status');
    adminCsrfToken = res.authenticated && res.csrfToken ? res.csrfToken : '';
    return res;
  } catch {
    adminCsrfToken = '';
    return { authenticated: false, username: null, csrfToken: null };
  }
}

export async function verifyAdminPinApi(pin: string): Promise<{
  authenticated: boolean;
  username: string;
  role: string;
}> {
  if (!(await checkServerReachable())) {
    throw new ApiError('', 0, undefined, true);
  }
  const res = await requestJson<{
    authenticated: boolean;
    username: string;
    role: string;
    csrfToken: string;
  }>('/api/admin/verify-pin', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pin }),
  });
  adminCsrfToken = res.csrfToken || '';
  return {
    authenticated: res.authenticated,
    username: res.username,
    role: res.role,
  };
}

export async function logoutAdminApi(): Promise<{ ok: boolean }> {
  try {
    return await requestJson('/api/admin/logout', {
      method: 'POST',
    });
  } finally {
    adminCsrfToken = '';
    purgeAdminAndSensitiveOfflineCaches();
  }
}

export function fetchAdminListings(status = 'all'): Promise<Listing[]> {
  return requestJson(`/api/admin/listings?status=${encodeURIComponent(status)}`);
}

export function deleteAllDemoListingsApi(): Promise<{ deleted: number }> {
  return requestJson('/api/admin/demo-listings', {
    method: 'DELETE',
  });
}

export function createCategoryApi(payload: {
  name_ar: string;
  image_url: string;
  is_parts_or_accessories: boolean;
  sort_order: number;
}): Promise<Category> {
  return requestJson('/api/admin/categories', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

export function updateCategoryApi(
  id: number,
  payload: Partial<{
    name_ar: string;
    image_url: string;
    is_parts_or_accessories: boolean;
    sort_order: number;
  }>
): Promise<Category> {
  return requestJson(`/api/admin/categories/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

export function deleteCategoryApi(id: number): Promise<{ ok: boolean }> {
  return requestJson(`/api/admin/categories/${id}`, {
    method: 'DELETE',
  });
}

export function fetchAdminSliders(): Promise<SliderItem[]> {
  return requestJson('/api/admin/sliders');
}

export function createSliderApi(payload: {
  title: string;
  subtitle: string;
  image_url: string;
  link_category_id: number | null;
  sort_order: number;
  is_active: boolean;
}): Promise<SliderItem> {
  return requestJson('/api/admin/sliders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

export function updateSliderApi(
  id: number,
  payload: Partial<SliderItem>
): Promise<SliderItem> {
  return requestJson(`/api/admin/sliders/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

export function deleteSliderApi(id: number): Promise<{ ok: boolean }> {
  return requestJson(`/api/admin/sliders/${id}`, {
    method: 'DELETE',
  });
}

export function fetchAdminReports(): Promise<ReportItem[]> {
  return requestJson('/api/admin/reports');
}

export function updateReportStatusApi(
  id: number,
  status: 'open' | 'reviewed' | 'dismissed'
): Promise<{ ok: boolean }> {
  return requestJson(`/api/admin/reports/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status }),
  });
}

export function fetchAdminOverview(
  days: 7 | 30 = 7,
  isBackgroundPoll = false
): Promise<AdminOverview> {
  const headers: Record<string, string> = {};
  if (isBackgroundPoll) {
    headers['X-Background-Poll'] = '1';
  }
  return requestJson(`/api/admin/overview?days=${days}`, { headers });
}

export function searchAdminApi(
  q: string
): Promise<{ listings: Listing[]; categories: Category[] }> {
  return requestJson(`/api/admin/search?q=${encodeURIComponent(q)}`);
}

export function fetchAdminNotifications(): Promise<AdminNotification[]> {
  return requestJson('/api/admin/notifications');
}

export function markNotificationReadApi(id: number): Promise<{ ok: boolean }> {
  return requestJson(`/api/admin/notifications/${id}/read`, {
    method: 'PATCH',
  });
}

export function markAllNotificationsReadApi(): Promise<{ ok: boolean }> {
  return requestJson('/api/admin/notifications/read-all', {
    method: 'POST',
  });
}

export function fetchAdminAuditLogs(): Promise<AdminAuditLog[]> {
  return requestJson('/api/admin/audit-logs');
}

export function fetchAdminSettings(): Promise<Record<string, string>> {
  return requestJson('/api/admin/settings');
}

export function updateAdminSettings(
  payload: Record<string, string>
): Promise<{ ok: boolean }> {
  return requestJson('/api/admin/settings', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

export async function updateAdminPinApi(
  currentPin: string,
  newPin: string
): Promise<{ ok: boolean }> {
  const res = await requestJson<{ ok: boolean; csrfToken?: string }>(
    '/api/admin/settings/pin',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ currentPin, newPin }),
    }
  );
  if (res.csrfToken) {
    adminCsrfToken = res.csrfToken;
  }
  return { ok: res.ok };
}

export function fetchAdminSynonyms(): Promise<{
  synonyms: SearchSynonym[];
  knownBrands: string[];
}> {
  return requestJson('/api/admin/synonyms');
}

export function createAdminSynonym(payload: {
  term: string;
  target_type: 'brand' | 'category' | 'keyword' | 'ambiguous';
  canonical_value: string;
  category_id?: number | null;
  disambiguation_options?: Array<{
    label: string;
    categorySlug?: string;
    brand?: string;
    query?: string;
  }>;
  is_active?: boolean;
  notes?: string;
}): Promise<SearchSynonym> {
  return requestJson('/api/admin/synonyms', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

export function updateAdminSynonym(
  id: number,
  payload: Partial<{
    term: string;
    target_type: 'brand' | 'category' | 'keyword' | 'ambiguous';
    canonical_value: string;
    category_id: number | null;
    disambiguation_options: Array<{
      label: string;
      categorySlug?: string;
      brand?: string;
      query?: string;
    }>;
    is_active: boolean;
    notes: string;
  }>
): Promise<SearchSynonym> {
  return requestJson(`/api/admin/synonyms/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

export function deleteAdminSynonym(id: number): Promise<{ ok: boolean }> {
  return requestJson(`/api/admin/synonyms/${id}`, {
    method: 'DELETE',
  });
}

export async function recordPublicVisitOncePerSession(): Promise<void> {
  try {
    if (typeof navigator !== 'undefined' && !navigator.onLine) return;
    let sid = sessionStorage.getItem(VISIT_SESSION_KEY);
    if (!sid) {
      sid = `${Date.now()}_${Math.random().toString(36).slice(2, 12)}`;
      sessionStorage.setItem(VISIT_SESSION_KEY, sid);
    } else {
      return;
    }
    await fetch('/api/analytics/visit', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: sid }),
    });
  } catch {
    // ignore analytics errors silently
  }
}

// LocalStorage strictly for non-admin user preferences, favorites, drafts, and listing owner tokens
export function getSavedGovernorate(): string {
  try {
    return localStorage.getItem(PREFS_GOV_KEY) || 'جميع المحافظات';
  } catch {
    return 'جميع المحافظات';
  }
}

export function setSavedGovernorate(gov: string): void {
  try {
    localStorage.setItem(PREFS_GOV_KEY, gov);
  } catch {
    // ignore
  }
}

export function getSavedHideDemo(): boolean {
  try {
    return localStorage.getItem(PREFS_HIDE_DEMO_KEY) === '1';
  } catch {
    return false;
  }
}

export function setSavedHideDemo(hide: boolean): void {
  try {
    localStorage.setItem(PREFS_HIDE_DEMO_KEY, hide ? '1' : '0');
  } catch {
    // ignore
  }
}

export function getFavorites(): number[] {
  try {
    const raw = localStorage.getItem(FAVORITES_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function toggleFavoriteLocal(id: number): number[] {
  const current = getFavorites();
  const exists = current.includes(id);
  const next = exists ? current.filter((x) => x !== id) : [...current, id];
  try {
    localStorage.setItem(FAVORITES_KEY, JSON.stringify(next));
  } catch {
    // ignore
  }
  return next;
}

export function loadAddDraft(): AddListingDraft | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function saveAddDraft(draft: AddListingDraft): void {
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
  } catch {
    // ignore
  }
}

export function clearAddDraft(): void {
  try {
    localStorage.removeItem(DRAFT_KEY);
  } catch {
    // ignore
  }
}

export function getMyOwnerships(): SavedOwnership[] {
  try {
    const raw = localStorage.getItem(MY_POSTS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function saveOwnership(entry: SavedOwnership): void {
  const list = getMyOwnerships().filter(
    (item) => item.listingId !== entry.listingId
  );
  list.unshift(entry);
  try {
    localStorage.setItem(MY_POSTS_KEY, JSON.stringify(list.slice(0, 50)));
  } catch {
    // ignore
  }
}

export function getOwnerTokenForListing(listingId: number): string | undefined {
  return getMyOwnerships().find((x) => x.listingId === listingId)?.ownerToken;
}
