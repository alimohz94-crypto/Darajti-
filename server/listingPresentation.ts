import type { ListingListRecord, ListingRecord } from './repositories/listings.ts';

export function isPublicListing(
  listing: Pick<ListingRecord, 'status' | 'is_hidden' | 'is_demo'>
): boolean {
  return (
    (listing.status === 'approved' || listing.status === 'sold') &&
    listing.is_hidden === 0 &&
    listing.is_demo === 0
  );
}

export function formatListingRow(row: ListingListRecord, includeContact = false) {
  let images: unknown[] = [];
  try {
    images = Array.isArray(row.images_json)
      ? row.images_json
      : JSON.parse(typeof row.images_json === 'string' ? row.images_json || '[]' : '[]');
    if (!Array.isArray(images)) images = [];
  } catch {
    images = [];
  }

  const formatted = {
    id: row.id,
    title: row.title,
    brand: row.brand || '',
    category_id: row.category_id,
    category_name: row.category_name,
    category_slug: row.category_slug,
    is_parts_or_accessories: Boolean(row.is_parts_or_accessories),
    governorate: row.governorate,
    area: row.area || '',
    model_year: row.model_year ?? null,
    engine_cc: row.engine_cc ?? null,
    motor_watts: row.motor_watts ?? null,
    condition: row.condition,
    price_iqd: row.price_iqd,
    negotiable: Boolean(row.negotiable),
    description: row.description,
    keywords: row.keywords || '',
    images,
    video_url: row.video_url || null,
    status: row.status,
    is_demo: Boolean(row.is_demo),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };

  return includeContact ? { ...formatted, phone: row.phone } : formatted;
}
