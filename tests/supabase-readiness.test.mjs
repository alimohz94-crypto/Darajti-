import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const read = (file) => readFile(new URL(file, root), 'utf8');

test('base migration grants Express service_role access while revoking browser access', async () => {
  const sql = await read('supabase/migrations/20261123050333_darajati_sqlite_migration.sql');
  const tables = [
    'categories',
    'listings',
    'search_synonyms',
    'sliders',
    'reports',
    'admin_users',
    'admin_sessions',
    'admin_auth_rate_limits',
    'admin_audit_logs',
    'media_assets',
    'owner_media_grants',
    'site_visits',
    'admin_notifications',
    'admin_settings',
  ];

  for (const table of tables) {
    assert.match(sql, new RegExp(`alter table public\\.${table} enable row level security`, 'i'));
    assert.match(
      sql,
      new RegExp(`revoke all on table public\\.${table} from anon, authenticated, public`, 'i')
    );
    assert.match(sql, new RegExp(`grant all on table public\\.${table} to service_role`, 'i'));
  }
  assert.match(sql, /grant select on table public\.public_listings to service_role/i);
  assert.match(sql, /grant usage, select on sequence %s to service_role/i);
  assert.match(sql, /grant select on table public\.public_listings to anon, authenticated/i);
});

test('favorites migration keeps its tables and RPCs server-only', async () => {
  const sql = await read('supabase/migrations/20261123235000_admin_favorites_security.sql');
  for (const table of ['favorite_devices', 'device_favorites']) {
    assert.match(sql, new RegExp(`alter table public\\.${table} enable row level security`, 'i'));
    assert.match(sql, new RegExp(`revoke all on table public\\.${table} from anon, authenticated, public`, 'i'));
    assert.match(sql, new RegExp(`grant all on table public\\.${table} to service_role`, 'i'));
  }
  assert.match(sql, /grant execute on function public\.sync_device_favorites[\s\S]*to service_role/i);
  assert.match(sql, /grant execute on function public\.record_admin_auth_failure[\s\S]*to service_role/i);
});

test('Storage migration requires RLS and blocks until browser-role object policies are reviewed', async () => {
  const sql = await read('supabase/migrations/20261124000000_darajati_private_media_buckets.sql');
  assert.match(sql, /storage\.objects must have row-level security enabled/i);
  assert.match(sql, /anon', 'authenticated'/);
  assert.match(sql, /browser-role policy exists/i);
  assert.match(sql, /raise exception[\s\S]*review storage\.objects browser-role policies/i);
  assert.match(sql, /public = false|public\s*=\s*false/i);
  assert.doesNotMatch(sql, /create\s+policy/i);
});

test('admin_users transfer schema matches the isolated SQLite legacy credential schema', async () => {
  const sqlite = await read('server/db.ts');
  const migration = await read('supabase/migrations/20261123050333_darajati_sqlite_migration.sql');
  const plan = await read('scripts/migration-plan.mjs');
  assert.match(sqlite, /CREATE TABLE IF NOT EXISTS admin_users\s*\(\s*id INTEGER PRIMARY KEY AUTOINCREMENT,\s*username TEXT UNIQUE NOT NULL,\s*password_hash TEXT NOT NULL,\s*created_at TEXT NOT NULL/i);
  assert.match(migration, /create table if not exists public\.admin_users\s*\(\s*id bigserial primary key,\s*username text not null unique,\s*password_hash text not null,\s*created_at text not null/i);
  assert.match(plan, /table: 'admin_users', onConflict: 'id'/);
  assert.doesNotMatch(sqlite.match(/CREATE TABLE IF NOT EXISTS admin_users[\s\S]*?\n    \);/i)?.[0] || '', /REFERENCES/i);
});

test('environment example keeps Storage disabled until buckets and policies are provisioned', async () => {
  const env = await read('.env.example');
  assert.match(env, /^SUPABASE_URL=/m);
  assert.match(env, /^SUPABASE_SECRET_KEY=/m);
  assert.match(env, /^VITE_API_BASE_URL=/m);
  assert.match(env, /^MEDIA_STORAGE_READ_ENABLED=false$/m);
  assert.match(env, /^MEDIA_STORAGE_WRITE_ENABLED=false$/m);
  assert.doesNotMatch(env, /^VITE_(?:SUPABASE_SECRET_KEY|SUPABASE_SERVICE_ROLE_KEY)=/m);
});
