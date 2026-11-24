import assert from 'node:assert/strict';
import test from 'node:test';
import type { Listing } from '../src/types';
import {
  loadPublicOfflineCache,
  savePublicListingDetailOffline,
} from '../src/utils/offlineStore.ts';

const CACHE_KEY = 'darajati_public_cache_v1';

function installLocalStorage() {
  const entries = new Map<string, string>();
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      get length() {
        return entries.size;
      },
      getItem: (key: string) => entries.get(key) ?? null,
      setItem: (key: string, value: string) => entries.set(key, String(value)),
      removeItem: (key: string) => entries.delete(key),
      clear: () => entries.clear(),
      key: (index: number) => Array.from(entries.keys())[index] ?? null,
    },
  });
  return () => {
    if (original) Object.defineProperty(globalThis, 'localStorage', original);
    else Reflect.deleteProperty(globalThis, 'localStorage');
  };
}

const listing: Listing = {
  id: 8,
  title: 'دراجة',
  brand: 'Brand',
  category_id: 1,
  category_name: 'دراجات',
  category_slug: 'bikes',
  is_parts_or_accessories: false,
  governorate: 'بغداد',
  area: '',
  model_year: null,
  engine_cc: null,
  motor_watts: null,
  condition: 'used',
  price_iqd: 1000000,
  negotiable: false,
  phone: '07701234567',
  description: '',
  keywords: '',
  images: [],
  video_url: null,
  status: 'approved',
  is_demo: false,
  is_hidden: false,
  created_at: '',
  updated_at: '',
};

test('offline listing details never persist phone or owner secrets', () => {
  const restore = installLocalStorage();
  try {
    const sensitiveListing = {
      ...listing,
      owner_token_hash: 'owner-secret',
      owner_code_hash: 'code-secret',
    };
    savePublicListingDetailOffline(sensitiveListing);

    const raw = localStorage.getItem(CACHE_KEY) || '';
    assert.doesNotMatch(raw, /07701234567|owner-secret|code-secret|owner_token_hash/);
    const cached = loadPublicOfflineCache();
    assert.equal(cached?.listings[0].phone, undefined);
  } finally {
    restore();
  }
});

test('loading a legacy offline cache strips a previously stored phone', () => {
  const restore = installLocalStorage();
  try {
    localStorage.setItem(
      CACHE_KEY,
      JSON.stringify({
        categories: [],
        sliders: [],
        listings: [{ ...listing, owner_token_hash: 'legacy-secret' }],
        detailIds: [listing.id],
        savedAt: 1,
      })
    );

    const cached = loadPublicOfflineCache();
    assert.equal(cached?.listings[0].phone, undefined);
    assert.equal(JSON.stringify(cached).includes('legacy-secret'), false);
  } finally {
    restore();
  }
});
