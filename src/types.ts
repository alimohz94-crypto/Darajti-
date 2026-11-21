export const IRAQI_GOVERNORATES = [
  'بغداد',
  'البصرة',
  'نينوى',
  'أربيل',
  'النجف',
  'كربلاء',
  'بابل',
  'الأنبار',
  'ديالى',
  'ذي قار',
  'كركوك',
  'صلاح الدين',
  'السليمانية',
  'دهوك',
  'واسط',
  'ميسان',
  'المثنى',
  'القادسية',
] as const;

export type ListingStatus = 'pending' | 'approved' | 'sold' | 'rejected' | 'hidden';
export type ListingCondition = 'new' | 'used';

export interface Category {
  id: number;
  slug: string;
  name_ar: string;
  image_url: string;
  is_parts_or_accessories: boolean;
  sort_order: number;
  listings_count?: number;
}

export interface ListingImage {
  url: string;
  isCover: boolean;
}

export interface Listing {
  id: number;
  title: string;
  brand: string;
  category_id: number;
  category_name: string;
  category_slug: string;
  is_parts_or_accessories: boolean;
  governorate: string;
  area: string;
  model_year: number | null;
  engine_cc: number | null;
  motor_watts: number | null;
  condition: ListingCondition;
  price_iqd: number;
  negotiable: boolean;
  phone: string;
  description: string;
  keywords: string;
  images: ListingImage[];
  video_url: string | null;
  status: ListingStatus;
  is_demo: boolean;
  created_at: string;
  updated_at: string;
  matchTier?: 'exact' | 'synonym' | 'fuzzy';
}

export interface NearListingResult extends Listing {
  differenceNote: string;
}

export interface SmartSearchChip {
  key: string;
  label: string;
  kind:
    | 'category'
    | 'brand'
    | 'governorate'
    | 'condition'
    | 'engine_cc'
    | 'motor_watts'
    | 'price'
    | 'model_year'
    | 'keyword';
  source: 'query' | 'filter';
}

export interface SmartSearchConflict {
  type: 'governorate' | 'category' | 'price';
  message: string;
  pageValue: string;
  queryValue: string;
  suggestedCategoryId?: number | null;
}

export interface SmartSearchClarification {
  term: string;
  message: string;
  options: Array<{
    label: string;
    applyQuery?: string;
    categoryId?: number;
    brand?: string;
  }>;
}

export interface SmartSearchResponse {
  items: Listing[];
  nearResults: NearListingResult[];
  chips: SmartSearchChip[];
  conflicts: SmartSearchConflict[];
  clarifications: SmartSearchClarification[];
  parsedIntent: {
    governorate: string | null;
    categoryIds: number[];
    categoryLabel: string | null;
    brand: string | null;
    condition: 'new' | 'used' | null;
    engineCc: number | null;
    motorWatts: number | null;
    modelYear: number | null;
    minPrice: number | null;
    maxPrice: number | null;
    keywords: string[];
  } | null;
}

export interface SearchSuggestionListing {
  id: number;
  title: string;
  brand: string;
  category_name: string;
  governorate: string;
  price_iqd: number;
  engine_cc: number | null;
  image_url: string | null;
}

export interface SearchSuggestionResponse {
  categories: Category[];
  brands: string[];
  listings: SearchSuggestionListing[];
  clarifications: SmartSearchClarification[];
}

export interface SearchSynonym {
  id: number;
  term: string;
  normalized_term: string;
  target_type: 'brand' | 'category' | 'keyword' | 'ambiguous';
  canonical_value: string;
  category_id: number | null;
  category_name?: string | null;
  category_slug?: string | null;
  disambiguation_options: Array<{
    label: string;
    categorySlug?: string;
    brand?: string;
    query?: string;
  }>;
  is_active: boolean;
  notes: string;
  created_at: string;
  updated_at: string;
}

export interface SliderItem {
  id: number;
  title: string;
  subtitle: string;
  image_url: string;
  link_category_id: number | null;
  sort_order: number;
  is_active: boolean;
}

export interface ReportItem {
  id: number;
  listing_id: number;
  listing_title: string;
  listing_status: ListingStatus;
  reason: string;
  details: string;
  status: 'open' | 'reviewed' | 'dismissed';
  created_at: string;
}

export interface AdminOverview {
  totalVisits: number;
  publishedListings: number;
  pendingListings: number;
  rejectedListings: number;
  totalCategories: number;
  openReports: number;
  unreadNotifications: number;
  activitySeries: Array<{ date: string; label: string; count: number }>;
  categoryDistribution: Array<{ id: number; name_ar: string; count: number }>;
}

export interface AdminNotification {
  id: number;
  type: string;
  title: string;
  body: string;
  target_section: string;
  target_id: number | null;
  is_read: boolean;
  created_at: string;
}

export interface AdminAuditLog {
  id: number;
  event_type: string;
  actor: string;
  ip_address: string;
  target_type: string;
  target_id: string;
  details: string;
  created_at: string;
}

export interface SavedOwnership {
  listingId: number;
  ownerToken: string;
  ownerCode: string;
  title: string;
  createdAt: string;
}

export function formatPriceIQD(price: number): string {
  return new Intl.NumberFormat('en-US').format(Math.max(0, Math.round(price)));
}

export function formatArabicDate(dateStr: string): string {
  try {
    const date = new Date(dateStr.includes('T') ? dateStr : `${dateStr}Z`);
    return new Intl.DateTimeFormat('ar-IQ', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    }).format(date);
  } catch {
    return dateStr;
  }
}

export function normalizeIraqiPhone(input: string): string {
  const arabicDigits = '٠١٢٣٤٥٦٧٨٩';
  const persianDigits = '۰۱۲۳۴۵۶۷۸۹';
  let out = input.trim();
  for (let i = 0; i < 10; i++) {
    out = out.replaceAll(arabicDigits[i], String(i)).replaceAll(persianDigits[i], String(i));
  }
  out = out.replace(/[\s\-()]/g, '');
  if (out.startsWith('+964')) {
    out = '0' + out.slice(4);
  } else if (out.startsWith('00964')) {
    out = '0' + out.slice(5);
  } else if (out.startsWith('964') && out.length >= 13) {
    out = '0' + out.slice(3);
  }
  return out;
}

export function isValidIraqiPhone(input: string): boolean {
  const normalized = normalizeIraqiPhone(input);
  return /^07[3-9]\d{8}$/.test(normalized);
}

export function toWhatsAppInternational(input: string): string {
  const normalized = normalizeIraqiPhone(input);
  if (normalized.startsWith('0')) {
    return `964${normalized.slice(1)}`;
  }
  return `964${normalized}`;
}
