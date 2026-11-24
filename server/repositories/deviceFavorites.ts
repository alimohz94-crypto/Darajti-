import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseServerClient } from '../supabase.ts';

function throwRepositoryError(operation: string, error: { message: string; code?: string }): never {
  throw new Error(`Failed to ${operation}: ${error.message}`);
}

export async function importDeviceFavoritesOnce(
  deviceIdHash: string,
  localListingIds: number[],
  client: SupabaseClient = getSupabaseServerClient()
): Promise<number[]> {
  const { data, error } = await client.rpc('sync_device_favorites', {
    p_device_id_hash: deviceIdHash,
    p_listing_ids: localListingIds,
  });
  if (error) throwRepositoryError('synchronize device favorites', error);
  if (!Array.isArray(data)) throw new Error('Supabase returned no synchronized-favorites result.');
  return data.map((row: { listing_id: number }) => Number(row.listing_id));
}

export async function addDeviceFavorite(
  deviceIdHash: string,
  listingId: number,
  client: SupabaseClient = getSupabaseServerClient()
): Promise<void> {
  const { error } = await client
    .from('device_favorites')
    .upsert(
      { device_id_hash: deviceIdHash, listing_id: listingId },
      { onConflict: 'device_id_hash,listing_id', ignoreDuplicates: true }
    );
  if (error) throwRepositoryError('add device favorite', error);
}

export async function removeDeviceFavorite(
  deviceIdHash: string,
  listingId: number,
  client: SupabaseClient = getSupabaseServerClient()
): Promise<void> {
  const { error } = await client
    .from('device_favorites')
    .delete()
    .eq('device_id_hash', deviceIdHash)
    .eq('listing_id', listingId);
  if (error) throwRepositoryError('remove device favorite', error);
}
