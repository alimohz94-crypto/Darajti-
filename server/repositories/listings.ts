import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseServerClient } from '../supabase.ts';

const PAGE_SIZE = 1000;
const LISTING_RESPONSE_COLUMNS =
  'id, title, brand, category_id, governorate, area, model_year, engine_cc, motor_watts, condition, price_iqd, negotiable, description, keywords, images_json, video_url, status, is_demo, is_hidden, created_at, updated_at';

function currentDatabaseTimestamp(): string {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

export class ListingsRepositoryError extends Error {
  constructor(
    message: string,
    readonly code?: string
  ) {
    super(message);
    this.name = 'ListingsRepositoryError';
  }
}

export async function searchAdminCategories(
  queryText: string,
  listings: ListingListRecord[],
  client: SupabaseClient = getSupabaseServerClient()
) {
  const { data, error } = await client
    .from('categories')
    .select('*')
    .ilike('name_ar', `%${queryText}%`)
    .order('sort_order', { ascending: true })
    .order('id', { ascending: true });

  if (error) throwRepositoryError('search admin categories', error);
  if (!data) throw new Error('Supabase returned no searched-category result.');

  const countByCategory = new Map<number, number>();
  for (const listing of listings) {
    if (listing.status !== 'rejected') {
      countByCategory.set(listing.category_id, (countByCategory.get(listing.category_id) || 0) + 1);
    }
  }
  return data.map((category) => ({
    ...category,
    is_parts_or_accessories: Boolean(category.is_parts_or_accessories),
    listings_count: countByCategory.get(category.id) || 0,
  }));
}

export interface ListingCategory {
  id: number;
  slug: string;
  name_ar: string;
  is_parts_or_accessories: number;
}

export interface ListingRecord {
  id: number;
  title: string;
  brand: string;
  category_id: number;
  governorate: string;
  area: string;
  model_year: number | null;
  engine_cc: number | null;
  motor_watts: number | null;
  condition: 'new' | 'used';
  price_iqd: number;
  negotiable: number;
  phone: string;
  description: string;
  keywords: string;
  images_json: unknown;
  video_url: string | null;
  status: 'pending' | 'approved' | 'sold' | 'rejected';
  is_demo: number;
  is_hidden: number;
  owner_token_hash?: string;
  owner_code_hash?: string;
  created_at: string;
  updated_at: string;
  category_name?: string;
  category_slug?: string;
  is_parts_or_accessories?: number;
}

export type ListingListRecord = Omit<ListingRecord, 'phone'> & { phone?: string };

export interface ListingSearchData {
  categories: ListingCategory[];
  synonyms: SearchSynonymRecord[];
  listings: ListingListRecord[];
  brands: Array<{ brand: string }>;
}

export interface SearchSynonymRecord {
  id: number;
  term: string;
  normalized_term: string;
  target_type: 'brand' | 'category' | 'keyword' | 'ambiguous';
  canonical_value: string;
  category_id: number | null;
  category_name?: string | null;
  category_slug?: string | null;
  disambiguation_options_json: unknown;
  is_active: number;
  notes: string;
  created_at: string;
  updated_at: string;
}

function throwRepositoryError(operation: string, error: { message: string; code?: string }): never {
  throw new ListingsRepositoryError(`Failed to ${operation}: ${error.message}`, error.code);
}

async function loadCategories(
  client: SupabaseClient
): Promise<ListingCategory[]> {
  const { data, error } = await client
    .from('categories')
    .select('id, slug, name_ar, is_parts_or_accessories')
    .order('sort_order', { ascending: true })
    .order('id', { ascending: true });

  if (error) throwRepositoryError('load listing categories', error);
  if (!data) throw new Error('Supabase returned no listing-category result.');
  return data as ListingCategory[];
}

async function loadAllListings(
  client: SupabaseClient,
  options: {
    statuses?: string[];
    includeHidden?: boolean;
    includeDemo?: boolean;
    includeContact?: boolean;
    orderBy?: 'created_at' | 'id';
    ascending?: boolean;
  } = {}
): Promise<ListingListRecord[]> {
  const rows: ListingListRecord[] = [];
  let start = 0;

  for (;;) {
    let query = client
      .from('listings')
      .select(LISTING_RESPONSE_COLUMNS);
    if (options.statuses) query = query.in('status', options.statuses);
    if (!options.includeHidden) query = query.eq('is_hidden', 0);
    if (!options.includeDemo) query = query.eq('is_demo', 0);

    const { data, error } = await query
      .order(options.orderBy || 'created_at', { ascending: options.ascending ?? false })
      .order('id', { ascending: false })
      .range(start, start + PAGE_SIZE - 1);

    if (error) throwRepositoryError('load listings', error);
    if (!data) throw new Error('Supabase returned no listings result.');
    const page = data as ListingRecord[];
    rows.push(...page);
    if (page.length < PAGE_SIZE) return rows;
    start += PAGE_SIZE;
  }
}

async function attachListingContacts(
  listings: ListingListRecord[],
  client: SupabaseClient
): Promise<ListingListRecord[]> {
  const phoneById = new Map<number, string>();
  const ids = listings.map((listing) => listing.id);

  for (let start = 0; start < ids.length; start += PAGE_SIZE) {
    const { data, error } = await client
      .from('listings')
      .select('id, phone')
      .in('id', ids.slice(start, start + PAGE_SIZE));

    if (error) throwRepositoryError('load listing contact details', error);
    if (!data) throw new Error('Supabase returned no listing-contact result.');
    for (const row of data) phoneById.set(row.id, row.phone);
  }

  return listings.map((listing) => ({
    ...listing,
    phone: phoneById.get(listing.id) || '',
  }));
}

function attachCategories(
  listings: ListingListRecord[],
  categories: ListingCategory[]
): ListingListRecord[] {
  const categoryById = new Map(categories.map((category) => [category.id, category]));
  return listings.flatMap((listing) => {
    const category = categoryById.get(listing.category_id);
    return category
      ? [{
          ...listing,
          category_name: category.name_ar,
          category_slug: category.slug,
          is_parts_or_accessories: category.is_parts_or_accessories,
        }]
      : [];
  });
}

export async function getCategoryForListing(
  id: number,
  client: SupabaseClient = getSupabaseServerClient()
): Promise<ListingCategory | null> {
  const { data, error } = await client
    .from('categories')
    .select('id, slug, name_ar, is_parts_or_accessories')
    .eq('id', id)
    .maybeSingle();

  if (error) throwRepositoryError('load listing category', error);
  return data as ListingCategory | null;
}

export async function listListings(
  options: {
    statuses?: string[];
    includeHidden?: boolean;
    includeDemo?: boolean;
    includeContact?: boolean;
    orderBy?: 'created_at' | 'id';
    ascending?: boolean;
  } = {},
  client: SupabaseClient = getSupabaseServerClient()
): Promise<ListingListRecord[]> {
  const [listings, categories] = await Promise.all([
    loadAllListings(client, options),
    loadCategories(client),
  ]);
  const contactListings = options.includeContact
    ? await attachListingContacts(listings, client)
    : listings;
  return attachCategories(contactListings, categories);
}

export async function getListingById(
  id: number,
  client: SupabaseClient = getSupabaseServerClient()
): Promise<ListingRecord | null> {
  const { data, error } = await client
    .from('listings')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (error) throwRepositoryError('load listing', error);
  if (!data) return null;

  const listing = data as ListingRecord;
  const category = await getCategoryForListing(listing.category_id, client);
  if (!category) throw new Error(`Listing ${id} references a missing category.`);
  return {
    ...listing,
    category_name: category.name_ar,
    category_slug: category.slug,
    is_parts_or_accessories: category.is_parts_or_accessories,
  };
}

export async function getPublicListingContact(
  id: number,
  client: SupabaseClient = getSupabaseServerClient()
): Promise<{ phone: string; title: string; price_iqd: number } | null> {
  const { data, error } = await client
    .from('listings')
    .select('phone, title, price_iqd')
    .eq('id', id)
    .in('status', ['approved', 'sold'])
    .eq('is_hidden', 0)
    .eq('is_demo', 0)
    .maybeSingle();

  if (error) throwRepositoryError('load public listing contact', error);
  return data ?? null;
}

export async function insertListing(
  values: Omit<ListingRecord, 'id' | 'created_at' | 'updated_at' | 'category_name' | 'category_slug' | 'is_parts_or_accessories'>,
  client: SupabaseClient = getSupabaseServerClient()
): Promise<ListingRecord> {
  const { data, error } = await client
    .from('listings')
    .insert(values)
    .select(`${LISTING_RESPONSE_COLUMNS}, phone`)
    .single();

  if (error) throwRepositoryError('create listing', error);
  if (!data) throw new Error('Supabase returned no created listing.');

  const created = data as ListingRecord;
  const category = await getCategoryForListing(created.category_id, client);
  if (!category) throw new Error(`Created listing ${created.id} references a missing category.`);
  return {
    ...created,
    category_name: category.name_ar,
    category_slug: category.slug,
    is_parts_or_accessories: category.is_parts_or_accessories,
  };
}

export async function updateListing(
  id: number,
  values: Partial<ListingRecord>,
  client: SupabaseClient = getSupabaseServerClient()
): Promise<ListingRecord | null> {
  const { data, error } = await client
    .from('listings')
    .update({ ...values, updated_at: currentDatabaseTimestamp() })
    .eq('id', id)
    .select(`${LISTING_RESPONSE_COLUMNS}, phone`)
    .maybeSingle();

  if (error) throwRepositoryError('update listing', error);
  if (!data) return null;

  const updated = data as ListingRecord;
  const category = await getCategoryForListing(updated.category_id, client);
  if (!category) throw new Error(`Updated listing ${id} references a missing category.`);
  return {
    ...updated,
    category_name: category.name_ar,
    category_slug: category.slug,
    is_parts_or_accessories: category.is_parts_or_accessories,
  };
}

export async function deleteListing(
  id: number,
  client: SupabaseClient = getSupabaseServerClient()
): Promise<boolean> {
  const { data, error } = await client
    .from('listings')
    .delete()
    .eq('id', id)
    .select('id');

  if (error) throwRepositoryError('delete listing', error);
  if (!data) throw new Error('Supabase returned no deleted-listing result.');
  return data.length > 0;
}

export async function deleteDemoListings(
  client: SupabaseClient = getSupabaseServerClient()
): Promise<number> {
  const { data, error } = await client
    .from('listings')
    .delete()
    .eq('is_demo', 1)
    .select('id');

  if (error) throwRepositoryError('delete demo listings', error);
  if (!data) throw new Error('Supabase returned no deleted-demo result.');
  return data.length;
}

export async function loadListingSearchData(
  options: { statuses?: string[]; includeDemo?: boolean } = {},
  client: SupabaseClient = getSupabaseServerClient()
): Promise<ListingSearchData> {
  const [categories, synonymsResult, listings] = await Promise.all([
    loadCategories(client),
    client
      .from('search_synonyms')
      .select('*')
      .eq('is_active', 1)
      .order('normalized_term', { ascending: true })
      .order('id', { ascending: true }),
    loadAllListings(client, {
      statuses: options.statuses || ['approved'],
      includeDemo: options.includeDemo ?? false,
    }),
  ]);

  if (synonymsResult.error) throwRepositoryError('load search synonyms', synonymsResult.error);
  if (!synonymsResult.data) throw new Error('Supabase returned no search-synonym result.');

  const synonyms = synonymsResult.data as SearchSynonymRecord[];
  const categoryById = new Map(categories.map((category) => [category.id, category]));
  const enrichedSynonyms = synonyms
    .map((synonym) => {
      const category = synonym.category_id === null ? undefined : categoryById.get(synonym.category_id);
      return {
        ...synonym,
        category_name: category?.name_ar ?? null,
        category_slug: category?.slug ?? null,
      };
    })
    .sort(
      (a, b) =>
        b.normalized_term.length - a.normalized_term.length || a.id - b.id
    );
  const visibleListings = attachCategories(listings, categories);
  const brands = Array.from(
    new Set(visibleListings.filter((listing) => listing.status === 'approved' && listing.brand).map((listing) => listing.brand))
  ).map((brand) => ({ brand }));

  return {
    categories,
    synonyms: enrichedSynonyms,
    listings: visibleListings,
    brands,
  };
}

export async function listManagedSynonyms(
  client: SupabaseClient = getSupabaseServerClient()
): Promise<SearchSynonymRecord[]> {
  const [synonymsResult, categories] = await Promise.all([
    client
      .from('search_synonyms')
      .select('*')
      .order('is_active', { ascending: true })
      .order('id', { ascending: false }),
    loadCategories(client),
  ]);

  if (synonymsResult.error) throwRepositoryError('load managed synonyms', synonymsResult.error);
  if (!synonymsResult.data) throw new Error('Supabase returned no managed-synonym result.');

  const categoryById = new Map(categories.map((category) => [category.id, category]));
  return (synonymsResult.data as SearchSynonymRecord[])
    .map((synonym) => {
      const category = synonym.category_id === null ? undefined : categoryById.get(synonym.category_id);
      return {
        ...synonym,
        category_name: category?.name_ar ?? null,
        category_slug: category?.slug ?? null,
      };
    })
    .sort((a, b) => {
      const aPriority = a.is_active === 0 && a.target_type === 'ambiguous' ? 0 : 1;
      const bPriority = b.is_active === 0 && b.target_type === 'ambiguous' ? 0 : 1;
      return aPriority - bPriority || b.id - a.id;
    });
}

export async function getManagedSynonym(
  id: number,
  client: SupabaseClient = getSupabaseServerClient()
): Promise<SearchSynonymRecord | null> {
  const { data, error } = await client
    .from('search_synonyms')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (error) throwRepositoryError('load managed synonym', error);
  return data as SearchSynonymRecord | null;
}

export async function insertManagedSynonym(
  values: Omit<SearchSynonymRecord, 'id' | 'created_at' | 'updated_at' | 'category_name' | 'category_slug'>,
  client: SupabaseClient = getSupabaseServerClient()
): Promise<SearchSynonymRecord> {
  const { data, error } = await client
    .from('search_synonyms')
    .insert(values)
    .select('*')
    .single();

  if (error) throwRepositoryError('create managed synonym', error);
  if (!data) throw new Error('Supabase returned no created synonym.');
  return data as SearchSynonymRecord;
}

export async function updateManagedSynonym(
  id: number,
  values: Partial<SearchSynonymRecord>,
  client: SupabaseClient = getSupabaseServerClient()
): Promise<SearchSynonymRecord | null> {
  const { data, error } = await client
    .from('search_synonyms')
    .update({
      ...values,
      updated_at: currentDatabaseTimestamp(),
    })
    .eq('id', id)
    .select('*')
    .maybeSingle();

  if (error) throwRepositoryError('update managed synonym', error);
  return data as SearchSynonymRecord | null;
}

export async function deleteManagedSynonym(
  id: number,
  client: SupabaseClient = getSupabaseServerClient()
): Promise<void> {
  const { error } = await client.from('search_synonyms').delete().eq('id', id);
  if (error) throwRepositoryError('delete managed synonym', error);
}

export async function upsertMediaAsset(
  values: {
    filename: string;
    kind: 'images' | 'videos';
    upload_token_hash: string;
    listing_id: number | null;
  },
  client: SupabaseClient = getSupabaseServerClient()
): Promise<void> {
  const { error } = await client.from('media_assets').upsert(values, { onConflict: 'filename' });
  if (error) throwRepositoryError('save listing media metadata', error);
}

export async function associateListingMedia(
  filename: string,
  kind: 'images' | 'videos',
  listingId: number,
  client: SupabaseClient = getSupabaseServerClient()
): Promise<void> {
  const { error } = await client
    .from('media_assets')
    .update({ listing_id: listingId })
    .eq('filename', filename)
    .eq('kind', kind);

  if (error) throwRepositoryError('associate listing media', error);
}

export async function addOwnerMediaGrant(
  tokenHash: string,
  listingId: number,
  client: SupabaseClient = getSupabaseServerClient()
): Promise<void> {
  const { error } = await client
    .from('owner_media_grants')
    .upsert({ token_hash: tokenHash, listing_id: listingId }, { onConflict: 'token_hash,listing_id' });

  if (error) throwRepositoryError('grant listing media access', error);
}

export async function getListingMediaAuthorization(
  filename: string,
  kind: 'images' | 'videos',
  client: SupabaseClient = getSupabaseServerClient()
): Promise<{
  listing_id: number | null;
  upload_token_hash: string;
  status: ListingRecord['status'] | null;
  is_hidden: number | null;
  is_demo: number | null;
  owner_token_hash: string | null;
  is_referenced: boolean;
} | null> {
  const { data, error } = await client
    .from('media_assets')
    .select('filename, kind, listing_id, upload_token_hash')
    .eq('filename', filename)
    .eq('kind', kind)
    .maybeSingle();

  if (error) throwRepositoryError('load listing media metadata', error);
  if (!data) return null;
  if (data.listing_id === null) {
    return {
      listing_id: null,
      upload_token_hash: data.upload_token_hash,
      status: null,
      is_hidden: null,
      is_demo: null,
      owner_token_hash: null,
      is_referenced: false,
    };
  }

  const { data: listing, error: listingError } = await client
    .from('listings')
    .select('status, is_hidden, is_demo, owner_token_hash, images_json, video_url')
    .eq('id', data.listing_id)
    .maybeSingle();

  if (listingError) throwRepositoryError('load listing media owner', listingError);
  const mediaUrl = `/uploads/${kind}/${filename}`;
  let isReferenced = false;
  if (listing && kind === 'videos') {
    isReferenced = listing.video_url === mediaUrl;
  } else if (listing) {
    const images = Array.isArray(listing.images_json)
      ? listing.images_json
      : typeof listing.images_json === 'string'
        ? JSON.parse(listing.images_json || '[]')
        : [];
    isReferenced =
      Array.isArray(images) &&
      images.some((image) => image && typeof image === 'object' && image.url === mediaUrl);
  }

  return {
    listing_id: data.listing_id,
    upload_token_hash: data.upload_token_hash,
    status: listing?.status ?? null,
    is_hidden: listing?.is_hidden ?? null,
    is_demo: listing?.is_demo ?? null,
    owner_token_hash: listing?.owner_token_hash ?? null,
    is_referenced: isReferenced,
  };
}

export async function isPublicListingMedia(
  mediaUrl: string,
  kind: 'images' | 'videos',
  client: SupabaseClient = getSupabaseServerClient()
): Promise<boolean> {
  let start = 0;
  for (;;) {
    const { data, error } = await client
      .from('listings')
      .select('id, images_json, video_url')
      .in('status', ['approved', 'sold'])
      .eq('is_hidden', 0)
      .eq('is_demo', 0)
      .range(start, start + PAGE_SIZE - 1);

    if (error) throwRepositoryError('check public listing media', error);
    if (!data) throw new Error('Supabase returned no public listing-media result.');

    const found = data.some((row) => {
      if (kind === 'videos') return row.video_url === mediaUrl;
      const images = Array.isArray(row.images_json)
        ? row.images_json
        : typeof row.images_json === 'string'
          ? JSON.parse(row.images_json || '[]')
          : [];
      return Array.isArray(images) && images.some((image) => image?.url === mediaUrl);
    });
    if (found) return true;
    if (data.length < PAGE_SIZE) return false;
    start += PAGE_SIZE;
  }
}

export async function ownerHasMediaGrant(
  tokenHash: string,
  listingId: number,
  client: SupabaseClient = getSupabaseServerClient()
): Promise<boolean> {
  const { data, error } = await client
    .from('owner_media_grants')
    .select('listing_id')
    .eq('token_hash', tokenHash)
    .eq('listing_id', listingId)
    .maybeSingle();

  if (error) throwRepositoryError('check listing media grant', error);
  return Boolean(data);
}

export async function insertAdminNotification(
  values: {
    type: string;
    title: string;
    body: string;
    target_section: string;
    target_id: number | null;
  },
  client: SupabaseClient = getSupabaseServerClient()
): Promise<void> {
  const { error } = await client.from('admin_notifications').insert(values);
  if (error) throwRepositoryError('create admin notification', error);
}

export async function listAdminNotifications(
  client: SupabaseClient = getSupabaseServerClient()
) {
  const { data, error } = await client
    .from('admin_notifications')
    .select('*')
    .order('is_read', { ascending: true })
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(100);

  if (error) throwRepositoryError('load admin notifications', error);
  if (!data) throw new Error('Supabase returned no admin-notification result.');
  return data.map((notification) => ({
    ...notification,
    is_read: Boolean(notification.is_read),
  }));
}

export async function markAdminNotificationRead(
  id: number,
  client: SupabaseClient = getSupabaseServerClient()
): Promise<void> {
  const { error } = await client
    .from('admin_notifications')
    .update({ is_read: 1 })
    .eq('id', id);

  if (error) throwRepositoryError('mark admin notification read', error);
}

export async function markAllAdminNotificationsRead(
  client: SupabaseClient = getSupabaseServerClient()
): Promise<void> {
  const { error } = await client
    .from('admin_notifications')
    .update({ is_read: 1 })
    .eq('is_read', 0);

  if (error) throwRepositoryError('mark all admin notifications read', error);
}

export async function createListingReport(
  values: { listing_id: number; reason: string; details: string },
  client: SupabaseClient = getSupabaseServerClient()
): Promise<void> {
  const { data: listing, error: listingError } = await client
    .from('listings')
    .select('id, title, status')
    .eq('id', values.listing_id)
    .in('status', ['approved', 'sold'])
    .maybeSingle();

  if (listingError) throwRepositoryError('validate listing report', listingError);
  if (!listing) throw new ListingsRepositoryError('Listing not found.', 'LISTING_NOT_FOUND');

  const { error } = await client.from('reports').insert(values);
  if (error) throwRepositoryError('create listing report', error);
  await insertAdminNotification({
    type: 'new_report',
    title: `بلاغ جديد على: ${listing.title}`,
    body: values.reason,
    target_section: 'reports',
    target_id: values.listing_id,
  }, client);
}

export async function listAdminReports(
  client: SupabaseClient = getSupabaseServerClient()
) {
  const { data: reports, error } = await client
    .from('reports')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) throwRepositoryError('load admin reports', error);
  if (!reports) throw new Error('Supabase returned no report result.');
  const listingIds = Array.from(new Set(reports.map((report) => report.listing_id)));
  if (listingIds.length === 0) return [];

  const { data: listings, error: listingError } = await client
    .from('listings')
    .select('id, title, status')
    .in('id', listingIds);

  if (listingError) throwRepositoryError('load report listings', listingError);
  if (!listings) throw new Error('Supabase returned no report-listing result.');
  const listingById = new Map(listings.map((listing) => [listing.id, listing]));
  return reports
    .map((report) => ({
      ...report,
      listing_title: listingById.get(report.listing_id)?.title ?? '',
      listing_status: listingById.get(report.listing_id)?.status ?? '',
    }))
    .sort((a, b) => {
      if (a.status === 'open' && b.status !== 'open') return -1;
      if (b.status === 'open' && a.status !== 'open') return 1;
      return String(b.created_at).localeCompare(String(a.created_at));
    });
}

export async function updateListingReportStatus(
  id: number,
  status: 'open' | 'reviewed' | 'dismissed',
  client: SupabaseClient = getSupabaseServerClient()
): Promise<void> {
  const { error } = await client.from('reports').update({ status }).eq('id', id);
  if (error) throwRepositoryError('update listing report', error);
}

export async function getListingOverviewData(
  days: number,
  client: SupabaseClient = getSupabaseServerClient()
) {
  const [listings, categories, reports, notifications] = await Promise.all([
    loadAllListings(client, { includeHidden: true, includeDemo: true }),
    loadCategories(client),
    client.from('reports').select('id, status'),
    client.from('admin_notifications').select('id').eq('is_read', 0),
  ]);

  if (reports.error) throwRepositoryError('count listing reports', reports.error);
  if (notifications.error) throwRepositoryError('count admin notifications', notifications.error);
  if (!reports.data || !notifications.data) {
    throw new Error('Supabase returned incomplete listing-overview data.');
  }

  const activityStart = new Date();
  activityStart.setUTCDate(activityStart.getUTCDate() - days + 1);
  activityStart.setUTCHours(0, 0, 0, 0);
  const activityByDay = new Map<string, number>();
  const distributionByCategory = new Map<number, number>();
  let publishedListings = 0;
  let pendingListings = 0;
  let rejectedListings = 0;

  for (const listing of listings) {
    if (listing.status === 'approved' || listing.status === 'sold') publishedListings++;
    if (listing.status === 'pending') pendingListings++;
    if (listing.status === 'rejected') rejectedListings++;
    if (listing.status !== 'rejected') {
      distributionByCategory.set(
        listing.category_id,
        (distributionByCategory.get(listing.category_id) || 0) + 1
      );
    }
    const rawCreatedAt = String(listing.created_at);
    const createdAt = new Date(
      rawCreatedAt.includes('T')
        ? rawCreatedAt
        : `${rawCreatedAt.replace(' ', 'T')}Z`
    );
    if (!Number.isNaN(createdAt.getTime()) && createdAt >= activityStart) {
      const day = createdAt.toISOString().slice(0, 10);
      activityByDay.set(day, (activityByDay.get(day) || 0) + 1);
    }
  }

  const categoryDistribution = categories.map((category) => ({
    id: category.id,
    name_ar: category.name_ar,
    count: distributionByCategory.get(category.id) || 0,
  }));

  return {
    publishedListings,
    pendingListings,
    rejectedListings,
    totalCategories: categories.length,
    openReports: reports.data.filter((report) => report.status === 'open').length,
    unreadNotifications: notifications.data.length,
    activityByDay,
    categoryDistribution,
  };
}
