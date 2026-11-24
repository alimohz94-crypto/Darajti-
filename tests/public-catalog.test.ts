import assert from 'node:assert/strict';
import test from 'node:test';
import { createClient } from '@supabase/supabase-js';
import {
  categoryHasListings,
  createCategory,
  createSlider,
  deleteCategory,
  deleteSlider,
  getAdminSettings,
  getCategory,
  getSlider,
  isPublicCatalogMediaReference,
  listCatalogAuditLogs,
  getPublicSliderSettings,
  listPublicCategories,
  listAdminSliders,
  listPublicSliders,
  recordCatalogAudit,
  saveAdminSettings,
  updateCategory,
  updateSlider,
} from '../server/repositories/publicCatalog.ts';

const categories = [
  {
    id: 2,
    slug: 'scooters',
    name_ar: 'سكوترات',
    image_url: '/cat/scooters.jpg',
    is_parts_or_accessories: 0,
    sort_order: 2,
  },
  {
    id: 1,
    slug: 'motorcycles',
    name_ar: 'دراجات نارية',
    image_url: '/cat/motorcycles.jpg',
    is_parts_or_accessories: 0,
    sort_order: 1,
  },
];

const listingCategories = [
  { category_id: 1, status: 'approved', is_hidden: 0, is_demo: 0 },
  { category_id: 1, status: 'sold', is_hidden: 0, is_demo: 0 },
  { category_id: 2, status: 'approved', is_hidden: 0, is_demo: 0 },
];

const sliders = [
  {
    id: 3,
    title: 'دراجات',
    subtitle: '',
    image_url: '/uploads/images/slide.jpg',
    link_category_id: null,
    link_url: null,
    sort_order: 1,
    is_active: 1,
  },
];

function createTestClient(options: {
  failTable?: string;
  listingRows?: Array<Record<string, unknown>>;
} = {}) {
  const requests: Array<{ url: URL; range: string | null }> = [];
  const fetchStub: typeof fetch = async (input, init) => {
    const request = input instanceof Request ? input : new Request(input, init);
    const url = new URL(request.url);
    requests.push({ url, range: request.headers.get('range') });
    const table = url.pathname.split('/').pop() || '';

    if (table === options.failTable) {
      return new Response(
        JSON.stringify({
          code: 'TEST_ERROR',
          message: 'query failed',
          details: null,
          hint: null,
        }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    let rows: Array<Record<string, unknown>> =
      table === 'categories'
        ? [...categories].sort((a, b) => a.sort_order - b.sort_order || a.id - b.id)
        : table === 'listings'
          ? [...(options.listingRows || listingCategories)]
          : table === 'sliders'
            ? sliders
            : table === 'admin_settings'
              ? [
                  { key: 'slider_autoplay_enabled', value: '0' },
                  { key: 'slider_interval_ms', value: '99999' },
                ]
              : [];

    if (table === 'listings') {
      const status = url.searchParams.get('status') || '';
      if (status.startsWith('in.(')) {
        const statuses = status.slice(4, -1).split(',');
        rows = rows.filter((row) => statuses.includes(String(row.status)));
      }
      for (const column of ['is_hidden', 'is_demo']) {
        const filter = url.searchParams.get(column);
        if (filter?.startsWith('eq.')) {
          rows = rows.filter((row) => String(row[column]) === filter.slice(3));
        }
      }
      const range = request.headers.get('range');
      if (range) {
        const [start, end] = range.split('-').map(Number);
        rows = rows.slice(start, end + 1);
      } else {
        const offset = Number(url.searchParams.get('offset') || 0);
        const limit = Number(url.searchParams.get('limit') || rows.length);
        rows = rows.slice(offset, offset + limit);
      }
    }

    return new Response(JSON.stringify(rows), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Content-Range': `0-${Math.max(rows.length - 1, 0)}/*`,
      },
    });
  };

  return {
    client: createClient(
      'http://127.0.0.1:54321',
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.signature',
      {
        auth: { persistSession: false },
        global: { fetch: fetchStub },
      }
    ),
    requests,
  };
}

function createCrudTestClient(options: { listingRows?: unknown[]; emptyTables?: string[] } = {}) {
  const requests: Array<{ url: URL; method: string; body: string }> = [];
  const fetchStub: typeof fetch = async (input, init) => {
    const request = input instanceof Request ? input : new Request(input, init);
    const url = new URL(request.url);
    const method = request.method;
    const body = method === 'GET' || method === 'HEAD' ? '' : await request.clone().text();
    requests.push({ url, method, body });

    const table = url.pathname.split('/').pop() || '';
    if (method === 'DELETE') return new Response(null, { status: 204 });

    const parsedBody = body ? JSON.parse(body) : undefined;
    const row =
      table === 'categories'
        ? { id: 11, slug: 'scooters', name_ar: 'سكوترات', image_url: '/cat.jpg', ...parsedBody }
        : table === 'sliders'
          ? {
              id: 21,
              title: 'Featured',
              subtitle: '',
              image_url: '/slide.jpg',
              link_category_id: null,
              link_url: '',
              sort_order: 1,
              is_active: 1,
              ...parsedBody,
            }
          : undefined;
    const matchesImage =
      !url.searchParams.has('image_url') ||
      url.searchParams.get('image_url') === `eq.${row?.image_url}`;
    const matchedRow =
      options.emptyTables?.includes(table) || !matchesImage ? undefined : row;
    const result =
      table === 'listings'
        ? (options.listingRows || [])
        : table === 'admin_settings'
          ? method === 'GET'
            ? [{ key: 'platform_name', value: 'Darajati' }]
            : parsedBody
          : matchedRow;

    if (request.headers.get('accept')?.includes('vnd.pgrst.object+json')) {
      return new Response(JSON.stringify(result), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify(Array.isArray(result) ? result : result ? [result] : []), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  return {
    client: createClient(
      'http://127.0.0.1:54321',
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.signature',
      {
        auth: { persistSession: false },
        global: { fetch: fetchStub },
      }
    ),
    requests,
  };
}

test('category query preserves public response fields and listing counts', async () => {
  const { client, requests } = createTestClient();

  const result = await listPublicCategories(client);

  assert.deepEqual(result, [
    {
      id: 1,
      slug: 'motorcycles',
      name_ar: 'دراجات نارية',
      image_url: '/cat/motorcycles.jpg',
      is_parts_or_accessories: false,
      sort_order: 1,
      listings_count: 2,
    },
    {
      id: 2,
      slug: 'scooters',
      name_ar: 'سكوترات',
      image_url: '/cat/scooters.jpg',
      is_parts_or_accessories: false,
      sort_order: 2,
      listings_count: 1,
    },
  ]);
  const listingsRequest = requests.find(({ url }) =>
    url.pathname.endsWith('/listings')
  );
  assert.equal(listingsRequest?.url.searchParams.get('status'), 'in.(approved,sold)');
  assert.equal(listingsRequest?.url.searchParams.get('is_hidden'), 'eq.0');
  assert.equal(listingsRequest?.url.searchParams.get('is_demo'), 'eq.0');
  assert.equal(listingsRequest?.url.searchParams.get('select'), 'category_id');
});

test('category listing counts exclude hidden and demo rows and page past 1000', async () => {
  const visibleRows = Array.from({ length: 1001 }, () => ({
    category_id: 1,
    status: 'approved',
    is_hidden: 0,
    is_demo: 0,
  }));
  visibleRows.push(
    { category_id: 1, status: 'approved', is_hidden: 1, is_demo: 0 },
    { category_id: 1, status: 'approved', is_hidden: 0, is_demo: 1 }
  );
  const { client, requests } = createTestClient({ listingRows: visibleRows });

  const result = await listPublicCategories(client);
  assert.equal(result[0].listings_count, 1001);
  assert.equal(
    requests.filter(({ url }) => url.pathname.endsWith('/listings')).length,
    2
  );
});

test('slider query returns the existing API shape and active ordering', async () => {
  const { client, requests } = createTestClient();

  assert.deepEqual(await listPublicSliders(client), [
    {
      id: 3,
      title: 'دراجات',
      subtitle: '',
      image_url: '/uploads/images/slide.jpg',
      link_category_id: null,
      link_url: '',
      sort_order: 1,
      is_active: true,
    },
  ]);
  assert.equal(requests[0].url.searchParams.get('is_active'), 'eq.1');
});

test('slider settings retain current defaults and interval bounds', async () => {
  const { client } = createTestClient();

  assert.deepEqual(await getPublicSliderSettings(client), {
    autoplay: false,
    intervalMs: 30000,
  });
});

test('catalog repository surfaces Supabase errors', async () => {
  const { client } = createTestClient({ failTable: 'categories' });

  await assert.rejects(
    listPublicCategories(client),
    /Failed to load categories: query failed/
  );
});

test('category create, read, and update use Supabase rows', async () => {
  const { client, requests } = createCrudTestClient();
  const created = await createCategory(
    {
      slug: 'scooters',
      name_ar: 'سكوترات',
      image_url: '/cat.jpg',
      is_parts_or_accessories: 0,
      sort_order: 2,
    },
    client
  );
  assert.equal(created.id, 11);

  assert.equal((await getCategory(11, client))?.name_ar, 'سكوترات');
  const updated = await updateCategory(
    11,
    {
      name_ar: 'دراجات',
      image_url: '/new-cat.jpg',
      is_parts_or_accessories: 1,
      sort_order: 3,
    },
    client
  );
  assert.equal(updated?.image_url, '/new-cat.jpg');
  assert.deepEqual(requests.map(({ method, url }) => [method, url.pathname.split('/').pop()]), [
    ['POST', 'categories'],
    ['GET', 'categories'],
    ['PATCH', 'categories'],
  ]);
});

test('category deletion checks for linked listings and deletes through Supabase', async () => {
  const { client, requests } = createCrudTestClient();

  assert.equal(await categoryHasListings(11, client), false);
  await deleteCategory(11, client);
  assert.deepEqual(requests.map(({ method, url }) => [method, url.pathname.split('/').pop()]), [
    ['GET', 'listings'],
    ['DELETE', 'categories'],
  ]);
});

test('category deletion is blocked when listings still reference it', async () => {
  const { client } = createCrudTestClient({ listingRows: [{ id: 7 }] });
  assert.equal(await categoryHasListings(11, client), true);
});

test('slider list, create, read, update, and delete use Supabase', async () => {
  const { client, requests } = createCrudTestClient();
  assert.equal((await listAdminSliders(client))[0].is_active, true);
  assert.equal(
    (await createSlider(
      {
        title: 'Featured',
        subtitle: '',
        image_url: '/slide.jpg',
        link_category_id: null,
        link_url: '',
        sort_order: 1,
        is_active: 1,
      },
      client
    )).id,
    21
  );
  assert.equal((await getSlider(21, client))?.title, 'Featured');
  const updated = await updateSlider(
    21,
    {
      title: 'Updated',
      subtitle: 'New',
      image_url: '/new-slide.jpg',
      link_category_id: 11,
      link_url: '',
      sort_order: 2,
      is_active: 0,
    },
    client
  );
  assert.equal(updated?.title, 'Updated');
  await deleteSlider(21, client);
  assert.deepEqual(requests.map(({ method, url }) => [method, url.pathname.split('/').pop()]), [
    ['GET', 'sliders'],
    ['POST', 'sliders'],
    ['GET', 'sliders'],
    ['PATCH', 'sliders'],
    ['DELETE', 'sliders'],
  ]);
});

test('admin settings load and upsert through Supabase while excluding the PIN hash', async () => {
  const { client, requests } = createCrudTestClient();
  assert.deepEqual(await getAdminSettings(client), { platform_name: 'Darajati' });
  await saveAdminSettings(
    { slider_autoplay_enabled: '0', slider_interval_ms: '5000' },
    client
  );

  assert.equal(requests[0].url.searchParams.get('key'), 'neq.admin_pin_hash');
  assert.equal(requests[1].method, 'POST');
  assert.equal(requests[1].url.searchParams.get('on_conflict'), 'key');
  assert.deepEqual(JSON.parse(requests[1].body).map((setting: { key: string }) => setting.key), [
    'slider_autoplay_enabled',
    'slider_interval_ms',
  ]);
});

test('catalog audit events are written to Supabase', async () => {
  const { client, requests } = createCrudTestClient();
  await recordCatalogAudit('category_created', 'admin', '127.0.0.1', 'category', '11', 'Scooters', client);
  assert.equal(requests[0].method, 'POST');
  assert.equal(requests[0].url.pathname.endsWith('/admin_audit_logs'), true);
  assert.equal(JSON.parse(requests[0].body).target_id, '11');
});

test('catalog audit log reads retain the admin API fields and limit', async () => {
  const { client, requests } = createCrudTestClient();
  assert.deepEqual(await listCatalogAuditLogs(client), []);
  assert.equal(requests[0].url.pathname.endsWith('/admin_audit_logs'), true);
  assert.equal(requests[0].url.searchParams.get('limit'), '50');
  assert.equal(
    requests[0].url.searchParams.get('select'),
    'id,event_type,actor,ip_address,target_type,target_id,details,created_at'
  );
});

test('public catalog image checks use only active sliders and category references', async () => {
  const { client, requests } = createCrudTestClient();
  assert.equal(await isPublicCatalogMediaReference('/slide.jpg', client), true);
  assert.deepEqual(
    requests.map(({ url }) => url.pathname.split('/').pop()),
    ['sliders', 'categories']
  );
  assert.equal(requests[0].url.searchParams.get('is_active'), 'eq.1');

  const emptyClient = createCrudTestClient({ emptyTables: ['sliders', 'categories'] });
  assert.equal(
    await isPublicCatalogMediaReference('/not-referenced.jpg', emptyClient.client),
    false
  );
});
