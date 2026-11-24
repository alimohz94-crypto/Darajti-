export const SQLITE_TO_SUPABASE_TABLES = [
  { table: 'categories' },
  { table: 'listings', where: ' WHERE is_demo = 0' },
  { table: 'search_synonyms' },
  { table: 'sliders' },
  {
    table: 'reports',
    where: ' WHERE listing_id IN (SELECT id FROM listings WHERE is_demo = 0)',
  },
  {
    table: 'media_assets',
    where: ' WHERE listing_id IS NULL OR listing_id IN (SELECT id FROM listings WHERE is_demo = 0)',
    onConflict: 'filename',
  },
  {
    table: 'owner_media_grants',
    where: ' WHERE listing_id IN (SELECT id FROM listings WHERE is_demo = 0)',
    onConflict: 'token_hash,listing_id',
  },
  // Legacy credentials are isolated: admin_users has no foreign keys or current runtime callers.
  { table: 'admin_users', onConflict: 'id' },
  { table: 'admin_sessions', onConflict: 'token_hash' },
  { table: 'admin_auth_rate_limits', onConflict: 'client_key' },
  { table: 'admin_audit_logs' },
  { table: 'site_visits', onConflict: 'session_id' },
  {
    table: 'admin_notifications',
    where: " WHERE target_section NOT IN ('pending', 'reports') OR target_id IS NULL OR target_id NOT IN (SELECT id FROM listings WHERE is_demo = 1)",
  },
  { table: 'admin_settings', onConflict: 'key' },
];
