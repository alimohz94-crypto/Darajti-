import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createSupabaseServerClient,
  readSupabaseServerConfig,
  type SupabaseServerEnvironment,
} from '../server/supabase.ts';

const serverEnv: SupabaseServerEnvironment = {
  SUPABASE_URL: 'http://127.0.0.1:54321',
  SUPABASE_SECRET_KEY:
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.signature',
};

test('requires a server URL and a non-Vite server secret', () => {
  assert.throws(
    () =>
      readSupabaseServerConfig({
        SUPABASE_URL: serverEnv.SUPABASE_URL,
        VITE_SUPABASE_SECRET_KEY: 'must-not-be-used',
      }),
    /SUPABASE_URL and SUPABASE_SECRET_KEY/
  );
});

test('accepts the server-only secret key configuration', () => {
  assert.deepEqual(readSupabaseServerConfig(serverEnv), {
    url: serverEnv.SUPABASE_URL,
    secretKey: serverEnv.SUPABASE_SECRET_KEY,
  });
});

test('supports the server-side service role variable for existing tooling', () => {
  assert.deepEqual(
    readSupabaseServerConfig({
      SUPABASE_URL: serverEnv.SUPABASE_URL,
      SUPABASE_SERVICE_ROLE_KEY: serverEnv.SUPABASE_SECRET_KEY,
    }),
    {
      url: serverEnv.SUPABASE_URL,
      secretKey: serverEnv.SUPABASE_SECRET_KEY,
    }
  );
});

test('creates a server client without persisted browser auth state', () => {
  const client = createSupabaseServerClient(serverEnv);
  assert.equal(typeof client.from, 'function');
  assert.equal(typeof client.storage.from, 'function');
});
