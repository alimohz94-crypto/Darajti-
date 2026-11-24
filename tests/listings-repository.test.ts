import assert from 'node:assert/strict';
import test from 'node:test';
import { createClient } from '@supabase/supabase-js';
import {
  addOwnerMediaGrant,
  associateListingMedia,
  createListingReport,
  deleteDemoListings,
  deleteListing,
  getCategoryForListing,
  getListingById,
  getListingMediaAuthorization,
  getListingOverviewData,
  getPublicListingContact,
  getManagedSynonym,
  insertAdminNotification,
  insertListing,
  insertManagedSynonym,
  isPublicListingMedia,
  listAdminNotifications,
  listAdminReports,
  listManagedSynonyms,
  listListings,
  loadListingSearchData,
  markAdminNotificationRead,
  markAllAdminNotificationsRead,
  ownerHasMediaGrant,
  searchAdminCategories,
  deleteManagedSynonym,
  updateListing,
  updateManagedSynonym,
  updateListingReportStatus,
  upsertMediaAsset,
} from '../server/repositories/listings.ts';
import { runSmartSearch } from '../server/smartSearch.ts';

type MockRow = Record<string, unknown>;

const categoryRow: MockRow = {
  id: 41,
  slug: 'scooters',
  name_ar: 'سكوترات',
  is_parts_or_accessories: 0,
  image_url: '/cat.jpg',
  sort_order: 1,
  created_at: '2026-11-23 03:00:00',
};

function listingRow(overrides: MockRow = {}): MockRow {
  return {
    id: 71,
    title: 'سكوتر كهربائي',
    brand: 'Test',
    category_id: 41,
    governorate: 'بغداد',
    area: '',
    model_year: 2024,
    engine_cc: null,
    motor_watts: 500,
    condition: 'used',
    price_iqd: 500000,
    negotiable: 0,
    phone: '07701234567',
    description: 'وصف مناسب للإعلان',
    keywords: 'كهربائي',
    images_json: [{ url: '/uploads/images/test.jpg', isCover: true }],
    video_url: null,
    status: 'approved',
    is_demo: 0,
    is_hidden: 0,
    owner_token_hash: 'owner-token-hash',
    owner_code_hash: 'owner-code-hash',
    created_at: '2026-11-23 03:00:00',
    updated_at: '2026-11-23 03:00:00',
    ...overrides,
  };
}

function createListingsMock() {
  const tables: Record<string, MockRow[]> = {
    categories: [{ ...categoryRow }],
    listings: [listingRow()],
    search_synonyms: [],
    media_assets: [],
    owner_media_grants: [],
    admin_notifications: [],
    reports: [],
  };
  const requests: Array<{ url: URL; method: string; body: string }> = [];
  let nextId = 100;

  const fetchStub: typeof fetch = async (input, init) => {
    const request = input instanceof Request ? input : new Request(input, init);
    const url = new URL(request.url);
    const method = request.method;
    const body = method === 'GET' || method === 'HEAD' ? '' : await request.clone().text();
    requests.push({ url, method, body });

    const tableName = url.pathname.split('/').pop() || '';
    const table = tables[tableName] || (tables[tableName] = []);
    const values: MockRow[] = body
      ? (Array.isArray(JSON.parse(body)) ? JSON.parse(body) : [JSON.parse(body)])
      : [];
    const matches = (row: MockRow) =>
      Array.from(url.searchParams.entries()).every(([key, filter]) => {
        if (key === 'select' || key === 'order' || key === 'limit' || key === 'offset' || key === 'on_conflict' || key === 'columns') {
          return true;
        }
        if (filter.startsWith('in.(')) {
          return filter.slice(4, -1).split(',').includes(String(row[key]));
        }
        if (filter.startsWith('eq.')) return String(row[key]) === filter.slice(3);
        if (filter.startsWith('neq.')) return String(row[key]) !== filter.slice(4);
        return true;
      });

    let result: MockRow[] = [];
    if (method === 'GET') {
      result = table.filter(matches);
      const rangeHeader = request.headers.get('range');
      if (rangeHeader) {
        const [from, to] = rangeHeader.split('-').map(Number);
        result = result.slice(from, to + 1);
      }
      const limit = Number(url.searchParams.get('limit'));
      if (limit > 0) result = result.slice(0, limit);
    } else if (method === 'POST') {
      result = values.map((value) => {
        const conflictColumn = url.searchParams.get('on_conflict');
        const existing = conflictColumn
          ? table.find((row) =>
              conflictColumn.split(',').every((column) => row[column] === value[column])
            )
          : undefined;
        if (existing) {
          Object.assign(existing, value);
          return existing;
        }
        const inserted = { id: value.id ?? nextId++, ...value };
        table.push(inserted);
        return inserted;
      });
    } else if (method === 'PATCH') {
      const patch = values[0] || {};
      result = table.filter(matches);
      for (const row of result) Object.assign(row, patch);
    } else if (method === 'DELETE') {
      result = table.filter(matches);
      tables[tableName] = table.filter((row) => !matches(row));
    }

    const selectedColumns = url.searchParams.get('select');
    if (selectedColumns && selectedColumns !== '*') {
      const columns = selectedColumns.split(',').map((column) => column.trim());
      result = result.map((row) =>
        Object.fromEntries(columns.filter((column) => column in row).map((column) => [column, row[column]]))
      );
    }

    if (method === 'DELETE' && !request.headers.get('prefer')?.includes('return=representation')) {
      return new Response(null, { status: 204 });
    }

    const wantsObject = request.headers.get('accept')?.includes('vnd.pgrst.object+json');
    const responseData = wantsObject ? result[0] ?? null : result;
    if (wantsObject && result.length === 0) {
      return new Response(
        JSON.stringify({ code: 'PGRST116', message: 'No rows found', details: 'The result contains 0 rows' }),
        { status: 406, headers: { 'Content-Type': 'application/json' } }
      );
    }
    return new Response(JSON.stringify(responseData), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Content-Range': `0-${Math.max(result.length - 1, 0)}/*` },
    });
  };

  const client = createClient(
    'http://127.0.0.1:54321',
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.signature',
    { auth: { persistSession: false }, global: { fetch: fetchStub } }
  );

  return { client, requests, tables };
}

test('a Supabase-only category can be validated and used to create a listing', async () => {
  const { client, requests } = createListingsMock();
  const category = await getCategoryForListing(41, client);
  assert.equal(category?.slug, 'scooters');
  assert.ok(category);

  const created = await insertListing(
    {
      title: 'سكوتر جديد',
      brand: '',
      category_id: category.id,
      governorate: 'بغداد',
      area: '',
      model_year: 2025,
      engine_cc: null,
      motor_watts: 500,
      condition: 'new',
      price_iqd: 600000,
      negotiable: 0,
      phone: '07701234567',
      description: 'وصف الإعلان',
      keywords: '',
      images_json: [{ url: '/uploads/images/test.jpg', isCover: true }],
      video_url: null,
      status: 'pending',
      is_demo: 0,
      is_hidden: 0,
      owner_token_hash: 'hashed-owner-token',
      owner_code_hash: 'hashed-owner-code',
    },
    client
  );

  assert.equal(created.category_id, 41);
  assert.equal(created.category_name, 'سكوترات');
  const insertRequest = requests.find(({ method, url }) => method === 'POST' && url.pathname.endsWith('/listings'));
  assert.equal(JSON.parse(insertRequest!.body).category_id, 41);
});

test('listing reads use Supabase and attach category fields', async () => {
  const { client, requests } = createListingsMock();
  const listing = await getListingById(71, client);
  assert.equal(listing?.category_name, 'سكوترات');
  assert.equal(listing?.owner_token_hash, 'owner-token-hash');
  assert.equal(listing?.owner_code_hash, 'owner-code-hash');

  const rows = await listListings(
    { statuses: ['approved', 'sold'], includeDemo: false },
    client
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].phone, undefined);
  assert.equal(rows[0].owner_token_hash, undefined);
  assert.equal(rows[0].owner_code_hash, undefined);
  const listSelect = requests.find(
    ({ method, url }) => method === 'GET' && url.pathname.endsWith('/listings') && url.searchParams.get('select') !== '*'
  )?.url.searchParams.get('select') || '';
  assert.equal(listSelect.includes('owner_token_hash'), false);
  assert.equal(listSelect.includes('phone'), false);
  assert.equal(requests.some(({ url }) => url.pathname.endsWith('/listings')), true);
});

test('admin listing reads can explicitly include contact details', async () => {
  const { client, requests } = createListingsMock();
  const rows = await listListings(
    { statuses: ['approved'], includeContact: true },
    client
  );
  assert.equal(rows[0].phone, '07701234567');
  const query = requests.find(
    ({ method, url }) =>
      method === 'GET' &&
      url.pathname.endsWith('/listings') &&
      url.searchParams.get('select')?.includes('phone')
  )?.url.searchParams.get('select') || '';
  assert.equal(query.includes('phone'), true);
});

test('admin category search includes listing counts and full category fields', async () => {
  const { client, requests } = createListingsMock();
  const listings = await listListings({ includeHidden: true, includeDemo: true }, client);
  const categories = await searchAdminCategories('سكوتر', listings, client);
  assert.equal(categories[0].created_at, '2026-11-23 03:00:00');
  assert.equal(categories[0].listings_count, 1);
  assert.equal(requests.some(({ url }) => url.searchParams.get('name_ar') === 'ilike.%سكوتر%'), true);
});

test('listing updates persist status and editable fields in Supabase', async () => {
  const { client, requests } = createListingsMock();
  const updated = await updateListing(71, {
    status: 'sold',
    title: 'تم البيع',
    is_hidden: 1,
  }, client);
  assert.equal(updated?.status, 'sold');
  assert.equal(updated?.title, 'تم البيع');
  assert.equal(updated?.is_hidden, 1);
  assert.equal(requests.find(({ method }) => method === 'PATCH')?.url.pathname.endsWith('/listings'), true);
});

test('listing deletion and demo deletion target Supabase listings', async () => {
  const { client, requests, tables } = createListingsMock();
  assert.equal(await deleteListing(71, client), true);
  tables.listings.push(listingRow({ id: 72, is_demo: 1 }));
  assert.equal(await deleteDemoListings(client), 1);
  assert.equal(tables.listings.length, 0);
  assert.deepEqual(requests.filter(({ method }) => method === 'DELETE').map(({ url }) => url.pathname.split('/').pop()), [
    'listings',
    'listings',
  ]);
});

test('search data and smart search read listings, categories, and synonyms from Supabase', async () => {
  const { client } = createListingsMock();
  const searchData = await loadListingSearchData(
    { statuses: ['approved', 'sold'], includeDemo: false },
    client
  );
  const result = runSmartSearch({ q: 'سكوتر', sort: 'newest' }, (row) => row, searchData);
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].category_name, 'سكوترات');
  assert.equal(searchData.listings[0].owner_token_hash, undefined);
});

test('public search excludes inactive synonyms', async () => {
  const { client, requests, tables } = createListingsMock();
  tables.search_synonyms.push(
    {
      id: 1,
      term: 'نشط',
      normalized_term: 'نشط',
      target_type: 'keyword',
      canonical_value: '',
      category_id: null,
      disambiguation_options_json: [],
      is_active: 1,
      notes: '',
      created_at: '',
      updated_at: '',
    },
    {
      id: 2,
      term: 'معطل',
      normalized_term: 'معطل',
      target_type: 'keyword',
      canonical_value: '',
      category_id: null,
      disambiguation_options_json: [],
      is_active: 0,
      notes: '',
      created_at: '',
      updated_at: '',
    }
  );

  const data = await loadListingSearchData({ includeDemo: false }, client);
  assert.deepEqual(data.synonyms.map(({ term }) => term), ['نشط']);
  const synonymQuery = requests.find(({ url }) => url.pathname.endsWith('/search_synonyms'));
  assert.equal(synonymQuery?.url.searchParams.get('is_active'), 'eq.1');
});

test('managed search synonyms can be created, read, updated, listed, and deleted in Supabase', async () => {
  const { client, requests } = createListingsMock();
  const created = await insertManagedSynonym({
    term: 'سكوتر',
    normalized_term: 'سكوتر',
    target_type: 'category',
    canonical_value: 'scooters',
    category_id: 41,
    disambiguation_options_json: [],
    is_active: 1,
    notes: '',
  }, client);
  assert.equal(created.id, 100);
  assert.equal((await getManagedSynonym(created.id, client))?.term, 'سكوتر');
  assert.equal((await listManagedSynonyms(client))[0].category_name, 'سكوترات');
  assert.equal(
    (await updateManagedSynonym(created.id, { term: 'سكوترات' }, client))?.term,
    'سكوترات'
  );
  await deleteManagedSynonym(created.id, client);
  assert.deepEqual(
    requests.filter(({ url }) => url.pathname.endsWith('/search_synonyms')).map(({ method }) => method),
    ['POST', 'GET', 'GET', 'PATCH', 'DELETE']
  );
});

test('media metadata, listing association, and owner grants use Supabase', async () => {
  const { client, requests } = createListingsMock();
  await upsertMediaAsset({
    filename: 'test.jpg',
    kind: 'images',
    upload_token_hash: 'upload-hash',
    listing_id: null,
  }, client);
  await associateListingMedia('test.jpg', 'images', 71, client);
  await addOwnerMediaGrant('owner-cookie-hash', 71, client);
  const media = await getListingMediaAuthorization('test.jpg', 'images', client);
  assert.equal(media?.listing_id, 71);
  assert.equal(media?.owner_token_hash, 'owner-token-hash');
  assert.equal(media?.is_demo, 0);
  assert.equal(media?.is_referenced, true);
  assert.equal(await ownerHasMediaGrant('owner-cookie-hash', 71, client), true);
  assert.ok(requests.some(({ url }) => url.pathname.endsWith('/media_assets')));
  assert.ok(requests.some(({ url }) => url.pathname.endsWith('/owner_media_grants')));
});

test('stale media metadata does not make an unreferenced file public', async () => {
  const { client, tables } = createListingsMock();
  tables.media_assets.push({
    filename: 'removed.jpg',
    kind: 'images',
    listing_id: 71,
    upload_token_hash: 'upload-hash',
  });
  tables.listings[0] = listingRow({ images_json: [] });

  const media = await getListingMediaAuthorization('removed.jpg', 'images', client);
  assert.equal(media?.status, 'approved');
  assert.equal(media?.is_referenced, false);
});

test('public contact lookup only selects live, visible, non-demo listings', async () => {
  const { client, requests, tables } = createListingsMock();
  assert.deepEqual(await getPublicListingContact(71, client), {
    phone: '07701234567',
    title: 'سكوتر كهربائي',
    price_iqd: 500000,
  });
  tables.listings.push(listingRow({ id: 72, is_hidden: 1 }));
  assert.equal(await getPublicListingContact(72, client), null);

  const contactQuery = requests.find(
    ({ url }) =>
      url.pathname.endsWith('/listings') &&
      url.searchParams.get('select')?.includes('phone')
  )?.url;
  assert.equal(contactQuery?.searchParams.get('status'), 'in.(approved,sold)');
  assert.equal(contactQuery?.searchParams.get('is_hidden'), 'eq.0');
  assert.equal(contactQuery?.searchParams.get('is_demo'), 'eq.0');
  assert.equal(contactQuery?.searchParams.get('select'), 'phone,title,price_iqd');
});

test('legacy public listing media references are checked in Supabase when metadata is absent', async () => {
  const { client, requests } = createListingsMock();
  assert.equal(await isPublicListingMedia('/uploads/images/test.jpg', 'images', client), true);
  assert.equal(requests[0].url.pathname.endsWith('/listings'), true);
  assert.equal(requests[0].url.searchParams.get('is_hidden'), 'eq.0');
  assert.equal(await isPublicListingMedia('/uploads/videos/missing.mp4', 'videos', client), false);
});

test('listing reports and report status changes use Supabase', async () => {
  const { client, requests } = createListingsMock();
  await createListingReport({ listing_id: 71, reason: 'duplicate', details: 'details' }, client);
  assert.equal((await listAdminReports(client))[0].listing_title, 'سكوتر كهربائي');
  await updateListingReportStatus(100, 'reviewed', client);
  assert.ok(requests.some(({ url }) => url.pathname.endsWith('/reports')));
  assert.ok(requests.some(({ url }) => url.pathname.endsWith('/admin_notifications')));
});

test('admin notifications and listing overview data use Supabase', async () => {
  const { client, requests } = createListingsMock();
  await insertAdminNotification({
    type: 'new_listing',
    title: 'New listing',
    body: '',
    target_section: 'pending',
    target_id: 71,
  }, client);
  assert.equal((await listAdminNotifications(client)).length, 1);
  await markAdminNotificationRead(100, client);
  await markAllAdminNotificationsRead(client);
  const overview = await getListingOverviewData(7, client);
  assert.equal(overview.pendingListings, 0);
  assert.ok(requests.some(({ url }) => url.pathname.endsWith('/admin_notifications')));
});
