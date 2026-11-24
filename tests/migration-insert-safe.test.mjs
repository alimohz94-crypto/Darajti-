import assert from 'node:assert/strict';
import test from 'node:test';
import { insertRowsSafely } from '../scripts/migration-insert-safe.mjs';

function createMock(existingRows = []) {
  const tables = new Map([['items', existingRows]]);
  const inserts = [];
  return {
    inserts,
    from(table) {
      return {
        select() {
          return {
            in: async (column, values) => ({
              data: (tables.get(table) || []).filter((row) => values.includes(row[column])),
              error: null,
            }),
          };
        },
        insert: async (rows) => {
          inserts.push(...rows);
          tables.set(table, [...(tables.get(table) || []), ...rows]);
          return { error: null };
        },
      };
    },
  };
}

test('migration inserts new rows and skips identical rows without updating destination', async () => {
  const supabase = createMock([{ id: 1, title: 'same', metadata: { a: 1, b: 2 } }]);
  const result = await insertRowsSafely(
    supabase,
    'items',
    [
      { id: 1, title: 'same', metadata: { b: 2, a: 1 } },
      { id: 2, title: 'new' },
    ],
    'id'
  );
  assert.deepEqual(result, { inserted: 1, unchanged: 1 });
  assert.deepEqual(supabase.inserts, [{ id: 2, title: 'new' }]);
});

test('migration stops on differing destination data without overwriting it', async () => {
  const supabase = createMock([{ device_hash: 'hash', listing_id: 3, enabled: true }]);
  await assert.rejects(
    insertRowsSafely(
      supabase,
      'items',
      [{ device_hash: 'hash', listing_id: 3, enabled: false }],
      'device_hash,listing_id'
    ),
    /destination conflict/
  );
  assert.deepEqual(supabase.inserts, []);
});

test('migration reports destination read errors instead of proceeding with inserts', async () => {
  const supabase = {
    from() {
      return {
        select() {
          return {
            in: async () => ({ data: null, error: { message: 'unavailable' } }),
          };
        },
        insert: async () => {
          throw new Error('must not insert after failed conflict check');
        },
      };
    },
  };
  await assert.rejects(insertRowsSafely(supabase, 'items', [{ id: 1 }]), /unable to check destination conflicts/);
});
