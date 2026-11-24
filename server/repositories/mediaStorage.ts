import { getSupabaseServerClient } from '../supabase.ts';

export type MediaKind = 'images' | 'videos';

export interface StoredMediaObject {
  body: Buffer;
}

export type MediaStorageReadResult =
  | { status: 'found'; object: StoredMediaObject }
  | { status: 'not-found' }
  | { status: 'unavailable'; error: Error };

export interface MediaStorageRepository {
  download(kind: MediaKind, filename: string): Promise<MediaStorageReadResult>;
  upload(kind: MediaKind, filename: string, body: Buffer, contentType: string): Promise<void>;
}

interface StorageDownloadError {
  statusCode?: number | string;
  error?: string;
  message?: string;
}

interface StorageBucketGateway {
  download(path: string): Promise<{
    data: Blob | null;
    error: StorageDownloadError | null;
  }>;
  upload?(
    path: string,
    body: Buffer,
    options: { contentType: string; upsert: boolean; cacheControl: string }
  ): Promise<{ error: StorageDownloadError | null }>;
}

export interface StorageGateway {
  from(bucket: string): StorageBucketGateway;
}

export function isMediaStorageReadEnabled(
  env: Record<string, string | undefined> = process.env
): boolean {
  return env.MEDIA_STORAGE_READ_ENABLED?.trim().toLowerCase() !== 'false';
}

export function isMediaStorageWriteEnabled(
  env: Record<string, string | undefined> = process.env
): boolean {
  return env.MEDIA_STORAGE_WRITE_ENABLED?.trim().toLowerCase() !== 'false';
}

const BUCKET_BY_KIND: Record<MediaKind, string> = {
  images: 'darajati-images',
  videos: 'darajati-videos',
};

const CONTENT_TYPES_BY_KIND: Record<MediaKind, string[]> = {
  images: ['image/jpeg', 'image/png', 'image/webp'],
  videos: ['video/mp4', 'video/webm', 'video/quicktime'],
};

const MAX_BYTES_BY_KIND: Record<MediaKind, number> = {
  images: 8 * 1024 * 1024,
  videos: 35 * 1024 * 1024,
};

function isNotFound(error: StorageDownloadError): boolean {
  return String(error.statusCode) === '404' || error.error === 'not_found';
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error('Storage request failed.');
}

export function createSupabaseMediaStorageRepository(
  storage: StorageGateway = getSupabaseServerClient().storage
): MediaStorageRepository {
  return {
    async download(kind, filename) {
      try {
        const { data, error } = await storage.from(BUCKET_BY_KIND[kind]).download(filename);
        if (error) {
          if (isNotFound(error)) return { status: 'not-found' };
          return {
            status: 'unavailable',
            error: new Error(error.message || 'Storage request failed.'),
          };
        }
        if (!data) return { status: 'not-found' };
        if (data.size > MAX_BYTES_BY_KIND[kind]) {
          return {
            status: 'unavailable',
            error: new Error('Stored media exceeds the configured size limit.'),
          };
        }
        return {
          status: 'found',
          object: { body: Buffer.from(await data.arrayBuffer()) },
        };
      } catch (error) {
        return { status: 'unavailable', error: toError(error) };
      }
    },
    async upload(kind, filename, body, contentType) {
      if (!/^[a-zA-Z0-9_.-]+$/.test(filename) || filename === '.' || filename === '..') {
        throw new Error('Invalid media filename.');
      }
      if (!CONTENT_TYPES_BY_KIND[kind].includes(contentType)) {
        throw new Error('Invalid media content type.');
      }
      if (body.length === 0 || body.length > MAX_BYTES_BY_KIND[kind]) {
        throw new Error('Media size is outside the configured limit.');
      }

      const bucket = storage.from(BUCKET_BY_KIND[kind]);
      if (!bucket.upload) throw new Error('Storage upload is not available.');
      const { error } = await bucket.upload(filename, body, {
        contentType,
        upsert: false,
        cacheControl: '0',
      });
      if (error) throw new Error(`Failed to upload media to Storage: ${error.message || 'unknown error'}`);
    },
  };
}

let defaultRepository: MediaStorageRepository | undefined;

export function getMediaStorageRepository(): MediaStorageRepository {
  if (!defaultRepository) {
    defaultRepository = createSupabaseMediaStorageRepository();
  }
  return defaultRepository;
}
