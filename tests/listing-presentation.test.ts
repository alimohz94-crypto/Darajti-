import assert from 'node:assert/strict';
import test from 'node:test';
import { formatListingRow, isPublicListing } from '../server/listingPresentation.ts';
import type { ListingRecord } from '../server/repositories/listings.ts';

const listing: ListingRecord = {
  id: 5,
  title: 'دراجة',
  brand: '',
  category_id: 1,
  governorate: 'بغداد',
  area: '',
  model_year: 2024,
  engine_cc: 150,
  motor_watts: null,
  condition: 'used',
  price_iqd: 500000,
  negotiable: 0,
  phone: '07701234567',
  description: 'وصف الإعلان',
  keywords: '',
  images_json: [],
  video_url: null,
  status: 'approved',
  is_demo: 0,
  is_hidden: 0,
  owner_token_hash: 'owner-token-hash',
  owner_code_hash: 'owner-code-hash',
  created_at: '',
  updated_at: '',
};

test('public listing payload omits phone and owner secrets while explicit contact views retain phone', () => {
  const publicListing = formatListingRow(listing);
  assert.equal('phone' in publicListing, false);
  assert.equal('owner_token_hash' in publicListing, false);
  assert.equal('owner_code_hash' in publicListing, false);
  const ownerListing = formatListingRow(listing, true);
  assert.equal('phone' in ownerListing, true);
  if ('phone' in ownerListing) assert.equal(ownerListing.phone, listing.phone);
});

test('public listing guard rejects pending, hidden, and demo records', () => {
  assert.equal(isPublicListing(listing), true);
  assert.equal(isPublicListing({ ...listing, status: 'pending' }), false);
  assert.equal(isPublicListing({ ...listing, is_hidden: 1 }), false);
  assert.equal(isPublicListing({ ...listing, is_demo: 1 }), false);
});
