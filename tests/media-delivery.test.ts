import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  createMediaDeliveryHandler,
  isPublicListingMediaAsset,
  type MediaDeliveryRequest,
  type MediaDeliveryResponse,
} from '../server/mediaDelivery.ts';
import {
  createSupabaseMediaStorageRepository,
  isMediaStorageReadEnabled,
  isMediaStorageWriteEnabled,
  type MediaStorageReadResult,
  type MediaStorageRepository,
  type StorageGateway,
} from '../server/repositories/mediaStorage.ts';

class TestResponse implements MediaDeliveryResponse {
  statusCode = 200;
  headers = new Map<string, string>();
  body: Buffer | null = null;
  jsonBody: unknown;
  ended = false;

  setHeader(name: string, value: string | number): this {
    this.headers.set(name.toLowerCase(), String(value));
    return this;
  }

  status(code: number): this {
    this.statusCode = code;
    return this;
  }

  json(body: unknown): this {
    this.jsonBody = body;
    return this;
  }

  send(body: Buffer): this {
    this.body = body;
    return this;
  }

  end(): this {
    this.ended = true;
    return this;
  }
}

function request(
  kind: string,
  filename: string,
  options: { range?: string; method?: string } = {}
): MediaDeliveryRequest {
  return {
    params: { kind, filename },
    headers: options.range ? { range: options.range } : {},
    method: options.method || 'GET',
  };
}

function storageReturning(result: MediaStorageReadResult, onDownload = () => {}): MediaStorageRepository {
  return {
    async download() {
      onDownload();
      return result;
    },
    async upload() {},
  };
}

async function withMediaRoot(run: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'darajati-media-delivery-'));
  try {
    await mkdir(path.join(root, 'images'), { recursive: true });
    await mkdir(path.join(root, 'videos'), { recursive: true });
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function invokeHandler(
  rootDir: string,
  storage: MediaStorageRepository,
  req: MediaDeliveryRequest,
  authorize: () => Promise<{ authorized: boolean; isPublic: boolean }>,
  onStorageError?: (error: Error) => void
): Promise<{ response: TestResponse; nextError: unknown }> {
  const response = new TestResponse();
  let nextError: unknown;
  const handler = createMediaDeliveryHandler<MediaDeliveryRequest, TestResponse>({
    rootDir,
    storage,
    authorize,
    onStorageError,
  });
  await handler(req, response, (error) => {
    nextError = error;
  });
  return { response, nextError };
}

test('Storage repository downloads from the private bucket selected by media kind', async () => {
  const buckets: string[] = [];
  const keys: string[] = [];
  const gateway: StorageGateway = {
    from(bucket) {
      buckets.push(bucket);
      return {
        async download(key) {
          keys.push(key);
          return { data: new Blob(['remote image']), error: null };
        },
      };
    },
  };

  const repository = createSupabaseMediaStorageRepository(gateway);
  const result = await repository.download('images', 'image.jpg');
  assert.equal(result.status, 'found');
  if (result.status === 'found') {
    assert.equal(result.object.body.toString(), 'remote image');
  }
  assert.deepEqual(buckets, ['darajati-images']);
  assert.deepEqual(keys, ['image.jpg']);
});

test('Storage repository uploads validated media to kind-specific private buckets without overwriting', async () => {
  const uploads: Array<{ bucket: string; key: string; body: Buffer; options: unknown }> = [];
  const gateway: StorageGateway = {
    from(bucket) {
      return {
        async download() {
          return { data: null, error: null };
        },
        async upload(key, body, options) {
          uploads.push({ bucket, key, body, options });
          return { error: null };
        },
      };
    },
  };
  const repository = createSupabaseMediaStorageRepository(gateway);
  await repository.upload('images', 'image.png', Buffer.from('image'), 'image/png');
  await repository.upload('videos', 'video.mp4', Buffer.from('video'), 'video/mp4');

  assert.deepEqual(uploads.map(({ bucket, key }) => ({ bucket, key })), [
    { bucket: 'darajati-images', key: 'image.png' },
    { bucket: 'darajati-videos', key: 'video.mp4' },
  ]);
  assert.deepEqual(uploads.map(({ options }) => options), [
    { contentType: 'image/png', upsert: false, cacheControl: '0' },
    { contentType: 'video/mp4', upsert: false, cacheControl: '0' },
  ]);
});

test('Storage upload rejects unsafe filenames and mismatched or oversized content', async () => {
  const repository = createSupabaseMediaStorageRepository({
    from: () => ({
      download: async () => ({ data: null, error: null }),
      upload: async () => ({ error: null }),
    }),
  });
  await assert.rejects(repository.upload('images', '../private.jpg', Buffer.from('x'), 'image/jpeg'), /Invalid media filename/);
  await assert.rejects(repository.upload('images', 'image.jpg', Buffer.from('x'), 'video/mp4'), /Invalid media content type/);
  await assert.rejects(
    repository.upload('videos', 'large.mp4', Buffer.alloc(35 * 1024 * 1024 + 1), 'video/mp4'),
    /Media size is outside/
  );
});

test('Storage repository distinguishes missing objects from service failures', async () => {
  const missing = createSupabaseMediaStorageRepository({
    from: () => ({
      download: async () => ({
        data: null,
        error: { statusCode: '404', message: 'Object not found' },
      }),
    }),
  });
  assert.deepEqual(await missing.download('videos', 'missing.mp4'), { status: 'not-found' });

  const unavailable = createSupabaseMediaStorageRepository({
    from: () => ({
      download: async () => ({
        data: null,
        error: { statusCode: '503', message: 'Storage unavailable' },
      }),
    }),
  });
  const result = await unavailable.download('videos', 'clip.mp4');
  assert.equal(result.status, 'unavailable');
});

test('Storage reads can be disabled for a local-only rollback', () => {
  assert.equal(isMediaStorageReadEnabled({ MEDIA_STORAGE_READ_ENABLED: 'false' }), false);
  assert.equal(isMediaStorageReadEnabled({ MEDIA_STORAGE_READ_ENABLED: 'true' }), true);
  assert.equal(isMediaStorageReadEnabled({}), true);
  assert.equal(isMediaStorageWriteEnabled({ MEDIA_STORAGE_WRITE_ENABLED: 'false' }), false);
  assert.equal(isMediaStorageWriteEnabled({ MEDIA_STORAGE_WRITE_ENABLED: 'true' }), true);
  assert.equal(isMediaStorageWriteEnabled({}), true);
});

test('authorized media prefers Storage and returns correct content headers', async () => {
  await withMediaRoot(async (root) => {
    const { response, nextError } = await invokeHandler(
      root,
      storageReturning({ status: 'found', object: { body: Buffer.from('new image') } }),
      request('images', 'photo.jpg'),
      async () => ({ authorized: true, isPublic: true })
    );

    assert.equal(nextError, undefined);
    assert.equal(response.statusCode, 200);
    assert.equal(response.body?.toString(), 'new image');
    assert.equal(response.headers.get('content-type'), 'image/jpeg');
    assert.equal(response.headers.get('content-length'), '9');
    assert.equal(response.headers.get('cache-control'), 'public, max-age=0, must-revalidate');
    assert.equal(response.headers.get('accept-ranges'), 'bytes');
  });
});

test('missing Storage objects fall back to the legacy local file', async () => {
  await withMediaRoot(async (root) => {
    await writeFile(path.join(root, 'videos', 'old.mp4'), 'legacy video');
    const { response, nextError } = await invokeHandler(
      root,
      storageReturning({ status: 'not-found' }),
      request('videos', 'old.mp4'),
      async () => ({ authorized: true, isPublic: false })
    );

    assert.equal(nextError, undefined);
    assert.equal(response.statusCode, 200);
    assert.equal(response.body?.toString(), 'legacy video');
    assert.equal(response.headers.get('content-type'), 'video/mp4');
    assert.equal(response.headers.get('cache-control'), 'no-store, no-cache, must-revalidate, private');
  });
});

test('Storage outages fall back locally, while an unavailable object without a local copy returns 503', async () => {
  await withMediaRoot(async (root) => {
    await writeFile(path.join(root, 'images', 'legacy.png'), 'legacy image');
    const storageError = new Error('test outage');
    let loggedError: Error | undefined;
    const fallback = await invokeHandler(
      root,
      storageReturning({ status: 'unavailable', error: storageError }),
      request('images', 'legacy.png'),
      async () => ({ authorized: true, isPublic: true }),
      (error) => { loggedError = error; }
    );
    assert.equal(fallback.response.statusCode, 200);
    assert.equal(fallback.response.body?.toString(), 'legacy image');
    assert.equal(loggedError, storageError);

    const unavailable = await invokeHandler(
      root,
      storageReturning({ status: 'unavailable', error: storageError }),
      request('images', 'not-local.png'),
      async () => ({ authorized: true, isPublic: true }),
      (error) => { loggedError = error; }
    );
    assert.equal(unavailable.response.statusCode, 503);
    assert.equal(loggedError, storageError);

    const missing = await invokeHandler(
      root,
      storageReturning({ status: 'not-found' }),
      request('images', 'missing.png'),
      async () => ({ authorized: true, isPublic: true })
    );
    assert.equal(missing.response.statusCode, 404);
  });
});

test('unauthorized requests are rejected before Storage or local files are read', async () => {
  await withMediaRoot(async (root) => {
    await writeFile(path.join(root, 'images', 'private.jpg'), 'private bytes');
    let storageReads = 0;
    const { response, nextError } = await invokeHandler(
      root,
      storageReturning({ status: 'found', object: { body: Buffer.from('remote private bytes') } }, () => {
        storageReads += 1;
      }),
      request('images', 'private.jpg'),
      async () => ({ authorized: false, isPublic: false })
    );

    assert.equal(nextError, undefined);
    assert.equal(response.statusCode, 403);
    assert.equal(response.body, null);
    assert.equal(storageReads, 0);
  });
});

test('public access requires a live, referenced, visible, non-demo listing', () => {
  const published = {
    listing_id: 7,
    is_referenced: true,
    status: 'approved',
    is_hidden: 0,
    is_demo: 0,
  };
  assert.equal(isPublicListingMediaAsset(published), true);
  assert.equal(isPublicListingMediaAsset({ ...published, status: 'pending' }), false);
  assert.equal(isPublicListingMediaAsset({ ...published, status: 'rejected' }), false);
  assert.equal(isPublicListingMediaAsset({ ...published, status: null }), false);
  assert.equal(isPublicListingMediaAsset({ ...published, is_hidden: 1 }), false);
  assert.equal(isPublicListingMediaAsset({ ...published, is_demo: 1 }), false);
  assert.equal(isPublicListingMediaAsset({ ...published, is_referenced: false }), false);
  assert.equal(isPublicListingMediaAsset({ ...published, listing_id: null }), false);
});

test('video requests support byte ranges and invalid media types fail before authorization', async () => {
  await withMediaRoot(async (root) => {
    const ranged = await invokeHandler(
      root,
      storageReturning({ status: 'found', object: { body: Buffer.from('0123456789') } }),
      request('videos', 'clip.mp4', { range: 'bytes=2-5' }),
      async () => ({ authorized: true, isPublic: true })
    );
    assert.equal(ranged.response.statusCode, 206);
    assert.equal(ranged.response.body?.toString(), '2345');
    assert.equal(ranged.response.headers.get('content-range'), 'bytes 2-5/10');

    let authorizationCalls = 0;
    const invalid = await invokeHandler(
      root,
      storageReturning({ status: 'not-found' }),
      request('images', 'not-image.mp4'),
      async () => {
        authorizationCalls += 1;
        return { authorized: true, isPublic: true };
      }
    );
    assert.equal(invalid.response.statusCode, 400);
    assert.equal(authorizationCalls, 0);
  });
});

test('HEAD and Range requests cannot bypass authorization', async () => {
  await withMediaRoot(async (root) => {
    let storageReads = 0;
    const storage = storageReturning(
      { status: 'found', object: { body: Buffer.from('private bytes') } },
      () => { storageReads += 1; }
    );

    for (const req of [
      request('images', 'private.jpg', { method: 'HEAD' }),
      request('videos', 'private.mp4', { range: 'bytes=0-4' }),
    ]) {
      const { response, nextError } = await invokeHandler(
        root,
        storage,
        req,
        async () => ({ authorized: false, isPublic: false })
      );
      assert.equal(nextError, undefined);
      assert.equal(response.statusCode, 403);
      assert.equal(response.body, null);
    }

    assert.equal(storageReads, 0);
  });
});

test('authorized HEAD requests return headers without a response body', async () => {
  await withMediaRoot(async (root) => {
    const { response, nextError } = await invokeHandler(
      root,
      storageReturning({ status: 'found', object: { body: Buffer.from('video bytes') } }),
      request('videos', 'clip.mp4', { method: 'HEAD' }),
      async () => ({ authorized: true, isPublic: false })
    );
    assert.equal(nextError, undefined);
    assert.equal(response.statusCode, 200);
    assert.equal(response.body, null);
    assert.equal(response.headers.get('content-length'), '11');
    assert.equal(response.headers.get('cache-control'), 'no-store, no-cache, must-revalidate, private');
    assert.equal(response.ended, true);
  });
});

test('path traversal names are rejected before authorization or storage access', async () => {
  await withMediaRoot(async (root) => {
    let authorizationCalls = 0;
    let storageReads = 0;
    const { response, nextError } = await invokeHandler(
      root,
      storageReturning({ status: 'not-found' }, () => { storageReads += 1; }),
      request('images', '../private.jpg'),
      async () => {
        authorizationCalls += 1;
        return { authorized: true, isPublic: true };
      }
    );
    assert.equal(nextError, undefined);
    assert.equal(response.statusCode, 400);
    assert.equal(authorizationCalls, 0);
    assert.equal(storageReads, 0);
  });
});
