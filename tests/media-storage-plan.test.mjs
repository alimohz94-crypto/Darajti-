import assert from 'node:assert/strict';
import { copyFile, constants, mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  compareMediaManifests,
  createLocalMediaManifest,
  createMediaReferenceReport,
  getMediaStorageLocation,
  MEDIA_STORAGE_DESIGN,
  runResumableMediaTransfer,
  verifyMediaCopy,
} from '../scripts/media-storage-plan.mjs';

test('Storage design keeps both buckets private and denies direct client CRUD', () => {
  assert.deepEqual(
    MEDIA_STORAGE_DESIGN.buckets.map(({ id, public: isPublic }) => [id, isPublic]),
    [
      ['darajati-images', false],
      ['darajati-videos', false],
    ]
  );
  assert.deepEqual(MEDIA_STORAGE_DESIGN.directClientAccess, {
    roles: ['anon', 'authenticated'],
    select: false,
    insert: false,
    update: false,
    delete: false,
  });
});

test('local Storage migration configures private buckets with bounded media types and sizes', async () => {
  const migration = await readFile(
    new URL('../supabase/migrations/20261124000000_darajati_private_media_buckets.sql', import.meta.url),
    'utf8'
  );
  assert.match(migration, /'darajati-images'[\s\S]*false[\s\S]*8388608/);
  assert.match(migration, /'darajati-videos'[\s\S]*false[\s\S]*36700160/);
  assert.match(migration, /image\/jpeg/);
  assert.match(migration, /video\/mp4/);
  assert.doesNotMatch(migration, /create\s+policy/i);
});

test('media inventory and copy verification detect missing, changed, and extra files', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'darajati-media-plan-'));
  const source = path.join(root, 'source');
  const copy = path.join(root, 'copy');

  try {
    await mkdir(path.join(source, 'images'), { recursive: true });
    await mkdir(path.join(source, 'videos'), { recursive: true });
    await mkdir(path.join(copy, 'images'), { recursive: true });
    await mkdir(path.join(copy, 'videos'), { recursive: true });
    await writeFile(path.join(source, 'images', 'one.jpg'), Buffer.from([1, 2, 3]));
    await writeFile(path.join(source, 'videos', 'two.mp4'), Buffer.from([4, 5, 6]));
    await writeFile(path.join(copy, 'images', 'one.jpg'), Buffer.from([1, 2, 3]));
    await writeFile(path.join(copy, 'videos', 'two.mp4'), Buffer.from([4, 5, 6]));

    const manifest = await createLocalMediaManifest(source);
    assert.equal(manifest.length, 2);
    assert.equal(manifest[0].sha256.length, 64);
    assert.equal((await verifyMediaCopy(source, copy)).ok, true);

    await writeFile(path.join(copy, 'videos', 'two.mp4'), Buffer.from([6, 5, 4]));
    await writeFile(path.join(copy, 'images', 'extra.webp'), Buffer.from([7]));
    const alteredCopy = await createLocalMediaManifest(copy);
    const result = compareMediaManifests(manifest, alteredCopy);
    assert.deepEqual(result, {
      ok: false,
      missing: [],
      unexpected: ['images/extra.webp'],
      changed: ['videos/two.mp4'],
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('media inventory rejects unsupported files instead of omitting them', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'darajati-media-invalid-'));
  try {
    await mkdir(path.join(root, 'images'), { recursive: true });
    await writeFile(path.join(root, 'images', 'unexpected.gif'), Buffer.from([1]));
    await assert.rejects(createLocalMediaManifest(root), /Unsupported images file extension/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('reference report maps listing and catalog URLs to private storage while preserving served URLs', () => {
  const manifest = [
    { kind: 'images', objectPath: 'images/listing.jpg', sizeBytes: 10, sha256: 'a'.repeat(64) },
    { kind: 'videos', objectPath: 'videos/listing.mp4', sizeBytes: 20, sha256: 'b'.repeat(64) },
  ];
  const report = createMediaReferenceReport({
    manifest,
    listings: [
      {
        id: 8,
        images_json: JSON.stringify([
          { url: '/uploads/images/listing.jpg', isCover: true },
          { url: '/src/assets/images/bundled.jpg', isCover: false },
          { url: '/uploads/images/missing.jpg', isCover: false },
        ]),
        video_url: '/uploads/videos/listing.mp4',
      },
      { id: 9, images_json: '[]', video_url: null },
    ],
    categories: [{ id: 3, image_url: '/uploads/images/listing.jpg' }],
    sliders: [{ id: 2, image_url: '/src/assets/images/banner.jpg' }],
    mediaAssets: [{ filename: 'listing.jpg', kind: 'images', listing_id: 8 }],
  });

  assert.equal(report.listings.length, 2);
  assert.equal(report.listings[0].media[0].newStoragePath, 'darajati-images/listing.jpg');
  assert.equal(report.listings[0].media[0].servedUrl, '/uploads/images/listing.jpg');
  assert.equal(report.listings[0].media[1].source, 'bundled-static');
  assert.equal(report.listings[0].media[2].source, 'missing-upload');
  assert.equal(report.listings[1].media.length, 0);
  assert.equal(report.categories[0].media[0].source, 'upload');
  assert.equal(report.sliders[0].media[0].source, 'bundled-static');
  assert.equal(report.mediaAssets[0].listingId, 8);
  assert.equal(report.missingFiles.length, 1);
  assert.equal(report.files[0].referencedBy.some((ref) => ref.entity === 'listing' && ref.id === 8), true);
  assert.deepEqual(getMediaStorageLocation(manifest[1]), {
    oldLocalPath: 'uploads/videos/listing.mp4',
    oldUrl: '/uploads/videos/listing.mp4',
    bucketId: 'darajati-videos',
    objectKey: 'listing.mp4',
    newStoragePath: 'darajati-videos/listing.mp4',
    servedUrl: '/uploads/videos/listing.mp4',
  });
});

test('resumable transfer verifies bytes, skips an existing object, and preserves the source', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'darajati-resume-'));
  const source = path.join(root, 'uploads');
  const objects = path.join(root, 'storage');
  const checkpointPath = path.join(root, 'state', 'media-transfer.json');
  const references = {
    listings: [{ id: 21, images_json: '[{"url":"/uploads/images/one.jpg"}]' }],
  };
  let uploadCount = 0;
  let failDownload = true;
  const storage = {
    async exists(bucketId, objectKey) {
      try {
        await stat(path.join(objects, bucketId, ...objectKey.split('/')));
        return true;
      } catch (error) {
        if (error.code === 'ENOENT') return false;
        throw error;
      }
    },
    async uploadCreateOnly(bucketId, objectKey, sourcePath) {
      const target = path.join(objects, bucketId, ...objectKey.split('/'));
      await mkdir(path.dirname(target), { recursive: true });
      await copyFile(sourcePath, target, constants.COPYFILE_EXCL);
      uploadCount += 1;
    },
    async downloadToFile(bucketId, objectKey, destinationPath) {
      if (failDownload) {
        failDownload = false;
        throw new Error('simulated interruption after upload');
      }
      const sourcePath = path.join(objects, bucketId, ...objectKey.split('/'));
      await mkdir(path.dirname(destinationPath), { recursive: true });
      await copyFile(sourcePath, destinationPath);
    },
  };

  try {
    await mkdir(path.join(source, 'images'), { recursive: true });
    const sourceFile = path.join(source, 'images', 'one.jpg');
    await writeFile(sourceFile, Buffer.from([1, 2, 3, 4]));
    await assert.rejects(
      runResumableMediaTransfer({ sourceRoot: source, checkpointPath, storage }),
      /simulated interruption/
    );
    assert.equal(uploadCount, 1);
    assert.equal((await stat(sourceFile)).size, 4);

    const resumed = await runResumableMediaTransfer({
      sourceRoot: source,
      checkpointPath,
      storage,
      references,
    });
    assert.equal(resumed.uploaded.length, 0);
    assert.deepEqual(resumed.skipped, ['darajati-images/one.jpg']);
    assert.equal(resumed.verifiedCount, 1);
    assert.equal(uploadCount, 1);
    assert.equal(resumed.referenceReport.listings[0].media[0].newStoragePath, 'darajati-images/one.jpg');
    assert.equal((await stat(sourceFile)).size, 4);

    const repeated = await runResumableMediaTransfer({
      sourceRoot: source,
      checkpointPath,
      storage,
      references,
    });
    assert.equal(repeated.skipped.length, 1);
    assert.equal(uploadCount, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('resumable transfer refuses changed source data and never overwrites a mismatched object', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'darajati-resume-guard-'));
  const source = path.join(root, 'uploads');
  const objects = path.join(root, 'storage');
  const checkpointPath = path.join(root, 'state', 'media-transfer.json');
  let uploadCount = 0;
  const storage = {
    async exists(bucketId, objectKey) {
      try {
        await stat(path.join(objects, bucketId, ...objectKey.split('/')));
        return true;
      } catch (error) {
        if (error.code === 'ENOENT') return false;
        throw error;
      }
    },
    async uploadCreateOnly(bucketId, objectKey, sourcePath) {
      const target = path.join(objects, bucketId, ...objectKey.split('/'));
      await mkdir(path.dirname(target), { recursive: true });
      await copyFile(sourcePath, target, constants.COPYFILE_EXCL);
      uploadCount += 1;
    },
    async downloadToFile(bucketId, objectKey, destinationPath) {
      const sourcePath = path.join(objects, bucketId, ...objectKey.split('/'));
      await mkdir(path.dirname(destinationPath), { recursive: true });
      await copyFile(sourcePath, destinationPath);
    },
  };

  try {
    await mkdir(path.join(source, 'images'), { recursive: true });
    const sourceFile = path.join(source, 'images', 'one.jpg');
    await writeFile(sourceFile, Buffer.from([1, 2, 3]));
    await runResumableMediaTransfer({ sourceRoot: source, checkpointPath, storage });
    await writeFile(sourceFile, Buffer.from([4, 5, 6]));
    await assert.rejects(
      runResumableMediaTransfer({ sourceRoot: source, checkpointPath, storage }),
      /Source media changed since this checkpoint/
    );
    assert.equal(uploadCount, 1);
    assert.equal((await stat(sourceFile)).size, 3);

    const conflictRoot = path.join(root, 'conflict-uploads');
    const conflictCheckpoint = path.join(root, 'state', 'conflict.json');
    await mkdir(path.join(conflictRoot, 'images'), { recursive: true });
    await writeFile(path.join(conflictRoot, 'images', 'two.jpg'), Buffer.from([7, 8, 9]));
    const conflictTarget = path.join(objects, 'darajati-images', 'two.jpg');
    await mkdir(path.dirname(conflictTarget), { recursive: true });
    await writeFile(conflictTarget, Buffer.from([0, 0, 0]));
    await assert.rejects(
      runResumableMediaTransfer({
        sourceRoot: conflictRoot,
        checkpointPath: conflictCheckpoint,
        storage,
      }),
      /failed SHA-256 verification/
    );
    assert.equal(uploadCount, 1);
    assert.deepEqual(await readFile(conflictTarget), Buffer.from([0, 0, 0]));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
