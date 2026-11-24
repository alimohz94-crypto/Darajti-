export function readMigrationSupabaseConfig(env = process.env) {
  const url = env.SUPABASE_URL?.trim();
  const secretKey =
    env.SUPABASE_SECRET_KEY?.trim() ||
    env.SUPABASE_SERVICE_ROLE_KEY?.trim();

  if (!url || !secretKey) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SECRET_KEY.');
  }

  return { url, secretKey };
}
