import assert from 'node:assert/strict';
import test from 'node:test';
import { getFavorites, setFavoriteOnServer, syncFavoritesToServer } from '../src/utils/api.ts';

class TestStorage {
  private values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

test('local favorites migrate once, and offline changes retry without losing intent', async () => {
  const originalFetch = globalThis.fetch;
  const originalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const storage = new TestStorage();
  storage.setItem('darajati_favorites', '[2,2,3]');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage });
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { onLine: true },
  });

  try {
    const requests: Array<{ url: string; method: string; body: string | null }> = [];
    globalThis.fetch = async (input, init = {}) => {
      const url = String(input);
      const method = String(init.method || 'GET');
      requests.push({ url, method, body: typeof init.body === 'string' ? init.body : null });
      return new Response(JSON.stringify({ favorites: [2, 3], ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    };

    assert.deepEqual(await syncFavoritesToServer(), [2, 3]);
    assert.deepEqual(JSON.parse(requests[0].body || '{}').favorites, [2, 3]);

    globalThis.fetch = async () => {
      throw new Error('offline');
    };
    await assert.rejects(setFavoriteOnServer(4, true));
    assert.deepEqual(JSON.parse(storage.getItem('darajati_favorites_pending') || '[]'), [
      { listingId: 4, favorite: true },
    ]);

    globalThis.fetch = async (input, init = {}) => {
      const url = String(input);
      const method = String(init.method || 'GET');
      requests.push({ url, method, body: typeof init.body === 'string' ? init.body : null });
      return new Response(JSON.stringify({ favorites: [2, 3], ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    };
    assert.deepEqual(await syncFavoritesToServer(), [2, 3, 4]);
    assert.equal(storage.getItem('darajati_favorites_pending'), null);
    assert.deepEqual(getFavorites(), [2, 3, 4]);
    assert.ok(requests.some(({ url, method }) => url === '/api/favorites/4' && method === 'PUT'));
  } finally {
    globalThis.fetch = originalFetch;
    if (originalStorage) Object.defineProperty(globalThis, 'localStorage', originalStorage);
    else Reflect.deleteProperty(globalThis, 'localStorage');
    if (originalNavigator) Object.defineProperty(globalThis, 'navigator', originalNavigator);
    else Reflect.deleteProperty(globalThis, 'navigator');
  }
});
