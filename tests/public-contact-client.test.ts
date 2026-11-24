import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildPublicContactEndpoint,
  validatePublicContactTarget,
} from '../src/utils/publicContact.ts';

test('public contact endpoint validates IDs and channels before building its path', () => {
  assert.equal(buildPublicContactEndpoint(12, 'call'), '/api/listings/12/contact?channel=call');
  assert.throws(() => buildPublicContactEndpoint(0, 'call'), /Invalid listing id/);
  assert.throws(() => buildPublicContactEndpoint(Number.MAX_SAFE_INTEGER + 1, 'call'), /Invalid listing id/);
});

test('public contact target accepts only valid phone and WhatsApp destinations', () => {
  assert.equal(validatePublicContactTarget('call', 'tel:07701234567'), 'tel:07701234567');
  assert.equal(
    validatePublicContactTarget('whatsapp', 'https://wa.me/9647701234567?text=hello'),
    'https://wa.me/9647701234567?text=hello'
  );
  assert.throws(() => validatePublicContactTarget('call', 'tel:123'), /invalid contact destination/i);
  assert.throws(
    () => validatePublicContactTarget('whatsapp', 'https://evil.example/9647701234567'),
    /invalid contact destination/i
  );
});
