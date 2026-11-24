import assert from 'node:assert/strict';
import test from 'node:test';
import { MEDIA_RUNTIME_CACHING } from '../pwa/mediaCaching.ts';

test('uploaded images and videos always pass through the authorization server', () => {
  assert.equal(MEDIA_RUNTIME_CACHING.handler, 'NetworkOnly');
  assert.equal(MEDIA_RUNTIME_CACHING.urlPattern.test('https://darajati.example/uploads/images/photo.jpg'), true);
  assert.equal(MEDIA_RUNTIME_CACHING.urlPattern.test('https://darajati.example/uploads/videos/clip.mp4'), true);
  assert.equal(MEDIA_RUNTIME_CACHING.urlPattern.test('https://darajati.example/assets/image.jpg'), false);
});
