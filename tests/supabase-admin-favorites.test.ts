import assert from 'node:assert/strict';
import test from 'node:test';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  countSiteVisits,
  createAdminSession,
  getAdminPinHash,
  getAdminSessionRecord,
  recordAdminAuthFailure,
  recordSiteVisitOnce,
  saveAdminPinHash,
} from '../server/repositories/adminSecurity.ts';
import {
  addDeviceFavorite,
  importDeviceFavoritesOnce,
  removeDeviceFavorite,
} from '../server/repositories/deviceFavorites.ts';

type MockResult = { data?: unknown; error?: { message: string; code?: string } | null; count?: number | null };

function createMockClient(result: MockResult = {}) {
  const calls: Array<{ method: string; args: unknown[] }> = [];
  const builder: Record<string, unknown> = {};
  const chainMethods = ['select', 'eq', 'update', 'delete', 'insert', 'upsert', 'or', 'neq'];

  for (const method of chainMethods) {
    builder[method] = (...args: unknown[]) => {
      calls.push({ method, args });
      return builder;
    };
  }

  builder.maybeSingle = async () => {
    calls.push({ method: 'maybeSingle', args: [] });
    return { data: result.data ?? null, error: result.error ?? null, count: result.count ?? null };
  };
  builder.then = (resolve: (value: MockResult) => unknown, reject?: (reason: unknown) => unknown) =>
    Promise.resolve({ data: result.data ?? null, error: result.error ?? null, count: result.count ?? null })
      .then(resolve, reject);

  const client = {
    from: (table: string) => {
      calls.push({ method: 'from', args: [table] });
      return builder;
    },
    rpc: (name: string, args: unknown) => {
      calls.push({ method: 'rpc', args: [name, args] });
      return Promise.resolve({ data: result.data ?? null, error: result.error ?? null });
    },
  };
  return { client: client as unknown as SupabaseClient, calls };
}

test('admin session and PIN repositories use Supabase tables', async () => {
  const sessionResult = {
    token_hash: 'hash',
    username: 'admin',
    role: 'admin',
    csrf_token: 'csrf',
    last_activity_at: 1,
    expires_at: 2,
  };
  const sessionMock = createMockClient({ data: sessionResult });
  assert.deepEqual(await getAdminSessionRecord('hash', sessionMock.client), sessionResult);
  assert.deepEqual(sessionMock.calls.slice(0, 3), [
    { method: 'from', args: ['admin_sessions'] },
    { method: 'select', args: ['token_hash, username, role, csrf_token, last_activity_at, expires_at'] },
    { method: 'eq', args: ['token_hash', 'hash'] },
  ]);

  const writeMock = createMockClient();
  await createAdminSession(sessionResult, writeMock.client);
  await saveAdminPinHash('pin-hash', writeMock.client);
  assert.ok(writeMock.calls.some((call) => call.method === 'insert' && call.args[0] === sessionResult));
  assert.ok(writeMock.calls.some((call) => call.method === 'from' && call.args[0] === 'admin_settings'));

  const pinMock = createMockClient({ data: { value: 'stored-hash' } });
  assert.equal(await getAdminPinHash(pinMock.client), 'stored-hash');
});

test('admin authentication failures use the atomic Supabase RPC', async () => {
  const mock = createMockClient({ data: [{ client_key: 'ip-hash', attempt: 2 }] });
  const result = await recordAdminAuthFailure(
    {
      clientKey: 'ip-hash',
      now: 100,
      windowMs: 200,
      maxAttempts: 3,
      maxLockLevel: 4,
      baseLockMinutes: 5,
      maxLockMinutes: 60,
    },
    mock.client
  );
  assert.equal(result.attempt, 2);
  assert.equal(mock.calls[0].method, 'rpc');
  assert.equal(mock.calls[0].args[0], 'record_admin_auth_failure');
});

test('site visit and favorites writes are idempotent and scoped to the device', async () => {
  const visitMock = createMockClient({ data: { session_id: 'visit' } });
  assert.equal(await recordSiteVisitOnce('visit', visitMock.client), true);
  assert.ok(visitMock.calls.some((call) => call.method === 'upsert' && call.args[1] instanceof Object));
  assert.equal(await countSiteVisits(createMockClient({ count: 7 }).client), 7);

  const favoriteMock = createMockClient({ data: [{ listing_id: 8 }, { listing_id: 9 }] });
  assert.deepEqual(await importDeviceFavoritesOnce('device-hash', [8, 9], favoriteMock.client), [8, 9]);
  assert.ok(favoriteMock.calls.some((call) => call.method === 'rpc' && call.args[0] === 'sync_device_favorites'));

  const writeMock = createMockClient();
  await addDeviceFavorite('device-hash', 8, writeMock.client);
  await removeDeviceFavorite('device-hash', 8, writeMock.client);
  assert.ok(writeMock.calls.some((call) => call.method === 'eq' && call.args[0] === 'device_id_hash'));
  assert.ok(writeMock.calls.some((call) => call.method === 'eq' && call.args[0] === 'listing_id'));
});

test('Supabase repository errors are surfaced instead of returning success-shaped fallbacks', async () => {
  const mock = createMockClient({ error: { message: 'database unavailable' } });
  await assert.rejects(getAdminPinHash(mock.client), /Failed to load admin PIN hash: database unavailable/);
  await assert.rejects(addDeviceFavorite('device-hash', 1, mock.client), /Failed to add device favorite/);
});
