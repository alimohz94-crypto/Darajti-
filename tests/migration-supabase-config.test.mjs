import assert from 'node:assert/strict';
import test from 'node:test';
import { readMigrationSupabaseConfig } from '../scripts/migration-supabase-config.mjs';

test('migration uses the server-only Supabase URL and secret', () => {
  assert.deepEqual(
    readMigrationSupabaseConfig({
      SUPABASE_URL: ' https://supabase.example.invalid ',
      SUPABASE_SECRET_KEY: ' server-secret ',
      VITE_SUPABASE_URL: 'https://browser.example.invalid',
      VITE_SUPABASE_SECRET_KEY: 'browser-secret',
    }),
    {
      url: 'https://supabase.example.invalid',
      secretKey: 'server-secret',
    }
  );
});

test('migration retains a server-only service role alias for existing operations', () => {
  assert.deepEqual(
    readMigrationSupabaseConfig({
      SUPABASE_URL: 'https://supabase.example.invalid',
      SUPABASE_SERVICE_ROLE_KEY: 'legacy-server-secret',
    }),
    {
      url: 'https://supabase.example.invalid',
      secretKey: 'legacy-server-secret',
    }
  );
});

test('migration does not accept Vite-prefixed configuration', () => {
  assert.throws(
    () => readMigrationSupabaseConfig({
      VITE_SUPABASE_URL: 'https://supabase.example.invalid',
      VITE_SUPABASE_SECRET_KEY: 'browser-secret',
    }),
    /SUPABASE_URL or SUPABASE_SECRET_KEY/
  );
});
