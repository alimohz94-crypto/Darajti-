import assert from 'node:assert/strict';
import test from 'node:test';
import {
  allowPublicContactRedirect,
  createPublicContactTarget,
} from '../server/publicContact.ts';

test('public contact redirects are rate limited and the limit expires', () => {
  const attempts = new Map<string, { count: number; windowStart: number }>();
  const startedAt = 1_000_000;

  for (let count = 0; count < 20; count++) {
    assert.equal(allowPublicContactRedirect('client', startedAt, attempts), true);
  }
  assert.equal(allowPublicContactRedirect('client', startedAt, attempts), false);
  assert.equal(allowPublicContactRedirect('client', startedAt + 15 * 60 * 1000, attempts), true);
});

test('public contact destinations support call and WhatsApp without exposing phone in listing data', () => {
  const call = createPublicContactTarget('07701234567', 'دراجة', 2500000, 'call');
  const whatsapp = createPublicContactTarget('07701234567', 'دراجة', 2500000, 'whatsapp');

  assert.equal(call, 'tel:07701234567');
  assert.match(whatsapp || '', /^https:\/\/wa\.me\/9647701234567\?text=/);
  assert.equal(createPublicContactTarget('123', 'دراجة', 2500000, 'call'), null);
});
