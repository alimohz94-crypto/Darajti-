import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseServerClient } from '../supabase.ts';

const LISTING_PAGE_SIZE = 1000;

export class CatalogRepositoryError extends Error {
  constructor(
    message: string,
    readonly code?: string
  ) {
    super(message);
    this.name = 'CatalogRepositoryError';
  }
}

export interface CatalogAuditLog {
  id: number;
  event_type: string;
  actor: string;
  ip_address: string;
  target_type: string;
  target_id: string;
  details: string;
  created_at: string;
}

function repositoryError(operation: string, error: { message: string; code?: string }) {
  return new CatalogRepositoryError(
    `Failed to ${operation}: ${error.message}`,
    error.code
  );
}

export async function listPublicCategories(
  client: SupabaseClient = getSupabaseServerClient()
) {
  const { data: categories, error: categoriesError } = await client
    .from('categories')
    .select(
      'id, slug, name_ar, image_url, is_parts_or_accessories, sort_order'
    )
    .order('sort_order', { ascending: true })
    .order('id', { ascending: true });

  if (categoriesError) {
    throw repositoryError('load categories', categoriesError);
  }
  if (!categories) {
    throw new Error('Supabase returned no category result.');
  }

  const listingCategories: Array<{ category_id: number }> = [];
  for (let start = 0; ; start += LISTING_PAGE_SIZE) {
    const { data, error } = await client
      .from('listings')
      .select('category_id')
      .in('status', ['approved', 'sold'])
      .eq('is_hidden', 0)
      .eq('is_demo', 0)
      .order('id', { ascending: true })
      .range(start, start + LISTING_PAGE_SIZE - 1);

    if (error) throw repositoryError('count category listings', error);
    if (!data) {
      throw new Error('Supabase returned no category listing-count result.');
    }
    listingCategories.push(...data);
    if (data.length < LISTING_PAGE_SIZE) break;
  }

  const listingsByCategory = new Map<number, number>();
  for (const listing of listingCategories) {
    listingsByCategory.set(
      listing.category_id,
      (listingsByCategory.get(listing.category_id) || 0) + 1
    );
  }

  return categories.map((category) => ({
    id: category.id,
    slug: category.slug,
    name_ar: category.name_ar,
    image_url: category.image_url,
    is_parts_or_accessories: Boolean(category.is_parts_or_accessories),
    sort_order: category.sort_order,
    listings_count: listingsByCategory.get(category.id) || 0,
  }));
}

export async function listPublicSliders(
  client: SupabaseClient = getSupabaseServerClient()
) {
  const { data, error } = await client
    .from('sliders')
    .select(
      'id, title, subtitle, image_url, link_category_id, link_url, sort_order, is_active'
    )
    .eq('is_active', 1)
    .order('sort_order', { ascending: true })
    .order('id', { ascending: true });

  if (error) {
    throw repositoryError('load sliders', error);
  }
  if (!data) {
    throw new Error('Supabase returned no slider result.');
  }

  return data.map((slider) => ({
    id: slider.id,
    title: slider.title,
    subtitle: slider.subtitle,
    image_url: slider.image_url,
    link_category_id: slider.link_category_id ?? null,
    link_url: slider.link_url || '',
    sort_order: slider.sort_order,
    is_active: Boolean(slider.is_active),
  }));
}

export async function isPublicCatalogMediaReference(
  imageUrl: string,
  client: SupabaseClient = getSupabaseServerClient()
): Promise<boolean> {
  const [sliderResult, categoryResult] = await Promise.all([
    client
      .from('sliders')
      .select('id')
      .eq('image_url', imageUrl)
      .eq('is_active', 1)
      .limit(1),
    client.from('categories').select('id').eq('image_url', imageUrl).limit(1),
  ]);

  if (sliderResult.error) throw repositoryError('check public slider media', sliderResult.error);
  if (categoryResult.error) throw repositoryError('check public category media', categoryResult.error);
  if (!sliderResult.data || !categoryResult.data) {
    throw new Error('Supabase returned no public catalog-media result.');
  }
  return sliderResult.data.length > 0 || categoryResult.data.length > 0;
}

export async function getPublicSliderSettings(
  client: SupabaseClient = getSupabaseServerClient()
): Promise<{ autoplay: boolean; intervalMs: number }> {
  const { data, error } = await client
    .from('admin_settings')
    .select('key, value')
    .in('key', ['slider_autoplay_enabled', 'slider_interval_ms']);

  if (error) {
    throw repositoryError('load slider settings', error);
  }
  if (!data) {
    throw new Error('Supabase returned no slider-settings result.');
  }

  const settings = new Map(data.map(({ key, value }) => [key, value]));
  const intervalMs = Math.max(
    2000,
    Math.min(30000, Number(settings.get('slider_interval_ms')) || 5500)
  );

  return {
    autoplay: settings.get('slider_autoplay_enabled') !== '0',
    intervalMs,
  };
}

export async function listAdminSliders(
  client: SupabaseClient = getSupabaseServerClient()
) {
  const { data, error } = await client
    .from('sliders')
    .select('*')
    .order('sort_order', { ascending: true })
    .order('id', { ascending: true });

  if (error) throw repositoryError('load admin sliders', error);
  if (!data) throw new Error('Supabase returned no admin-slider result.');

  return data.map((slider) => ({
    ...slider,
    is_active: Boolean(slider.is_active),
  }));
}

export async function createCategory(
  values: {
    slug: string;
    name_ar: string;
    image_url: string;
    is_parts_or_accessories: number;
    sort_order: number;
  },
  client: SupabaseClient = getSupabaseServerClient()
) {
  const { data, error } = await client
    .from('categories')
    .insert(values)
    .select('*')
    .single();

  if (error) throw repositoryError('create category', error);
  if (!data) throw new Error('Supabase returned no created category.');
  return data;
}

export async function getCategory(
  id: number,
  client: SupabaseClient = getSupabaseServerClient()
) {
  const { data, error } = await client
    .from('categories')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (error) throw repositoryError('load category', error);
  return data;
}

export async function updateCategory(
  id: number,
  values: {
    name_ar: string;
    image_url: string;
    is_parts_or_accessories: number;
    sort_order: number;
  },
  client: SupabaseClient = getSupabaseServerClient()
) {
  const { data, error } = await client
    .from('categories')
    .update(values)
    .eq('id', id)
    .select('*')
    .maybeSingle();

  if (error) throw repositoryError('update category', error);
  return data;
}

export async function categoryHasListings(
  id: number,
  client: SupabaseClient = getSupabaseServerClient()
): Promise<boolean> {
  const { data, error } = await client
    .from('listings')
    .select('id')
    .eq('category_id', id)
    .limit(1);

  if (error) throw repositoryError('check category usage', error);
  if (!data) throw new Error('Supabase returned no category-usage result.');
  return data.length > 0;
}

export async function deleteCategory(
  id: number,
  client: SupabaseClient = getSupabaseServerClient()
): Promise<void> {
  const { error } = await client.from('categories').delete().eq('id', id);
  if (error) throw repositoryError('delete category', error);
}

export async function createSlider(
  values: {
    title: string;
    subtitle: string;
    image_url: string;
    link_category_id: number | null;
    link_url: string;
    sort_order: number;
    is_active: number;
  },
  client: SupabaseClient = getSupabaseServerClient()
) {
  const { data, error } = await client
    .from('sliders')
    .insert(values)
    .select('*')
    .single();

  if (error) throw repositoryError('create slider', error);
  if (!data) throw new Error('Supabase returned no created slider.');
  return data;
}

export async function getSlider(
  id: number,
  client: SupabaseClient = getSupabaseServerClient()
) {
  const { data, error } = await client
    .from('sliders')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (error) throw repositoryError('load slider', error);
  return data;
}

export async function updateSlider(
  id: number,
  values: {
    title: string;
    subtitle: string;
    image_url: string;
    link_category_id: number | null;
    link_url: string;
    sort_order: number;
    is_active: number;
  },
  client: SupabaseClient = getSupabaseServerClient()
) {
  const { data, error } = await client
    .from('sliders')
    .update(values)
    .eq('id', id)
    .select('*')
    .maybeSingle();

  if (error) throw repositoryError('update slider', error);
  return data;
}

export async function deleteSlider(
  id: number,
  client: SupabaseClient = getSupabaseServerClient()
): Promise<void> {
  const { error } = await client.from('sliders').delete().eq('id', id);
  if (error) throw repositoryError('delete slider', error);
}

export async function saveAdminSettings(
  values: Record<string, string>,
  client: SupabaseClient = getSupabaseServerClient()
): Promise<void> {
  const rows = Object.entries(values).map(([key, value]) => ({
    key,
    value,
    updated_at: new Date().toISOString(),
  }));
  if (rows.length === 0) return;

  const { error } = await client
    .from('admin_settings')
    .upsert(rows, { onConflict: 'key' });

  if (error) throw repositoryError('save admin settings', error);
}

export async function getAdminSettings(
  client: SupabaseClient = getSupabaseServerClient()
): Promise<Record<string, string>> {
  const { data, error } = await client
    .from('admin_settings')
    .select('key, value')
    .neq('key', 'admin_pin_hash');

  if (error) throw repositoryError('load admin settings', error);
  if (!data) throw new Error('Supabase returned no admin-settings result.');

  return Object.fromEntries(data.map(({ key, value }) => [key, value]));
}

export async function recordCatalogAudit(
  eventType: string,
  actor: string,
  ipAddress: string,
  targetType = '',
  targetId = '',
  details = '',
  client: SupabaseClient = getSupabaseServerClient()
): Promise<void> {
  const { error } = await client.from('admin_audit_logs').insert({
    event_type: eventType.slice(0, 64),
    actor: actor.slice(0, 64),
    ip_address: ipAddress.slice(0, 80),
    target_type: targetType.slice(0, 64),
    target_id: String(targetId).slice(0, 64),
    details: details.slice(0, 300),
  });

  if (error) {
    console.error(`Failed to record ${eventType} audit event: ${error.message}`);
  }
}

export async function listCatalogAuditLogs(
  client: SupabaseClient = getSupabaseServerClient()
): Promise<CatalogAuditLog[]> {
  const { data, error } = await client
    .from('admin_audit_logs')
    .select('id, event_type, actor, ip_address, target_type, target_id, details, created_at')
    .order('id', { ascending: false })
    .limit(50);

  if (error) throw repositoryError('load catalog audit logs', error);
  if (!data) throw new Error('Supabase returned no catalog-audit result.');
  return data as CatalogAuditLog[];
}
