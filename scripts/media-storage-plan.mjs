import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, mkdir, mkdtemp, open, readFile, readdir, rename, rm, stat, unlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp']);
const VIDEO_EXTENSIONS = new Set(['.mp4', '.webm', '.mov']);

export const MEDIA_STORAGE_DESIGN = {
  buckets: [
    {
      id: 'darajati-images',
      kind: 'images',
      public: false,
      maxFileSizeBytes: 8 * 1024 * 1024,
      allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
    },
    {
      id: 'darajati-videos',
      kind: 'videos',
      public: false,
      maxFileSizeBytes: 35 * 1024 * 1024,
      allowedMimeTypes: ['video/mp4', 'video/webm', 'video/quicktime'],
    },
  ],
  directClientAccess: {
    roles: ['anon', 'authenticated'],
    select: false,
    insert: false,
    update: false,
    delete: false,
  },
  delivery: 'Express authorization proxy at the existing /uploads/:kind/:filename URL',
};

async function hashFile(filePath) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest('hex');
}

async function collectFiles(directory) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }

  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) {
      throw new Error(`Symbolic links are not allowed in media inventory: ${fullPath}`);
    }
    if (entry.isDirectory()) {
      files.push(...(await collectFiles(fullPath)));
    } else if (entry.isFile()) {
      files.push(fullPath);
    } else {
      throw new Error(`Unsupported filesystem entry in media inventory: ${fullPath}`);
    }
  }
  return files;
}

export async function createLocalMediaManifest(root) {
  const absoluteRoot = path.resolve(root);
  const rootInfo = await lstat(absoluteRoot);
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) {
    throw new Error(`Media root must be a real directory: ${absoluteRoot}`);
  }

  const files = [];
  for (const kind of ['images', 'videos']) {
    const kindRoot = path.join(absoluteRoot, kind);
    const kindInfo = await lstat(kindRoot).catch((error) => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
    if (!kindInfo) continue;
    if (!kindInfo.isDirectory() || kindInfo.isSymbolicLink()) {
      throw new Error(`Media kind path must be a real directory: ${kindRoot}`);
    }

    for (const filePath of await collectFiles(kindRoot)) {
      const extension = path.extname(filePath).toLowerCase();
      const supported = kind === 'images' ? IMAGE_EXTENSIONS : VIDEO_EXTENSIONS;
      if (!supported.has(extension)) {
        throw new Error(`Unsupported ${kind} file extension: ${filePath}`);
      }
      const stats = await lstat(filePath);
      const objectPath = path.relative(absoluteRoot, filePath).split(path.sep).join('/');
      files.push({
        kind,
        objectPath,
        sizeBytes: stats.size,
        sha256: await hashFile(filePath),
      });
    }
  }

  return files.sort((left, right) => left.objectPath.localeCompare(right.objectPath));
}

export function getMediaStorageLocation(file) {
  const [kind, ...pathParts] = file.objectPath.split('/');
  if (
    (kind !== 'images' && kind !== 'videos') ||
    pathParts.length === 0 ||
    pathParts.some((part) => !part || part === '.' || part === '..')
  ) {
    throw new Error(`Invalid media object path: ${file.objectPath}`);
  }
  const bucket = MEDIA_STORAGE_DESIGN.buckets.find((candidate) => candidate.kind === kind);
  if (!bucket) throw new Error(`No Storage bucket is configured for ${kind}.`);
  const objectKey = pathParts.join('/');
  const oldUrl = `/uploads/${file.objectPath}`;
  return {
    oldLocalPath: `uploads/${file.objectPath}`,
    oldUrl,
    bucketId: bucket.id,
    objectKey,
    newStoragePath: `${bucket.id}/${objectKey}`,
    servedUrl: oldUrl,
  };
}

function parseListingImages(imagesJson, listingId) {
  if (Array.isArray(imagesJson)) return imagesJson;
  if (typeof imagesJson !== 'string' || !imagesJson) return [];
  const parsed = JSON.parse(imagesJson);
  if (!Array.isArray(parsed)) {
    throw new Error(`Listing ${listingId} has an invalid images_json value.`);
  }
  return parsed;
}

function classifyMediaReference(url, filesByPath) {
  if (typeof url !== 'string') return null;
  const uploaded = url.match(/^\/uploads\/(images|videos)\/([a-zA-Z0-9_.-]+)$/);
  if (uploaded) {
    const objectPath = `${uploaded[1]}/${uploaded[2]}`;
    const file = filesByPath.get(objectPath);
    const location = getMediaStorageLocation({ objectPath });
    return {
      ...location,
      source: file ? 'upload' : 'missing-upload',
      sizeBytes: file?.sizeBytes ?? null,
      sha256: file?.sha256 ?? null,
    };
  }
  if (/^\/src\/assets\/images\/[a-zA-Z0-9_.-]+$/.test(url)) {
    return {
      source: 'bundled-static',
      oldLocalPath: url.slice(1),
      oldUrl: url,
      newStoragePath: null,
      servedUrl: url,
      sizeBytes: null,
      sha256: null,
    };
  }
  if (url.startsWith('/uploads/') || url.startsWith('/src/assets/')) {
    return {
      source: 'unsupported-reference',
      oldLocalPath: null,
      oldUrl: url,
      newStoragePath: null,
      servedUrl: url,
      sizeBytes: null,
      sha256: null,
    };
  }
  return null;
}

export function createMediaReferenceReport({
  manifest,
  listings = [],
  categories = [],
  sliders = [],
  mediaAssets = [],
}) {
  const filesByPath = new Map(manifest.map((file) => [file.objectPath, file]));
  const referencesByPath = new Map(manifest.map((file) => [file.objectPath, []]));
  const missingFiles = [];

  function resolve(url, reference) {
    const media = classifyMediaReference(url, filesByPath);
    if (!media) return null;
    if (media.source === 'missing-upload') missingFiles.push({ ...reference, ...media });
    if (media.source === 'upload') {
      const objectPath = media.oldUrl.slice('/uploads/'.length);
      referencesByPath.get(objectPath).push(reference);
    }
    return media;
  }

  const listingReports = listings.map((listing) => {
    const listingId = Number(listing.id);
    const urls = parseListingImages(listing.images_json, listingId)
      .map((image) => image?.url)
      .filter((url) => typeof url === 'string');
    if (typeof listing.video_url === 'string' && listing.video_url) urls.push(listing.video_url);
    const uniqueUrls = Array.from(new Set(urls));
    return {
      listingId,
      status: listing.status ?? null,
      isHidden: Boolean(listing.is_hidden),
      isDemo: Boolean(listing.is_demo),
      media: uniqueUrls
        .map((url) => resolve(url, { entity: 'listing', id: listingId }))
        .filter(Boolean),
    };
  });

  function catalogReports(entity, rows) {
    return rows.map((row) => ({
      entity,
      id: Number(row.id),
      media: [resolve(row.image_url, { entity, id: Number(row.id) })].filter(Boolean),
    }));
  }

  const mediaAssetReports = mediaAssets.map((asset) => {
    if (asset.kind !== 'images' && asset.kind !== 'videos') {
      throw new Error(`Unsupported media asset kind: ${asset.kind}`);
    }
    const kind = asset.kind;
    const url = `/uploads/${kind}/${asset.filename}`;
    return {
      filename: asset.filename,
      kind,
      listingId: asset.listing_id ?? null,
      media: resolve(url, {
        entity: 'media_asset',
        id: asset.filename,
        listingId: asset.listing_id ?? null,
      }),
    };
  });

  const files = manifest.map((file) => ({
    ...getMediaStorageLocation(file),
    kind: file.kind,
    sizeBytes: file.sizeBytes,
    sha256: file.sha256,
    referencedBy: referencesByPath.get(file.objectPath) || [],
  }));
  return {
    listings: listingReports,
    categories: catalogReports('category', categories),
    sliders: catalogReports('slider', sliders),
    mediaAssets: mediaAssetReports,
    files,
    missingFiles,
    unreferencedFiles: files.filter((file) => file.referencedBy.length === 0),
  };
}

export function compareMediaManifests(source, copy) {
  const sourceByPath = new Map(source.map((file) => [file.objectPath, file]));
  const copyByPath = new Map(copy.map((file) => [file.objectPath, file]));
  if (sourceByPath.size !== source.length || copyByPath.size !== copy.length) {
    throw new Error('Media manifest contains duplicate object paths.');
  }

  const missing = [];
  const unexpected = [];
  const changed = [];
  for (const [objectPath, sourceFile] of sourceByPath) {
    const copyFile = copyByPath.get(objectPath);
    if (!copyFile) {
      missing.push(objectPath);
    } else if (
      copyFile.sizeBytes !== sourceFile.sizeBytes ||
      copyFile.sha256 !== sourceFile.sha256 ||
      copyFile.kind !== sourceFile.kind
    ) {
      changed.push(objectPath);
    }
  }
  for (const objectPath of copyByPath.keys()) {
    if (!sourceByPath.has(objectPath)) unexpected.push(objectPath);
  }

  return { ok: missing.length === 0 && unexpected.length === 0 && changed.length === 0, missing, unexpected, changed };
}

export async function verifyMediaCopy(sourceRoot, copyRoot) {
  const [source, copy] = await Promise.all([
    createLocalMediaManifest(sourceRoot),
    createLocalMediaManifest(copyRoot),
  ]);
  return { sourceCount: source.length, copyCount: copy.length, ...compareMediaManifests(source, copy) };
}

async function readTransferCheckpoint(checkpointPath) {
  try {
    return JSON.parse(await readFile(checkpointPath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

async function writeTransferCheckpoint(checkpointPath, checkpoint) {
  const parent = path.dirname(checkpointPath);
  await mkdir(parent, { recursive: true });
  const temporaryPath = `${checkpointPath}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(temporaryPath, `${JSON.stringify(checkpoint, null, 2)}\n`, { flag: 'wx' });
  await rename(temporaryPath, checkpointPath);
}

function manifestsEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

async function verifyRemoteFile(storage, file, location, verificationRoot) {
  const destination = path.join(verificationRoot, ...file.objectPath.split('/'));
  await mkdir(path.dirname(destination), { recursive: true });
  await storage.downloadToFile(location.bucketId, location.objectKey, destination);
  const info = await stat(destination);
  const digest = await hashFile(destination);
  if (info.size !== file.sizeBytes || digest !== file.sha256) {
    throw new Error(`Storage object failed SHA-256 verification: ${location.newStoragePath}`);
  }
}

export async function runResumableMediaTransfer({
  sourceRoot,
  checkpointPath,
  storage,
  references = {},
}) {
  if (
    !storage ||
    typeof storage.exists !== 'function' ||
    typeof storage.uploadCreateOnly !== 'function' ||
    typeof storage.downloadToFile !== 'function'
  ) {
    throw new Error('A storage adapter with exists, uploadCreateOnly, and downloadToFile is required.');
  }

  const absoluteSourceRoot = path.resolve(sourceRoot);
  const absoluteCheckpointPath = path.resolve(checkpointPath);
  const relativeCheckpoint = path.relative(absoluteSourceRoot, absoluteCheckpointPath);
  if (
    relativeCheckpoint === '' ||
    (!relativeCheckpoint.startsWith(`..${path.sep}`) && !path.isAbsolute(relativeCheckpoint))
  ) {
    throw new Error('Transfer checkpoint must be stored outside the source media directory.');
  }

  const manifest = await createLocalMediaManifest(absoluteSourceRoot);
  const report = createMediaReferenceReport({ ...references, manifest });
  const lockPath = `${absoluteCheckpointPath}.lock`;
  await mkdir(path.dirname(absoluteCheckpointPath), { recursive: true });
  let lock;
  try {
    lock = await open(lockPath, 'wx');
  } catch (error) {
    if (error.code === 'EEXIST') throw new Error('Another media transfer is using this checkpoint.');
    throw error;
  }

  let verificationRoot;
  try {
    verificationRoot = await mkdtemp(path.join(os.tmpdir(), 'darajati-media-verify-'));
  } catch (error) {
    await lock.close();
    await unlink(lockPath);
    throw error;
  }

  try {
    const existing = await readTransferCheckpoint(absoluteCheckpointPath);
    if (existing && (existing.version !== 1 || !manifestsEqual(existing.sourceManifest, manifest))) {
      throw new Error('Source media changed since this checkpoint; use a new checkpoint after review.');
    }
    if (existing?.referenceReport && !manifestsEqual(existing.referenceReport, report)) {
      throw new Error('Media references changed since this checkpoint; use a new checkpoint after review.');
    }

    const checkpoint = existing || {
      version: 1,
      sourceManifest: manifest,
      referenceReport: report,
      verified: {},
    };
    const uploaded = [];
    const skipped = [];

    for (const file of manifest) {
      const location = getMediaStorageLocation(file);
      const sourceFile = path.join(absoluteSourceRoot, ...file.objectPath.split('/'));
      if ((await hashFile(sourceFile)) !== file.sha256) {
        throw new Error(`Source file changed during transfer: ${file.objectPath}`);
      }

      let exists = await storage.exists(location.bucketId, location.objectKey);
      let wasUploaded = false;
      if (!exists) {
        try {
          await storage.uploadCreateOnly(location.bucketId, location.objectKey, sourceFile);
          wasUploaded = true;
        } catch (error) {
          if (error.code !== 'OBJECT_ALREADY_EXISTS') throw error;
          exists = true;
        }
      }
      if (!exists && !wasUploaded) {
        throw new Error(`Storage adapter did not create object: ${location.newStoragePath}`);
      }

      await verifyRemoteFile(storage, file, location, verificationRoot);
      checkpoint.verified[file.objectPath] = {
        bucketId: location.bucketId,
        objectKey: location.objectKey,
        sizeBytes: file.sizeBytes,
        sha256: file.sha256,
      };
      await writeTransferCheckpoint(absoluteCheckpointPath, checkpoint);
      (wasUploaded ? uploaded : skipped).push(location.newStoragePath);
    }

    return {
      sourceCount: manifest.length,
      uploaded,
      skipped,
      verifiedCount: Object.keys(checkpoint.verified).length,
      referenceReport: checkpoint.referenceReport,
    };
  } finally {
    await rm(verificationRoot, { recursive: true, force: true });
    await lock.close();
    await unlink(lockPath);
  }
}

async function main(args) {
  if (args[0] === '--verify') {
    if (args.length !== 3) {
      throw new Error('Usage: node scripts/media-storage-plan.mjs --verify <source-root> <copy-root>');
    }
    const result = await verifyMediaCopy(args[1], args[2]);
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) process.exitCode = 1;
    return;
  }

  if (args.length > 1 || (args.length === 1 && args[0] !== '--inventory')) {
    throw new Error('Usage: node scripts/media-storage-plan.mjs [--inventory]');
  }
  const root = path.resolve(process.cwd(), 'uploads');
  const files = await createLocalMediaManifest(root);
  console.log(JSON.stringify({ root, buckets: MEDIA_STORAGE_DESIGN.buckets, files }, null, 2));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
