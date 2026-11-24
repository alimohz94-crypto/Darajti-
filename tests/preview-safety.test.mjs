import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createLocalPreviewEnvironment,
  LOCAL_PREVIEW_API_BASE,
} from '../scripts/preview-local.mjs';

test('local preview overrides an external API base with the loopback API', () => {
  const env = createLocalPreviewEnvironment({
    VITE_API_BASE_URL: 'https://production.example.invalid',
    SUPABASE_URL: 'https://supabase.example.invalid',
  });

  assert.equal(env.VITE_API_BASE_URL, 'http://127.0.0.1:3000');
  assert.equal(LOCAL_PREVIEW_API_BASE, env.VITE_API_BASE_URL);
  assert.equal(env.SUPABASE_URL, 'https://supabase.example.invalid');
});
