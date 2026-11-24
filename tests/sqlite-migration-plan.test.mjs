import assert from 'node:assert/strict';
import test from 'node:test';
import { SQLITE_TO_SUPABASE_TABLES } from '../scripts/migration-plan.mjs';

test('migration includes the Supabase-owned admin and analytics tables', () => {
  const byTable = new Map(SQLITE_TO_SUPABASE_TABLES.map((entry) => [entry.table, entry]));

  assert.ok(byTable.has('admin_users'));
  assert.ok(byTable.has('admin_notifications'));
  assert.match(byTable.get('admin_notifications')?.where || '', /target_section/);
  assert.match(byTable.get('admin_notifications')?.where || '', /is_demo = 1/);
  assert.equal(byTable.get('admin_sessions')?.onConflict, 'token_hash');
  assert.equal(byTable.get('admin_auth_rate_limits')?.onConflict, 'client_key');
  assert.ok(byTable.has('admin_audit_logs'));
  assert.equal(byTable.get('site_visits')?.onConflict, 'session_id');
  assert.equal(byTable.get('admin_settings')?.onConflict, 'key');
  assert.equal(byTable.get('admin_settings')?.where, undefined);
  assert.equal(byTable.has('favorite_devices'), false);
  assert.equal(byTable.has('device_favorites'), false);
});

test('migration continues excluding demo listings and their dependent rows', () => {
  const byTable = new Map(SQLITE_TO_SUPABASE_TABLES.map((entry) => [entry.table, entry]));
  assert.match(byTable.get('listings')?.where || '', /is_demo = 0/);
  assert.match(byTable.get('reports')?.where || '', /is_demo = 0/);
  assert.match(byTable.get('owner_media_grants')?.where || '', /is_demo = 0/);
  assert.match(byTable.get('media_assets')?.where || '', /is_demo = 0/);
});
