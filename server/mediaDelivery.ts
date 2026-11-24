import fs from 'node:fs/promises';
import path from 'node:path';
import type {
  MediaKind,
  MediaStorageReadResult,
  MediaStorageRepository,
} from './repositories/mediaStorage.ts';

export interface ListingMediaVisibility {
  listing_id: number | null;
  is_referenced: boolean;
  status: string | null;
  is_hidden: number | null;
  is_demo: number | null;
}

export function isPublicListingMediaAsset(
  asset: ListingMediaVisibility | null | undefined
): boolean {
  return Boolean(
    asset?.listing_id &&
    asset.is_referenced &&
    (asset.status === 'approved' || asset.status === 'sold') &&
    asset.is_hidden === 0 &&
    asset.is_demo === 0
  );
}

export interface MediaDeliveryRequest {
  params: { kind?: string; filename?: string };
  headers: { range?: string | string[] };
  method?: string;
}

export interface MediaDeliveryResponse {
  setHeader(name: string, value: string | number): this;
  status(code: number): this;
  json(body: unknown): this;
  send(body: Buffer): this;
  end(): this;
}

export interface MediaAccessDecision {
  authorized: boolean;
  isPublic: boolean;
}

export interface MediaSource {
  body: Buffer;
  storageError?: Error;
}

export type MediaSourceResult =
  | { status: 'found'; source: MediaSource }
  | { status: 'not-found' }
  | { status: 'unavailable'; error: Error };

const MIME_BY_EXT: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
};

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error('Storage request failed.');
}

function isMissingFile(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

async function readLocalMedia(rootDir: string, kind: MediaKind, filename: string): Promise<Buffer | null> {
  const root = path.resolve(rootDir);
  const filePath = path.resolve(root, kind, filename);
  if (!filePath.startsWith(root + path.sep)) return null;

  try {
    const fileInfo = await fs.lstat(filePath);
    if (!fileInfo.isFile() || fileInfo.isSymbolicLink()) return null;
    return await fs.readFile(filePath);
  } catch (error) {
    if (isMissingFile(error)) return null;
    throw error;
  }
}

export async function readMediaWithFallback(
  storage: MediaStorageRepository,
  rootDir: string,
  kind: MediaKind,
  filename: string
): Promise<MediaSourceResult> {
  let storageResult: MediaStorageReadResult;
  try {
    storageResult = await storage.download(kind, filename);
  } catch (error) {
    storageResult = { status: 'unavailable', error: asError(error) };
  }

  if (storageResult.status === 'found') {
    return { status: 'found', source: { body: storageResult.object.body } };
  }

  const localBody = await readLocalMedia(rootDir, kind, filename);
  if (localBody) {
    return {
      status: 'found',
      source: {
        body: localBody,
        ...(storageResult.status === 'unavailable' ? { storageError: storageResult.error } : {}),
      },
    };
  }

  return storageResult.status === 'unavailable'
    ? storageResult
    : { status: 'not-found' };
}

function parseSingleByteRange(
  header: string | string[] | undefined,
  size: number
): { start: number; end: number } | 'invalid' | null {
  if (header === undefined) return null;
  if (Array.isArray(header) || !header.startsWith('bytes=') || header.includes(',')) return 'invalid';

  const match = /^bytes=(\d*)-(\d*)$/.exec(header);
  if (!match || (!match[1] && !match[2]) || size <= 0) return 'invalid';

  let start: number;
  let end: number;
  if (!match[1]) {
    const suffixLength = Number(match[2]);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) return 'invalid';
    start = Math.max(size - suffixLength, 0);
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] ? Number(match[2]) : size - 1;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start >= size || start > end) {
      return 'invalid';
    }
    end = Math.min(end, size - 1);
  }

  return { start, end };
}

export interface MediaDeliveryDependencies<Req extends MediaDeliveryRequest, Res extends MediaDeliveryResponse> {
  rootDir: string;
  storage: MediaStorageRepository;
  authorize: (
    req: Req,
    res: Res,
    kind: MediaKind,
    filename: string,
    url: string
  ) => Promise<MediaAccessDecision>;
  onStorageError?: (error: Error) => void;
}

export function createMediaDeliveryHandler<
  Req extends MediaDeliveryRequest,
  Res extends MediaDeliveryResponse,
>(
  dependencies: MediaDeliveryDependencies<Req, Res>
): (req: Req, res: Res, next: (error?: unknown) => void) => Promise<void> {
  return async (req, res, next) => {
    const kind = req.params.kind;
    const filename = req.params.filename;
    const mime = filename ? MIME_BY_EXT[path.extname(filename).toLowerCase()] : undefined;
    if (
      (kind !== 'images' && kind !== 'videos') ||
      !filename ||
      !/^[a-zA-Z0-9_.-]+$/.test(filename) ||
      !mime ||
      (kind === 'images' && !mime.startsWith('image/')) ||
      (kind === 'videos' && !mime.startsWith('video/'))
    ) {
      res.setHeader('Cache-Control', 'no-store');
      res.status(400).json({ error: 'مسار الملف غير صالح.' });
      return;
    }

    const mediaKind: MediaKind = kind;
    const relUrl = `/uploads/${mediaKind}/${filename}`;
    let access: MediaAccessDecision;
    try {
      access = await dependencies.authorize(req, res, mediaKind, filename, relUrl);
    } catch (error) {
      next(error);
      return;
    }

    if (!access.authorized) {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
      res.status(403).json({ error: 'غير مصرح بعرض هذا الملف حالياً.' });
      return;
    }

    let result: MediaSourceResult;
    try {
      result = await readMediaWithFallback(dependencies.storage, dependencies.rootDir, mediaKind, filename);
    } catch (error) {
      next(error);
      return;
    }

    if (result.status === 'not-found') {
      res.setHeader('Cache-Control', 'no-store');
      res.status(404).json({ error: 'الملف غير موجود.' });
      return;
    }
    if (result.status === 'unavailable') {
      dependencies.onStorageError?.(result.error);
      res.setHeader('Cache-Control', 'no-store');
      res.status(503).json({ error: 'تعذر الوصول إلى ملف الوسائط حالياً.' });
      return;
    }

    if (result.source.storageError) {
      dependencies.onStorageError?.(result.source.storageError);
    }

    res.setHeader('Content-Type', mime);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    res.setHeader('X-Darajati-Media-Scope', access.isPublic ? 'public' : 'private');
    res.setHeader(
      'Cache-Control',
      access.isPublic
        ? 'public, max-age=0, must-revalidate'
        : 'no-store, no-cache, must-revalidate, private'
    );
    res.setHeader('Accept-Ranges', 'bytes');

    const range = parseSingleByteRange(req.headers.range, result.source.body.length);
    if (range === 'invalid') {
      res.setHeader('Content-Range', `bytes */${result.source.body.length}`);
      res.status(416).end();
      return;
    }

    const start = range ? range.start : 0;
    const end = range ? range.end : result.source.body.length - 1;
    const responseBody = range ? result.source.body.subarray(start, end + 1) : result.source.body;
    res.setHeader('Content-Length', responseBody.length);
    if (range) {
      res.setHeader('Content-Range', `bytes ${start}-${end}/${result.source.body.length}`);
      res.status(206);
    }

    if (req.method === 'HEAD') {
      res.end();
      return;
    }
    res.send(responseBody);
  };
}
