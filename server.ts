import dotenv from 'dotenv';
dotenv.config();

import crypto from 'crypto';
import express, { NextFunction, Request, Response } from 'express';
import fs from 'fs';
import multer from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

import {
  generateOwnerCode,
  generateToken,
  hashPassword,
  sha256,
  verifyPassword,
} from './server/securityCrypto.ts';
import {
  clearAdminAuthRateLimit,
  countSiteVisits,
  createAdminSession,
  deleteAdminSession,
  deleteAllAdminSessions,
  deleteExpiredAdminSessions,
  getAdminAuthRateLimit,
  getAdminPinHash,
  getAdminSessionRecord,
  recordAdminAuthFailure,
  recordSiteVisitOnce,
  saveAdminPinHash,
  touchAdminSession,
} from './server/repositories/adminSecurity.ts';
import {
  addDeviceFavorite,
  importDeviceFavoritesOnce,
  removeDeviceFavorite,
} from './server/repositories/deviceFavorites.ts';
import {
  getSmartSuggestions,
  normalizeArabicText,
  runSmartSearch,
} from './server/smartSearch.ts';
import {
  addOwnerMediaGrant,
  associateListingMedia,
  createListingReport,
  deleteDemoListings,
  deleteListing,
  getCategoryForListing,
  getManagedSynonym,
  getListingById,
  getPublicListingContact,
  getListingMediaAuthorization,
  getListingOverviewData,
  insertAdminNotification,
  insertListing,
  insertManagedSynonym,
  isPublicListingMedia,
  deleteManagedSynonym,
  listAdminNotifications,
  listAdminReports,
  listManagedSynonyms,
  listListings,
  loadListingSearchData,
  markAdminNotificationRead,
  markAllAdminNotificationsRead,
  ownerHasMediaGrant,
  searchAdminCategories,
  updateManagedSynonym,
  updateListing,
  updateListingReportStatus,
  upsertMediaAsset,
  type ListingRecord,
} from './server/repositories/listings.ts';
import { createMediaDeliveryHandler, isPublicListingMediaAsset } from './server/mediaDelivery.ts';
import {
  getMediaStorageRepository,
  isMediaStorageReadEnabled,
  isMediaStorageWriteEnabled,
} from './server/repositories/mediaStorage.ts';
import { formatListingRow, isPublicListing } from './server/listingPresentation.ts';
import {
  allowPublicContactRedirect,
  createPublicContactTarget,
} from './server/publicContact.ts';
import {
  CatalogRepositoryError,
  type CatalogAuditLog,
  categoryHasListings,
  createCategory,
  createSlider,
  deleteCategory,
  deleteSlider,
  getAdminSettings,
  getCategory,
  getSlider,
  getPublicSliderSettings,
  isPublicCatalogMediaReference,
  listCatalogAuditLogs,
  listPublicCategories,
  listAdminSliders,
  listPublicSliders,
  recordCatalogAudit,
  saveAdminSettings,
  updateCategory,
  updateSlider,
} from './server/repositories/publicCatalog.ts';

const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');

const PORT = Number(process.env.PORT || 3000);
const UPLOADS_ROOT = path.resolve(process.env.UPLOADS_DIR || './uploads');
const IMAGES_DIR = path.join(UPLOADS_ROOT, 'images');
const VIDEOS_DIR = path.join(UPLOADS_ROOT, 'videos');

fs.mkdirSync(IMAGES_DIR, { recursive: true, mode: 0o750 });
fs.mkdirSync(VIDEOS_DIR, { recursive: true, mode: 0o750 });

const ADMIN_COOKIE_NAME = 'darajati_admin_sid';
const OWNER_COOKIE_NAME = 'darajati_owner_sid';
const FAVORITES_COOKIE_NAME = 'darajati_favorites_sid';
const IDLE_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes inactivity
const MAX_SESSION_MS = 8 * 60 * 60 * 1000; // 8 hours absolute maximum

// Security headers on all responses
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  if (req.path.startsWith('/api/admin')) {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.setHeader('Pragma', 'no-cache');
  }
  next();
});

app.use(express.json({ limit: '2mb' }));

// ================= SECURITY HELPERS =================

function getClientIp(req: Request): string {
  const raw = String(req.ip || req.socket.remoteAddress || 'unknown').trim();
  return raw.slice(0, 80);
}

function isHttpsRequest(req: Request): boolean {
  const xfProto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim().toLowerCase();
  return req.secure || xfProto === 'https' || process.env.NODE_ENV === 'production';
}

function parseCookies(req: Request): Record<string, string> {
  const header = req.headers.cookie;
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx <= 0) continue;
    const key = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    try {
      out[key] = decodeURIComponent(val);
    } catch {
      out[key] = val;
    }
  }
  return out;
}

function setCookie(
  req: Request,
  res: Response,
  name: string,
  value: string,
  maxAgeSeconds: number
): void {
  const secure = isHttpsRequest(req);
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    'Path=/',
    'HttpOnly',
    `Max-Age=${Math.max(0, Math.floor(maxAgeSeconds))}`,
    secure ? 'SameSite=None' : 'SameSite=Lax',
  ];
  if (secure) parts.push('Secure');
  res.append('Set-Cookie', parts.join('; '));
}

function clearCookie(req: Request, res: Response, name: string): void {
  const secure = isHttpsRequest(req);
  const parts = [
    `${name}=`,
    'Path=/',
    'HttpOnly',
    'Max-Age=0',
    'Expires=Thu, 01 Jan 1970 00:00:00 GMT',
    secure ? 'SameSite=None' : 'SameSite=Lax',
  ];
  if (secure) parts.push('Secure');
  res.append('Set-Cookie', parts.join('; '));
}

function verifySameOrigin(req: Request): boolean {
  const host = String(req.get('host') || '').toLowerCase();
  const origin = req.headers.origin;
  const referer = req.headers.referer;

  if (origin) {
    try {
      const originHost = new URL(origin).host.toLowerCase();
      if (originHost === host) return true;
      if (process.env.APP_URL) {
        const appHost = new URL(process.env.APP_URL).host.toLowerCase();
        if (originHost === appHost) return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  if (referer) {
    try {
      const refHost = new URL(referer).host.toLowerCase();
      if (refHost === host) return true;
      if (process.env.APP_URL) {
        const appHost = new URL(process.env.APP_URL).host.toLowerCase();
        if (refHost === appHost) return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  // Allow non-browser / same-origin tool requests only when custom header is explicitly required on mutations
  return true;
}

function safeEqualStrings(a: string, b: string): boolean {
  if (!a || !b) return false;
  const ba = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

function logAudit(
  eventType: string,
  actor: string,
  ipAddress: string,
  targetType = '',
  targetId = '',
  details = ''
): Promise<void> {
  return recordCatalogAudit(
    eventType,
    actor,
    ipAddress,
    targetType,
    targetId,
    details
  );
}

function normalizeDigitsServer(input: string): string {
  const arabicDigits = '٠١٢٣٤٥٦٧٨٩';
  const persianDigits = '۰۱۲۳۴۵۶۷۸۹';
  // إزالة جميع المسافات (باستخدام \r\n\t وغيرها) قبل التحويل، للتعامل مع إدخالات مثل "199 444".
  let out = String(input || '').trim().replace(/\s/g, '');
  for (let i = 0; i < 10; i++) {
    out = out.replaceAll(arabicDigits[i], String(i)).replaceAll(persianDigits[i], String(i));
  }
  return out;
}

function sanitizeMediaUrl(url: unknown, allowedKind: 'image' | 'video' | 'any'): string | null {
  if (typeof url !== 'string') return null;
  const trimmed = url.trim();
  if (!trimmed || trimmed.length > 500) return null;
  if (/^(javascript|data|vbscript|file):/i.test(trimmed)) return null;

  if (allowedKind === 'image') {
    if (/^\/uploads\/images\/[a-zA-Z0-9_.-]+$/.test(trimmed)) return trimmed;
    if (/^\/src\/assets\/images\/[a-zA-Z0-9_.-]+$/.test(trimmed)) return trimmed;
    return null;
  }
  if (allowedKind === 'video') {
    if (/^\/uploads\/videos\/[a-zA-Z0-9_.-]+$/.test(trimmed)) return trimmed;
    return null;
  }
  if (/^\/uploads\/(images|videos)\/[a-zA-Z0-9_.-]+$/.test(trimmed)) return trimmed;
  if (/^\/src\/assets\/images\/[a-zA-Z0-9_.-]+$/.test(trimmed)) return trimmed;
  return null;
}

// ================= ADMIN SESSION & CSRF =================

interface AdminSessionContext {
  username: string;
  role: string;
  csrfToken: string;
  tokenHash: string;
}

async function getAdminSession(
  req: Request,
  res?: Response,
  options: { touchActivity?: boolean } = {}
): Promise<AdminSessionContext | null> {
  const cookies = parseCookies(req);
  const rawSid = cookies[ADMIN_COOKIE_NAME];
  if (!rawSid || rawSid.length < 32 || rawSid.length > 256) return null;

  const tokenHash = sha256(rawSid);
  const session = await getAdminSessionRecord(tokenHash);

  if (!session) return null;

  const now = Date.now();
  const isAbsoluteExpired = now > session.expires_at;
  const isIdleExpired = now - session.last_activity_at > IDLE_TIMEOUT_MS;

  if (isAbsoluteExpired || isIdleExpired) {
    await deleteAdminSession(tokenHash);
    if (res) clearCookie(req, res, ADMIN_COOKIE_NAME);
    await logAudit(
      isIdleExpired ? 'session_idle_expired' : 'session_max_expired',
      session.username,
      getClientIp(req),
      'session',
      '',
      isIdleExpired ? 'انتهت الجلسة لعدم النشاط (15 دقيقة)' : 'انتهى الحد الأقصى للجلسة (8 ساعات)'
    );
    return null;
  }

  const shouldTouch =
    options.touchActivity !== false &&
    req.headers['x-background-poll'] !== '1';
  if (shouldTouch) {
    await touchAdminSession(tokenHash, now);
  }

  return {
    username: session.username,
    role: session.role || 'admin',
    csrfToken: session.csrf_token,
    tokenHash: session.token_hash,
  };
}

async function requireAdmin(req: Request, res: Response, next: NextFunction) {
  try {
    const session = await getAdminSession(req, res, { touchActivity: true });
    if (!session || session.role !== 'admin') {
      res.status(401).json({ error: 'تعذّر المتابعة.' });
      return;
    }

    if (['POST', 'PATCH', 'PUT', 'DELETE'].includes(req.method.toUpperCase())) {
      if (!verifySameOrigin(req)) {
        await logAudit('csrf_origin_blocked', session.username, getClientIp(req), 'route', req.path);
        res.status(403).json({ error: 'مصدر الطلب غير مصرح به.' });
        return;
      }
      const headerCsrf = String(req.headers['x-csrf-token'] || '').trim();
      if (!safeEqualStrings(headerCsrf, session.csrfToken)) {
        await logAudit('csrf_token_invalid', session.username, getClientIp(req), 'route', req.path);
        res.status(403).json({ error: 'تعذر التحقق من رمز الحماية (CSRF). أعد تحديث الصفحة.' });
        return;
      }
    }

    (req as any).adminSession = session;
    (req as any).adminUsername = session.username;
    next();
  } catch (error) {
    next(error);
  }
}

function getOrCreateOwnerMediaCookie(req: Request, res: Response): string {
  const cookies = parseCookies(req);
  const existing = cookies[OWNER_COOKIE_NAME];
  if (existing && /^[a-f0-9]{32,128}$/.test(existing)) {
    return existing;
  }
  const fresh = generateToken(24);
  setCookie(req, res, OWNER_COOKIE_NAME, fresh, 7 * 24 * 60 * 60);
  return fresh;
}

function getOwnerCookieHash(req: Request): string | null {
  const cookies = parseCookies(req);
  const existing = cookies[OWNER_COOKIE_NAME];
  if (existing && /^[a-f0-9]{32,128}$/.test(existing)) {
    return sha256(existing);
  }
  return null;
}

function getOrCreateFavoritesDeviceId(req: Request, res: Response): string {
  const existing = parseCookies(req)[FAVORITES_COOKIE_NAME];
  if (existing && /^[a-f0-9]{64}$/.test(existing)) return existing;

  const deviceId = generateToken(32);
  setCookie(req, res, FAVORITES_COOKIE_NAME, deviceId, 2 * 365 * 24 * 60 * 60);
  return deviceId;
}

function getFavoritesDeviceId(req: Request): string | null {
  const deviceId = parseCookies(req)[FAVORITES_COOKIE_NAME];
  return deviceId && /^[a-f0-9]{64}$/.test(deviceId) ? deviceId : null;
}

async function verifyOwnerOrAdmin(
  req: Request,
  res: Response,
  listingRow: any
): Promise<'admin' | 'owner' | null> {
  const adminSession = await getAdminSession(req, res, { touchActivity: true });
  if (adminSession && adminSession.role === 'admin') return 'admin';

  const ownerToken = String(req.headers['x-owner-token'] || '').trim();
  if (
    ownerToken &&
    listingRow.owner_token_hash &&
    safeEqualStrings(sha256(ownerToken), listingRow.owner_token_hash)
  ) {
    return 'owner';
  }
  return null;
}

// ================= FILE UPLOAD VALIDATION & PRIVATE SERVING =================

function validateMagicBytes(filePath: string, expectedKind: 'images' | 'videos'): boolean {
  let fd: number | null = null;
  try {
    fd = fs.openSync(filePath, 'r');
    const buf = Buffer.alloc(16);
    const bytesRead = fs.readSync(fd, buf, 0, 16, 0);
    if (bytesRead < 4) return false;

    if (expectedKind === 'images') {
      // JPEG: FF D8 FF
      if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return true;
      // PNG: 89 50 4E 47 0D 0A 1A 0A
      if (
        bytesRead >= 8 &&
        buf[0] === 0x89 &&
        buf[1] === 0x50 &&
        buf[2] === 0x4e &&
        buf[3] === 0x47 &&
        buf[4] === 0x0d &&
        buf[5] === 0x0a &&
        buf[6] === 0x1a &&
        buf[7] === 0x0a
      ) {
        return true;
      }
      // WebP: RIFF....WEBP
      if (
        bytesRead >= 12 &&
        buf.subarray(0, 4).toString('ascii') === 'RIFF' &&
        buf.subarray(8, 12).toString('ascii') === 'WEBP'
      ) {
        return true;
      }
      return false;
    } else {
      // MP4 / MOV: 'ftyp' at offset 4..8
      if (bytesRead >= 8 && buf.subarray(4, 8).toString('ascii') === 'ftyp') return true;
      // WebM / Matroska: 1A 45 DF A3
      if (buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) return true;
      return false;
    }
  } catch {
    return false;
  } finally {
    if (fd !== null) {
      try {
        fs.closeSync(fd);
      } catch {
        // ignore
      }
    }
  }
}

const uploadRateLimits = new Map<string, { count: number; windowStart: number }>();
function checkUploadRateLimit(req: Request, res: Response): boolean {
  const key = getClientIp(req);
  const now = Date.now();
  const windowMs = 15 * 60 * 1000;
  const rec = uploadRateLimits.get(key);
  if (!rec || now - rec.windowStart > windowMs) {
    uploadRateLimits.set(key, { count: 1, windowStart: now });
    return true;
  }
  if (rec.count >= 40) {
    res.status(429).json({ error: 'تم تجاوز الحد المسموح لرفع الملفات، يرجى الانتظار قليلاً.' });
    return false;
  }
  rec.count += 1;
  return true;
}

const imageStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, IMAGES_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || '.jpg';
    const safeExt = ['.jpg', '.jpeg', '.png', '.webp'].includes(ext) ? ext : '.jpg';
    cb(null, `img_${Date.now()}_${generateToken(8)}${safeExt}`);
  },
});

const videoStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, VIDEOS_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || '.mp4';
    const safeExt = ['.mp4', '.webm', '.mov'].includes(ext) ? ext : '.mp4';
    cb(null, `vid_${Date.now()}_${generateToken(8)}${safeExt}`);
  },
});

const uploadImages = multer({
  storage: imageStorage,
  limits: { fileSize: 8 * 1024 * 1024, files: 10 },
  fileFilter: (_req, file, cb) => {
    if (['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('صيغة الصورة غير مدعومة. الصيغ المدعومة: JPG, PNG, WebP'));
    }
  },
});

const uploadVideo = multer({
  storage: videoStorage,
  limits: { fileSize: 35 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (['video/mp4', 'video/webm', 'video/quicktime'].includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('صيغة الفيديو غير مدعومة. الصيغ المدعومة: MP4, WebM, MOV'));
    }
  },
});

const serveMediaFile = createMediaDeliveryHandler<Request, Response>({
  rootDir: UPLOADS_ROOT,
  storage: {
    download: (kind, filename) => isMediaStorageReadEnabled()
      ? getMediaStorageRepository().download(kind, filename)
      : Promise.resolve({ status: 'not-found' }),
    upload: (kind, filename, body, contentType) =>
      getMediaStorageRepository().upload(kind, filename, body, contentType),
  },
  authorize: async (req, res, kind, filename, relUrl) => {
    let isPubliclyPublished = await isPublicCatalogMediaReference(relUrl);
    let authorized = isPubliclyPublished;

    if (!authorized) {
      const asset = await getListingMediaAuthorization(filename, kind);
      if (!asset && await isPublicListingMedia(relUrl, kind)) {
        isPubliclyPublished = true;
        authorized = true;
      }
      if (isPublicListingMediaAsset(asset)) {
        isPubliclyPublished = true;
        authorized = true;
      }

      if (!authorized) {
        const adminSession = await getAdminSession(req, res, { touchActivity: false });
        if (adminSession && adminSession.role === 'admin') {
          authorized = true;
        } else {
          const ownerCookieHash = getOwnerCookieHash(req);
          if (ownerCookieHash) {
            if (asset?.upload_token_hash && safeEqualStrings(ownerCookieHash, asset.upload_token_hash)) {
              authorized = true;
            } else if (asset?.listing_id) {
              authorized = await ownerHasMediaGrant(ownerCookieHash, asset.listing_id);
            }
          }
          if (!authorized && asset?.owner_token_hash) {
            const headerOwnerToken = String(req.headers['x-owner-token'] || '').trim();
            if (headerOwnerToken && safeEqualStrings(sha256(headerOwnerToken), asset.owner_token_hash)) {
              authorized = true;
            }
          }
        }
      }
    }

    return { authorized, isPublic: isPubliclyPublished };
  },
  onStorageError: (error) => {
    console.warn('[Media Storage] Storage read failed; served local fallback:', error.message);
  },
});

app.get('/uploads/:kind/:filename', (req, res, next) => {
  void serveMediaFile(req, res, next).catch(next);
});

function formatSynonymOptions(value: unknown): any[] {
  if (Array.isArray(value)) return value;
  if (typeof value !== 'string' || !value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function normalizePhoneServer(input: string): string {
  let out = normalizeDigitsServer(String(input || '')).trim();
  out = out.replace(/[\s\-()]/g, '');
  if (out.startsWith('+964')) out = '0' + out.slice(4);
  else if (out.startsWith('00964')) out = '0' + out.slice(5);
  else if (out.startsWith('964') && out.length >= 13) out = '0' + out.slice(3);
  return out;
}

// Upload endpoints (with rate limit, magic-byte inspection, restrictive permissions & private asset tracking)
app.post('/api/upload/images', (req, res, next) => {
  if (!verifySameOrigin(req)) {
    res.status(403).json({ error: 'مصدر الطلب غير مصرح به.' });
    return;
  }
  if (!checkUploadRateLimit(req, res)) return;

  uploadImages.array('images', 10)(req, res, async (err: any) => {
    if (err) {
      res.status(400).json({ error: err.message || 'تعذر رفع الصور، تأكد من الصيغة والحجم.' });
      return;
    }
    const files = (req.files as Express.Multer.File[]) || [];
    if (files.length === 0) {
      res.status(400).json({ error: 'لم يتم إرفاق أي صورة.' });
      return;
    }

    // Validate binary magic bytes for every file
    const invalidFiles: Express.Multer.File[] = [];
    for (const f of files) {
      if (!validateMagicBytes(f.path, 'images')) {
        invalidFiles.push(f);
      } else {
        try {
          fs.chmodSync(f.path, 0o640);
        } catch {
          // ignore
        }
      }
    }

    if (invalidFiles.length > 0) {
      for (const f of files) {
        try {
          fs.unlinkSync(f.path);
        } catch {
          // ignore
        }
      }
      res.status(400).json({ error: 'تم رفض الملف: محتوى الصورة غير صالح أو تالف.' });
      return;
    }

    const ownerSid = getOrCreateOwnerMediaCookie(req, res);
    const ownerHash = sha256(ownerSid);
    try {
      for (const file of files) {
        if (isMediaStorageWriteEnabled()) {
          await getMediaStorageRepository().upload(
            'images',
            file.filename,
            await fs.promises.readFile(file.path),
            file.mimetype
          );
        }
        await upsertMediaAsset({
          filename: file.filename,
          kind: 'images',
          upload_token_hash: ownerHash,
          listing_id: null,
        });
      }
    } catch (error) {
      next(error);
      return;
    }

    res.json({
      urls: files.map((f) => `/uploads/images/${f.filename}`),
    });
  });
});

app.post('/api/upload/video', (req, res, next) => {
  if (!verifySameOrigin(req)) {
    res.status(403).json({ error: 'مصدر الطلب غير مصرح به.' });
    return;
  }
  if (!checkUploadRateLimit(req, res)) return;

  uploadVideo.single('video')(req, res, async (err: any) => {
    if (err) {
      res.status(400).json({
        error:
          err.code === 'LIMIT_FILE_SIZE'
            ? 'حجم الفيديو يتجاوز الحد المسموح (35 ميجابايت).'
            : err.message || 'تعذر رفع الفيديو.',
      });
      return;
    }
    const file = req.file;
    if (!file) {
      res.status(400).json({ error: 'لم يتم إرفاق أي ملف فيديو.' });
      return;
    }

    if (!validateMagicBytes(file.path, 'videos')) {
      try {
        fs.unlinkSync(file.path);
      } catch {
        // ignore
      }
      res.status(400).json({ error: 'تم رفض الملف: محتوى الفيديو غير صالح أو غير مدعوم.' });
      return;
    }

    try {
      fs.chmodSync(file.path, 0o640);
    } catch {
      // ignore
    }

    const ownerSid = getOrCreateOwnerMediaCookie(req, res);
    try {
      if (isMediaStorageWriteEnabled()) {
        await getMediaStorageRepository().upload(
          'videos',
          file.filename,
          await fs.promises.readFile(file.path),
          file.mimetype
        );
      }
      await upsertMediaAsset({
        filename: file.filename,
        kind: 'videos',
        upload_token_hash: sha256(ownerSid),
        listing_id: null,
      });
    } catch (error) {
      next(error);
      return;
    }

    res.json({ url: `/uploads/videos/${file.filename}` });
  });
});

// Live Connectivity Health Check (uncached)
app.get('/api/health', (_req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('X-Darajati-Live', '1');
  res.json({ ok: true, ts: Date.now() });
});

app.post('/api/favorites/sync', async (req, res, next) => {
  if (!verifySameOrigin(req) || req.headers['x-requested-with'] !== 'Darajati-Client') {
    res.status(403).json({ error: 'مصدر الطلب غير مصرح به.' });
    return;
  }
  const localFavorites = req.body?.favorites;
  if (!Array.isArray(localFavorites) || localFavorites.length > 500 ||
      localFavorites.some((id) => !Number.isSafeInteger(id) || id <= 0)) {
    res.status(400).json({ error: 'قائمة المفضلة غير صالحة.' });
    return;
  }

  try {
    const deviceId = getOrCreateFavoritesDeviceId(req, res);
    const favorites = await importDeviceFavoritesOnce(
      sha256(deviceId),
      [...new Set(localFavorites as number[])]
    );
    res.setHeader('Cache-Control', 'no-store');
    res.json({ favorites });
  } catch (error) {
    next(error);
  }
});

app.put('/api/favorites/:id', async (req, res, next) => {
  if (!verifySameOrigin(req) || req.headers['x-requested-with'] !== 'Darajati-Client') {
    res.status(403).json({ error: 'مصدر الطلب غير مصرح به.' });
    return;
  }
  const listingId = Number(req.params.id);
  if (!Number.isSafeInteger(listingId) || listingId <= 0) {
    res.status(400).json({ error: 'معرف المنشور غير صالح.' });
    return;
  }
  const deviceId = getFavoritesDeviceId(req);
  if (!deviceId) {
    res.status(409).json({ error: 'يجب مزامنة المفضلة أولاً.' });
    return;
  }

  try {
    const listing = await getListingById(listingId);
    if (!listing || !isPublicListing(listing)) {
      res.status(404).json({ error: 'المنشور غير موجود.' });
      return;
    }
    await addDeviceFavorite(sha256(deviceId), listingId);
    res.setHeader('Cache-Control', 'no-store');
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.delete('/api/favorites/:id', async (req, res, next) => {
  if (!verifySameOrigin(req) || req.headers['x-requested-with'] !== 'Darajati-Client') {
    res.status(403).json({ error: 'مصدر الطلب غير مصرح به.' });
    return;
  }
  const listingId = Number(req.params.id);
  if (!Number.isSafeInteger(listingId) || listingId <= 0) {
    res.status(400).json({ error: 'معرف المنشور غير صالح.' });
    return;
  }
  const deviceId = getFavoritesDeviceId(req);
  if (!deviceId) {
    res.json({ ok: true });
    return;
  }

  try {
    await removeDeviceFavorite(sha256(deviceId), listingId);
    res.setHeader('Cache-Control', 'no-store');
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

// Public Categories
app.get('/api/categories', async (_req, res, next) => {
  try {
    res.json(await listPublicCategories());
  } catch (error) {
    next(error);
  }
});

// Public Sliders
app.get('/api/sliders', async (_req, res, next) => {
  try {
    res.json(await listPublicSliders());
  } catch (error) {
    next(error);
  }
});

app.get('/api/slider-settings', async (_req, res, next) => {
  try {
    res.json(await getPublicSliderSettings());
  } catch (error) {
    next(error);
  }
});

// Smart Search Endpoint
app.get('/api/search', async (req, res, next) => {
  const q = String(req.query.q || '').trim().slice(0, 200);
  const governorate = String(req.query.governorate || '').trim().slice(0, 60);
  const categoryId = req.query.categoryId ? Number(req.query.categoryId) : null;
  const minPrice = req.query.minPrice ? Number(req.query.minPrice) : null;
  const maxPrice = req.query.maxPrice ? Number(req.query.maxPrice) : null;
  const rawSort = String(req.query.sort || 'newest');
  const sort = (['newest', 'price_asc', 'price_desc'].includes(rawSort) ? rawSort : 'newest') as
    | 'newest'
    | 'price_asc'
    | 'price_desc';
  const hideDemo = req.query.hideDemo === '1' || req.query.hideDemo === 'true';
  const conditionFilter =
    req.query.condition === 'new' || req.query.condition === 'used' ? req.query.condition : null;
  const brandFilter = String(req.query.brand || '').trim().slice(0, 80);
  const ignoredChips = String(req.query.ignoredChips || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 15);

  try {
    const searchData = await loadListingSearchData(
      { statuses: ['approved', 'sold'], includeDemo: false }
    );
    res.json(
      runSmartSearch(
        {
          q,
          governorate,
          categoryId,
          minPrice,
          maxPrice,
          sort,
          hideDemo,
          ignoredChips,
          conditionFilter,
          brandFilter,
        },
        formatListingRow,
        searchData
      )
    );
  } catch (error) {
    next(error);
  }
});

// Live Autocomplete Suggestions
app.get('/api/search/suggestions', async (req, res, next) => {
  const q = String(req.query.q || '').trim().slice(0, 200);
  try {
    const searchData = await loadListingSearchData({
      statuses: ['approved'],
      includeDemo: false,
    });
    res.json(getSmartSuggestions(q, searchData));
  } catch (error) {
    next(error);
  }
});

// Public Listings
app.get('/api/listings', async (req, res, next) => {
  const q = String(req.query.q || '').trim().slice(0, 200);
  const governorate = String(req.query.governorate || '').trim().slice(0, 60);
  const categoryId = req.query.categoryId ? Number(req.query.categoryId) : null;
  const minPrice = req.query.minPrice ? Number(req.query.minPrice) : null;
  const maxPrice = req.query.maxPrice ? Number(req.query.maxPrice) : null;
  const rawSort = String(req.query.sort || 'newest');
  const sort = (['newest', 'price_asc', 'price_desc'].includes(rawSort) ? rawSort : 'newest') as
    | 'newest'
    | 'price_asc'
    | 'price_desc';
  const hideDemo = req.query.hideDemo === '1' || req.query.hideDemo === 'true';

  try {
    const searchData = await loadListingSearchData({
      statuses: ['approved', 'sold'],
      includeDemo: false,
    });
    const result = runSmartSearch(
      { q, governorate, categoryId, minPrice, maxPrice, sort, hideDemo },
      formatListingRow,
      searchData
    );
    res.json(result.items);
  } catch (error) {
    next(error);
  }
});

// Get single listing (pending/rejected restricted to owner or admin!)
app.get('/api/listings/:id', async (req, res, next) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: 'معرف المنشور غير صالح.' });
    return;
  }

  try {
    const row = await getListingById(id);
    if (!row) {
      res.status(404).json({ error: 'المنشور غير موجود أو تم حذفه.' });
      return;
    }

    let role: 'admin' | 'owner' | null;
    try {
      role = await verifyOwnerOrAdmin(req, res, row);
    } catch (error) {
      next(error);
      return;
    }
    if (!isPublicListing(row) && !role) {
      res.status(403).json({ error: 'هذا المنشور قيد المراجعة حالياً ولا يمكن عرضه للعامة بعد.' });
      return;
    }

    res.json({
      listing: formatListingRow(row, Boolean(role)),
      isOwner: role === 'owner' || role === 'admin',
    });
  } catch (error) {
    next(error);
  }
});

app.get('/api/listings/:id/contact', async (req, res, next) => {
  const id = Number(req.params.id);
  const channel = String(req.query.channel || '');
  if (
    !Number.isInteger(id) ||
    id <= 0 ||
    (channel !== 'call' && channel !== 'whatsapp')
  ) {
    res.status(400).json({ error: 'طلب التواصل غير صالح.' });
    return;
  }
  if (!allowPublicContactRedirect(getClientIp(req))) {
    res.status(429).json({ error: 'تم تجاوز عدد محاولات التواصل، حاول لاحقاً.' });
    return;
  }

  try {
    const contact = await getPublicListingContact(id);
    if (!contact) {
      res.status(404).json({ error: 'الإعلان غير متاح للتواصل.' });
      return;
    }

    const normalizedPhone = normalizePhoneServer(contact.phone);
    const target = createPublicContactTarget(
      normalizedPhone,
      contact.title,
      contact.price_iqd,
      channel
    );
    if (!target) {
      res.status(404).json({ error: 'الإعلان غير متاح للتواصل.' });
      return;
    }

    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.setHeader('Referrer-Policy', 'no-referrer');
    if (req.query.format === 'json') {
      res.json({ url: target });
      return;
    }
    res.redirect(302, target);
  } catch (error) {
    next(error);
  }
});

// Create listing: server ALWAYS enforces initialStatus = 'pending' and ignores any client role/status!
app.post('/api/listings', async (req, res, next) => {
  if (!verifySameOrigin(req)) {
    res.status(403).json({ error: 'مصدر الطلب غير مصرح به.' });
    return;
  }

  const {
    title,
    brand = '',
    category_id,
    governorate,
    area = '',
    model_year,
    engine_cc = null,
    motor_watts = null,
    condition,
    price_iqd,
    negotiable = false,
    phone,
    description,
    keywords = '',
    images,
    video_url = null,
  } = req.body || {};

  const errors: Record<string, string> = {};

  // The simplified public posting form does not collect location.

  const requestedCategoryId = Number(category_id);
  let cat: Awaited<ReturnType<typeof getCategoryForListing>>;
  try {
    cat =
      Number.isInteger(requestedCategoryId) && requestedCategoryId > 0
        ? await getCategoryForListing(requestedCategoryId)
        : null;
  } catch (error) {
    next(error);
    return;
  }
  if (!cat) {
    errors.category_id = 'يرجى اختيار القسم المناسب.';
  }

  const cleanTitle = String(title || '').trim().slice(0, 120);
  if (cleanTitle.length < 3) {
    errors.title = cat?.is_parts_or_accessories
      ? 'يرجى إدخال اسم القطعة أو المنتج (3 أحرف على الأقل).'
      : 'يرجى إدخال اسم الدراجة (3 أحرف على الأقل).';
  }

  const parsedYear = model_year !== null && model_year !== undefined && model_year !== '' ? Number(model_year) : null;
  if (!cat?.is_parts_or_accessories) {
    if (parsedYear === null || Number.isNaN(parsedYear) || parsedYear < 1970 || parsedYear > new Date().getFullYear() + 1) {
      errors.model_year = 'يرجى إدخال سنة صنع صحيحة.';
    }
  } else if (parsedYear !== null && (Number.isNaN(parsedYear) || parsedYear < 1970 || parsedYear > new Date().getFullYear() + 1)) {
    errors.model_year = 'سنة الصنع غير صحيحة.';
  }

  const parsedCc =
    engine_cc !== null && engine_cc !== undefined && engine_cc !== '' ? Number(engine_cc) : null;
  if (parsedCc !== null && (Number.isNaN(parsedCc) || parsedCc < 30 || parsedCc > 2500)) {
    errors.engine_cc = 'سعة المحرك (سي سي) يجب أن تكون بين 30 و 2500.';
  }

  const parsedWatts =
    motor_watts !== null && motor_watts !== undefined && motor_watts !== '' ? Number(motor_watts) : null;
  if (parsedWatts !== null && (Number.isNaN(parsedWatts) || parsedWatts < 100 || parsedWatts > 20000)) {
    errors.motor_watts = 'قدرة المحرك الكهربائي (واط) يجب أن تكون بين 100 و 20000.';
  }

  if (condition !== 'new' && condition !== 'used') {
    errors.condition = 'يرجى تحديد الحالة (جديدة أو مستعملة).';
  }

  const parsedPrice = Number(price_iqd);
  if (!parsedPrice || Number.isNaN(parsedPrice) || parsedPrice < 1000 || parsedPrice > 1_000_000_000) {
    errors.price_iqd = 'يرجى إدخال سعر صحيح بالدينار العراقي.';
  }

  const cleanGovernorate = typeof governorate === 'string' ? governorate.trim().slice(0, 60) : '';
  const cleanArea = typeof area === 'string' ? area.trim().slice(0, 80) : '';
  const cleanPhone = normalizePhoneServer(phone);
  const cleanDesc = String(description || title || '').trim().slice(0, 3000);

  const cleanImages = Array.isArray(images)
    ? images
        .map((img, idx) => {
          const safeUrl = sanitizeMediaUrl(img?.url, 'image');
          if (!safeUrl) return null;
          return { url: safeUrl, isCover: Boolean(img?.isCover) || idx === 0 };
        })
        .filter((x): x is { url: string; isCover: boolean } => x !== null)
        .slice(0, 1)
    : [];

  if (cleanImages.length === 0) {
    errors.images = 'يرجى رفع صورة واحدة على الأقل بصيغة صالحة.';
  } else if (Array.isArray(images) && images.length !== 1) {
    errors.images = 'يرجى رفع صورة واحدة فقط للمنشور.';
  } else if (!cleanImages.some((i) => i.isCover)) {
    cleanImages[0].isCover = true;
  }

  const cleanVideoUrl = video_url ? sanitizeMediaUrl(video_url, 'video') : null;
  if (video_url && !cleanVideoUrl) {
    errors.video_url = 'رابط الفيديو غير صالح.';
  }

  if (Object.keys(errors).length > 0) {
    res.status(400).json({ error: 'توجد حقول تتطلب المراجعة.', fieldErrors: errors });
    return;
  }
  if (!cat) {
    res.status(400).json({ error: 'توجد حقول تتطلب المراجعة.', fieldErrors: errors });
    return;
  }

  const ownerToken = generateToken(24);
  const ownerCode = generateOwnerCode();
  const initialStatus = 'pending'; // Exclusively pending on creation; Admin alone can approve!

  try {
    const created = await insertListing({
      title: cleanTitle,
      brand: String(brand || '').trim().slice(0, 80),
      category_id: cat.id,
      governorate: cleanGovernorate,
      area: cleanArea,
      model_year: parsedYear,
      engine_cc: parsedCc ? Math.round(parsedCc) : null,
      motor_watts: parsedWatts ? Math.round(parsedWatts) : null,
      condition,
      price_iqd: Math.round(parsedPrice),
      negotiable: negotiable ? 1 : 0,
      phone: cleanPhone,
      description: cleanDesc,
      keywords: String(keywords || '').trim().slice(0, 300),
      images_json: cleanImages,
      video_url: cleanVideoUrl,
      status: initialStatus,
      is_demo: 0,
      is_hidden: 0,
      owner_token_hash: sha256(ownerToken),
      owner_code_hash: sha256(ownerCode),
    });

    const listingId = created.id;
    const ownerSid = getOrCreateOwnerMediaCookie(req, res);
    await addOwnerMediaGrant(sha256(ownerSid), listingId);

    for (const image of cleanImages) {
      if (image.url.startsWith('/uploads/images/')) {
        await associateListingMedia(path.basename(image.url), 'images', listingId);
      }
    }
    if (cleanVideoUrl?.startsWith('/uploads/videos/')) {
      await associateListingMedia(path.basename(cleanVideoUrl), 'videos', listingId);
    }

    await insertAdminNotification({
      type: 'new_listing',
      title: 'طلب نشر دراجة/منتج جديد قيد المراجعة',
      body: `${cleanTitle} · ${String(governorate).trim()}`,
      target_section: 'pending',
      target_id: listingId,
    });

    res.status(201).json({
      listing: formatListingRow(created, true),
      ownerToken,
      ownerCode,
    });
  } catch (error) {
    next(error);
  }
});

// Rate limit owner code verification to prevent brute force
const ownerCodeAttempts = new Map<string, { count: number; windowStart: number; lockedUntil: number }>();

app.post('/api/listings/:id/verify-owner', async (req, res, next) => {
  if (!verifySameOrigin(req)) {
    res.status(403).json({ error: 'مصدر الطلب غير مصرح به.' });
    return;
  }

  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: 'معرف المنشور غير صالح.' });
    return;
  }

  const key = `${getClientIp(req)}:${id}`;
  const now = Date.now();
  const rec = ownerCodeAttempts.get(key);
  if (rec && rec.lockedUntil > now) {
    res.status(429).json({ error: 'تم تجاوز عدد المحاولات المسموح به، حاول لاحقاً.' });
    return;
  }

  const code = String(req.body?.ownerCode || '').trim().toUpperCase();
  try {
    const row = await getListingById(id);
    if (!row) {
      res.status(404).json({ error: 'المنشور غير موجود.' });
      return;
    }
    if (!code || !row.owner_code_hash || !safeEqualStrings(sha256(code), row.owner_code_hash)) {
      const fresh = !rec || now - rec.windowStart > 15 * 60 * 1000;
      const count = fresh ? 1 : rec.count + 1;
      const lockedUntil = count >= 8 ? now + 15 * 60 * 1000 : 0;
      ownerCodeAttempts.set(key, {
        count,
        windowStart: fresh ? now : rec.windowStart,
        lockedUntil,
      });
      res.status(403).json({ error: 'كود المالك غير صحيح.' });
      return;
    }

    ownerCodeAttempts.delete(key);
    const newToken = generateToken(24);
    const updated = await updateListing(id, { owner_token_hash: sha256(newToken) });
    if (!updated) {
      res.status(404).json({ error: 'المنشور غير موجود.' });
      return;
    }

    const ownerSid = getOrCreateOwnerMediaCookie(req, res);
    await addOwnerMediaGrant(sha256(ownerSid), id);
    res.json({ ownerToken: newToken });
  } catch (error) {
    next(error);
  }
});

// Owner or Admin updates listing status
app.patch('/api/listings/:id/status', async (req, res, next) => {
  if (!verifySameOrigin(req)) {
    res.status(403).json({ error: 'مصدر الطلب غير مصرح به.' });
    return;
  }
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: 'معرف المنشور غير صالح.' });
    return;
  }

  let row: ListingRecord | null;
  try {
    row = await getListingById(id);
  } catch (error) {
    next(error);
    return;
  }
  if (!row) {
    res.status(404).json({ error: 'المنشور غير موجود.' });
    return;
  }
  let role: 'admin' | 'owner' | null;
  try {
    role = await verifyOwnerOrAdmin(req, res, row);
  } catch (error) {
    next(error);
    return;
  }
  if (!role) {
    res.status(403).json({ error: 'غير مصرح لك بتعديل حالة هذا المنشور.' });
    return;
  }

  if (role === 'admin') {
    let adminSession: AdminSessionContext | null;
    try {
      adminSession = await getAdminSession(req, res, { touchActivity: true });
    } catch (error) {
      next(error);
      return;
    }
    const headerCsrf = String(req.headers['x-csrf-token'] || '').trim();
    if (!adminSession || !safeEqualStrings(headerCsrf, adminSession.csrfToken)) {
      res.status(403).json({ error: 'تعذر التحقق من رمز الحماية (CSRF).' });
      return;
    }
  }

  const nextStatus = String(req.body?.status || '');
  if (role === 'owner') {
    if (!['sold', 'approved'].includes(nextStatus)) {
      res.status(400).json({ error: 'الحالة غير صالحة.' });
      return;
    }
    if (row.status === 'pending' || row.status === 'rejected') {
      res.status(403).json({ error: 'لا يمكن تغيير حالة البيع قبل اعتماد المنشور من الإدارة.' });
      return;
    }
  } else if (!['pending', 'approved', 'sold', 'rejected'].includes(nextStatus)) {
    res.status(400).json({ error: 'الحالة غير صالحة.' });
    return;
  }

  try {
    const updated = await updateListing(id, { status: nextStatus as ListingRecord['status'] });
    if (!updated) {
      res.status(404).json({ error: 'المنشور غير موجود.' });
      return;
    }
    if (role === 'admin') {
      await recordCatalogAudit('listing_status_changed', 'admin', getClientIp(req), 'listing', String(id), `status=${nextStatus}`);
    }
    res.json({ listing: formatListingRow(updated, true) });
  } catch (error) {
    next(error);
  }
});

// Owner or Admin edits listing fields
app.patch('/api/listings/:id', async (req, res, next) => {
  if (!verifySameOrigin(req)) {
    res.status(403).json({ error: 'مصدر الطلب غير مصرح به.' });
    return;
  }
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: 'معرف المنشور غير صالح.' });
    return;
  }
  let row: ListingRecord | null;
  try {
    row = await getListingById(id);
  } catch (error) {
    next(error);
    return;
  }
  if (!row) {
    res.status(404).json({ error: 'المنشور غير موجود.' });
    return;
  }
  let role: 'admin' | 'owner' | null;
  try {
    role = await verifyOwnerOrAdmin(req, res, row);
  } catch (error) {
    next(error);
    return;
  }
  if (!role) {
    res.status(403).json({ error: 'غير مصرح لك بتعديل هذا المنشور.' });
    return;
  }
  if (role === 'admin') {
    let adminSession: AdminSessionContext | null;
    try {
      adminSession = await getAdminSession(req, res, { touchActivity: true });
    } catch (error) {
      next(error);
      return;
    }
    const headerCsrf = String(req.headers['x-csrf-token'] || '').trim();
    if (!adminSession || !safeEqualStrings(headerCsrf, adminSession.csrfToken)) {
      res.status(403).json({ error: 'تعذر التحقق من رمز الحماية (CSRF).' });
      return;
    }
  }

  const body = req.body || {};
  const title = body.title !== undefined ? String(body.title).trim().slice(0, 120) : row.title;
  const brand = body.brand !== undefined ? String(body.brand).trim().slice(0, 80) : row.brand;
  const price_iqd = body.price_iqd !== undefined ? Number(body.price_iqd) : row.price_iqd;
  const negotiable = body.negotiable !== undefined ? (body.negotiable ? 1 : 0) : row.negotiable;
  const area = body.area !== undefined ? String(body.area).trim().slice(0, 80) : row.area;
  const governorate = body.governorate !== undefined ? String(body.governorate).trim().slice(0, 60) : row.governorate;
  const description = body.description !== undefined ? String(body.description).trim().slice(0, 3000) : row.description;
  const keywords = body.keywords !== undefined ? String(body.keywords).trim().slice(0, 300) : row.keywords;
  const model_year = body.model_year !== undefined ? (body.model_year ? Number(body.model_year) : null) : row.model_year;
  const engine_cc = body.engine_cc !== undefined ? (body.engine_cc ? Number(body.engine_cc) : null) : row.engine_cc;
  const motor_watts = body.motor_watts !== undefined ? (body.motor_watts ? Number(body.motor_watts) : null) : row.motor_watts;
  const condition = body.condition === 'new' || body.condition === 'used' ? body.condition : row.condition;
  const phone = body.phone !== undefined ? normalizePhoneServer(body.phone) : row.phone;

  // Handle images and video updates (admin can replace full media set)
  let imagesJson = row.images_json;
  let videoUrl = row.video_url;
  if (body.images !== undefined) {
    imagesJson = Array.isArray(body.images) ? body.images : [];
  }
  if (body.video_url !== undefined) {
    videoUrl = typeof body.video_url === 'string' ? body.video_url.trim() || null : null;
  }

  // Only Admin may alter status
  const status =
    role === 'admin' && ['pending', 'approved', 'sold', 'rejected'].includes(String(body.status || ''))
      ? String(body.status)
      : row.status;

  if (
    title.length < 3 ||
    !price_iqd ||
    Number.isNaN(price_iqd) ||
    price_iqd < 1000 ||
    description.length < 10 ||
    !/^07[3-9]\d{8}$/.test(phone)
  ) {
    res.status(400).json({ error: 'يرجى التحقق من صحة البيانات المدخلة.' });
    return;
  }

  try {
    const updated = await updateListing(id, {
      title,
      brand,
      price_iqd: Math.round(price_iqd),
      negotiable,
      area,
      governorate,
      description,
      keywords,
      model_year,
      engine_cc: engine_cc ? Math.round(engine_cc) : null,
      motor_watts: motor_watts ? Math.round(motor_watts) : null,
      condition,
      phone,
      status: status as ListingRecord['status'],
      images_json: imagesJson,
      video_url: videoUrl,
    });
    if (!updated) {
      res.status(404).json({ error: 'المنشور غير موجود.' });
      return;
    }
    if (role === 'admin') {
      await recordCatalogAudit('listing_updated', 'admin', getClientIp(req), 'listing', String(id));
    }
    res.json({ listing: formatListingRow(updated, true) });
  } catch (error) {
    next(error);
  }
});

// Owner or Admin deletes listing
app.delete('/api/listings/:id', async (req, res, next) => {
  if (!verifySameOrigin(req)) {
    res.status(403).json({ error: 'مصدر الطلب غير مصرح به.' });
    return;
  }
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: 'معرف المنشور غير صالح.' });
    return;
  }
  let row: ListingRecord | null;
  try {
    row = await getListingById(id);
  } catch (error) {
    next(error);
    return;
  }
  if (!row) {
    res.status(404).json({ error: 'المنشور غير موجود.' });
    return;
  }
  let role: 'admin' | 'owner' | null;
  try {
    role = await verifyOwnerOrAdmin(req, res, row);
  } catch (error) {
    next(error);
    return;
  }
  if (!role) {
    res.status(403).json({ error: 'غير مصرح لك بحذف هذا المنشور.' });
    return;
  }
  if (role === 'admin') {
    let adminSession: AdminSessionContext | null;
    try {
      adminSession = await getAdminSession(req, res, { touchActivity: true });
    } catch (error) {
      next(error);
      return;
    }
    const headerCsrf = String(req.headers['x-csrf-token'] || '').trim();
    if (!adminSession || !safeEqualStrings(headerCsrf, adminSession.csrfToken)) {
      res.status(403).json({ error: 'تعذر التحقق من رمز الحماية (CSRF).' });
      return;
    }
  }

  try {
    const deleted = await deleteListing(id);
    if (!deleted) {
      res.status(404).json({ error: 'المنشور غير موجود.' });
      return;
    }
    if (role === 'admin') {
      await recordCatalogAudit('listing_deleted', 'admin', getClientIp(req), 'listing', String(id));
    }
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

// Report listing (only approved/sold public listings can be reported publicly)
app.post('/api/reports', async (req, res, next) => {
  if (!verifySameOrigin(req)) {
    res.status(403).json({ error: 'مصدر الطلب غير مصرح به.' });
    return;
  }
  const listing_id = Number(req.body?.listing_id);
  const reason = String(req.body?.reason || '').trim().slice(0, 120);
  const details = String(req.body?.details || '').trim().slice(0, 1000);

  if (!Number.isInteger(listing_id) || listing_id <= 0 || !reason) {
    res.status(400).json({ error: 'يرجى تحديد سبب الإبلاغ.' });
    return;
  }
  try {
    await createListingReport({ listing_id, reason, details });
    res.status(201).json({ ok: true });
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'LISTING_NOT_FOUND') {
      res.status(404).json({ error: 'المنشور غير موجود.' });
      return;
    }
    next(error);
  }
});

// Track unique public visits
app.post('/api/analytics/visit', async (req, res, next) => {
  try {
    if (await getAdminSession(req, res, { touchActivity: false })) {
      res.json({ counted: false });
      return;
    }
    const sessionId = String(req.body?.sessionId || '').trim();
    if (!sessionId || sessionId.length > 128) {
      res.status(400).json({ error: 'جلسة غير صالحة.' });
      return;
    }
    res.json({ counted: await recordSiteVisitOnce(sessionId) });
  } catch (error) {
    next(error);
  }
});

// ================= ADMIN AUTH & HARDENED MANAGEMENT =================

const PIN_MAX_ATTEMPTS = 5;
const PIN_WINDOW_MS = 15 * 60 * 1000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

app.get('/api/admin/auth-status', async (req, res, next) => {
  try {
    const session = await getAdminSession(req, res, { touchActivity: false });
    if (!session) {
      res.json({ authenticated: false, username: null, csrfToken: null });
      return;
    }
    res.json({
      authenticated: true,
      username: session.username,
      role: session.role,
      csrfToken: session.csrfToken,
    });
  } catch (error) {
    next(error);
  }
});

app.post('/api/admin/verify-pin', async (req, res, next) => {
  if (!verifySameOrigin(req)) {
    res.status(403).json({ error: 'تعذّر المتابعة' });
    return;
  }
  if (req.headers['x-requested-with'] !== 'Darajati-Client') {
    res.status(403).json({ error: 'تعذّر المتابعة' });
    return;
  }

  try {
    const clientKey = getClientIp(req).slice(0, 80);
    const now = Date.now();
    const rateRow = await getAdminAuthRateLimit(clientKey);

    if (rateRow && rateRow.locked_until > now) {
      const minutesLeft = Math.max(1, Math.ceil((rateRow.locked_until - now) / 60000));
      await logAudit('login_rate_limited', 'anonymous', clientKey, 'auth', '', `locked_minutes=${minutesLeft}`);
      res.setHeader('Retry-After', String(Math.ceil((rateRow.locked_until - now) / 1000)));
      res.status(429).json({ error: 'تعذّر المتابعة مؤقتاً، حاول لاحقاً' });
      return;
    }

    const pinHash = await getAdminPinHash();
    if (!pinHash || !pinHash.includes(':')) {
      res.status(503).json({ error: 'تعذّر المتابعة' });
      return;
    }

    const normalizedPin = normalizeDigitsServer(String(req.body?.pin || ''));
    const isMatch =
      normalizedPin.length >= 4 &&
      normalizedPin.length <= 128 &&
      verifyPassword(normalizedPin, pinHash);

    if (!isMatch) {
      const failedAttempt = await recordAdminAuthFailure({
        clientKey,
        now,
        windowMs: PIN_WINDOW_MS,
        maxAttempts: PIN_MAX_ATTEMPTS,
        maxLockLevel: 5,
        baseLockMinutes: 5,
        maxLockMinutes: 60,
      });
      await logAudit('login_failed', 'anonymous', clientKey, 'auth', '', `attempt=${failedAttempt.attempt}`);
      await sleep(Math.min(3500, failedAttempt.attempt * 600));

      if (failedAttempt.locked_until > 0) {
        res.setHeader('Retry-After', String(Math.ceil((failedAttempt.locked_until - now) / 1000)));
        res.status(429).json({ error: 'تعذّر المتابعة مؤقتاً، حاول لاحقاً' });
        return;
      }

      res.status(401).json({ error: 'تعذّر المتابعة' });
      return;
    }

    await clearAdminAuthRateLimit(clientKey);
    await deleteExpiredAdminSessions(now, IDLE_TIMEOUT_MS);

    const sessionToken = generateToken(32);
    const csrfToken = generateToken(32);
    const expiresAt = now + MAX_SESSION_MS;
    await createAdminSession({
      token_hash: sha256(sessionToken),
      username: 'admin',
      role: 'admin',
      csrf_token: csrfToken,
      last_activity_at: now,
      expires_at: expiresAt,
      ip_address: clientKey,
      user_agent: String(req.headers['user-agent'] || '').slice(0, 200),
    });

    setCookie(req, res, ADMIN_COOKIE_NAME, sessionToken, Math.floor(MAX_SESSION_MS / 1000));
    await logAudit('login_success', 'admin', clientKey, 'session', '');

    res.json({
      authenticated: true,
      username: 'admin',
      role: 'admin',
      csrfToken,
    });
  } catch (error) {
    next(error);
  }
});

app.post('/api/admin/logout', async (req, res, next) => {
  if (!verifySameOrigin(req)) {
    res.status(403).json({ error: 'مصدر الطلب غير مصرح به.' });
    return;
  }
  try {
    const session = await getAdminSession(req, res, { touchActivity: false });
    if (session) {
      const headerCsrf = String(req.headers['x-csrf-token'] || '').trim();
      if (!safeEqualStrings(headerCsrf, session.csrfToken) && req.headers['x-requested-with'] !== 'Darajati-Client') {
        res.status(403).json({ error: 'طلب غير مصرح به.' });
        return;
      }
      await deleteAdminSession(session.tokenHash);
      await logAudit('logout', session.username, getClientIp(req), 'session', '');
    }
    clearCookie(req, res, ADMIN_COOKIE_NAME);
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

// Admin Listings
app.get('/api/admin/listings', requireAdmin, async (req, res, next) => {
  const status = String(req.query.status || 'all');
  const validStatus = ['pending', 'approved', 'sold', 'rejected'].includes(status);
  try {
    const rows = await listListings(
      {
        statuses: validStatus ? [status] : undefined,
        includeHidden: true,
        includeDemo: true,
        includeContact: true,
      }
    );
    rows.sort((a, b) => {
      if (a.status === 'pending' && b.status !== 'pending') return -1;
      if (b.status === 'pending' && a.status !== 'pending') return 1;
      return String(b.created_at).localeCompare(String(a.created_at));
    });
    res.json(rows.map((row) => formatListingRow(row, true)));
  } catch (error) {
    next(error);
  }
});

// Toggle hide/republish a listing (admin only)
app.patch('/api/admin/listings/:id/toggle-hide', requireAdmin, async (req, res, next) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: 'معرف المنشور غير صالح.' });
    return;
  }
  let row: ListingRecord | null;
  try {
    row = await getListingById(id);
  } catch (error) {
    next(error);
    return;
  }
  if (!row) {
    res.status(404).json({ error: 'المنشور غير موجود.' });
    return;
  }
  let adminSession: AdminSessionContext | null;
  try {
    adminSession = await getAdminSession(req, res, { touchActivity: true });
  } catch (error) {
    next(error);
    return;
  }
  const headerCsrf = String(req.headers['x-csrf-token'] || '').trim();
  if (!adminSession || !safeEqualStrings(headerCsrf, adminSession.csrfToken)) {
    res.status(403).json({ error: 'تعذر التحقق من رمز الحماية (CSRF).' });
    return;
  }

  const isHidden = req.body?.is_hidden === true || req.body?.is_hidden === 1 || req.body?.is_hidden === 'true';
  const nextHidden = isHidden ? 1 : 0;

  try {
    const updated = await updateListing(id, { is_hidden: nextHidden });
    if (!updated) {
      res.status(404).json({ error: 'المنشور غير موجود.' });
      return;
    }

    await recordCatalogAudit(
      nextHidden === 1 ? 'listing_hidden' : 'listing_republished',
      'admin',
      getClientIp(req),
      'listing',
      String(id),
      `is_hidden=${nextHidden}`
    );
    res.json({
      listing: formatListingRow(updated, true),
      is_hidden: Boolean(updated.is_hidden),
    });
  } catch (error) {
    next(error);
  }
});

app.delete('/api/admin/demo-listings', requireAdmin, async (req, res, next) => {
  try {
    const deleted = await deleteDemoListings();
    await recordCatalogAudit('demo_listings_deleted', 'admin', getClientIp(req), 'listings', 'demo', `deleted=${deleted}`);
    res.json({ deleted });
  } catch (error) {
    next(error);
  }
});

// Admin Categories
app.post('/api/admin/categories', requireAdmin, async (req, res, next) => {
  const name_ar = String(req.body?.name_ar || '').trim().slice(0, 80);
  const slug = String(req.body?.slug || `cat-${Date.now()}`).trim().slice(0, 64);
  const image_url = sanitizeMediaUrl(req.body?.image_url, 'image');
  const is_parts_or_accessories = req.body?.is_parts_or_accessories ? 1 : 0;
  const sort_order = Number(req.body?.sort_order || 10);

  if (!name_ar || !image_url) {
    res.status(400).json({ error: 'يرجى إدخال اسم القسم ورفع صورة صالحة للقسم.' });
    return;
  }

  try {
    const created = await createCategory({
      slug,
      name_ar,
      image_url,
      is_parts_or_accessories,
      sort_order: Number.isFinite(sort_order) ? sort_order : 10,
    });
    await recordCatalogAudit(
      'category_created',
      'admin',
      getClientIp(req),
      'category',
      String(created.id),
      name_ar
    );
    res.status(201).json({
      ...created,
      is_parts_or_accessories: Boolean(created.is_parts_or_accessories),
    });
  } catch (error) {
    if (error instanceof CatalogRepositoryError && error.code === '23505') {
      res.status(400).json({ error: 'تعذر إضافة القسم، قد يكون الاسم أو المعرف مستخدماً مسبقاً.' });
      return;
    }
    next(error);
  }
});

app.patch('/api/admin/categories/:id', requireAdmin, async (req, res, next) => {
  const id = Number(req.params.id);
  try {
    const existing = await getCategory(id);
    if (!existing) {
      res.status(404).json({ error: 'القسم غير موجود.' });
      return;
    }

    const name_ar = req.body?.name_ar !== undefined ? String(req.body.name_ar).trim().slice(0, 80) : existing.name_ar;
    const image_url =
      req.body?.image_url !== undefined ? sanitizeMediaUrl(req.body.image_url, 'image') : existing.image_url;
    if (!name_ar || !image_url) {
      res.status(400).json({ error: 'بيانات القسم أو رابط الصورة غير صالح.' });
      return;
    }
    const is_parts_or_accessories =
      req.body?.is_parts_or_accessories !== undefined
        ? req.body.is_parts_or_accessories
          ? 1
          : 0
        : existing.is_parts_or_accessories;
    const sort_order = req.body?.sort_order !== undefined ? Number(req.body.sort_order) : existing.sort_order;

    const updated = await updateCategory(id, {
      name_ar,
      image_url,
      is_parts_or_accessories,
      sort_order: Number.isFinite(sort_order) ? sort_order : 10,
    });
    if (!updated) {
      res.status(404).json({ error: 'القسم غير موجود.' });
      return;
    }

    await recordCatalogAudit('category_updated', 'admin', getClientIp(req), 'category', String(id), name_ar);
    res.json({ ...updated, is_parts_or_accessories: Boolean(updated.is_parts_or_accessories) });
  } catch (error) {
    next(error);
  }
});

app.delete('/api/admin/categories/:id', requireAdmin, async (req, res, next) => {
  const id = Number(req.params.id);
  try {
    if (await categoryHasListings(id)) {
      res.status(400).json({ error: 'لا يمكن حذف قسم يحتوي على منشورات حالية. احذف أو انقل المنشورات أولاً.' });
      return;
    }
    await deleteCategory(id);
    await recordCatalogAudit('category_deleted', 'admin', getClientIp(req), 'category', String(id));
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

// Admin Sliders
app.get('/api/admin/sliders', requireAdmin, async (_req, res, next) => {
  try {
    res.json(await listAdminSliders());
  } catch (error) {
    next(error);
  }
});

app.post('/api/admin/sliders', requireAdmin, async (req, res, next) => {
  const title = String(req.body?.title || '').trim().slice(0, 120);
  const subtitle = String(req.body?.subtitle || '').trim().slice(0, 240);
  const image_url = sanitizeMediaUrl(req.body?.image_url, 'image');
  const link_category_id = req.body?.link_category_id ? Number(req.body.link_category_id) : null;
  const linkUrlRaw = String(req.body?.link_url || '').trim();
  const link_url =
    !linkUrlRaw || /^https?:\/\/.{3,}/i.test(linkUrlRaw) ? linkUrlRaw.slice(0, 500) : null;
  const sort_order = Number(req.body?.sort_order || 1);
  const is_active = req.body?.is_active !== false ? 1 : 0;

  if (!title || !image_url || link_url === null) {
    res.status(400).json({ error: 'يرجى إدخال عنوان الشريحة ورفع صورة صالحة.' });
    return;
  }

  try {
    const created = await createSlider({
      title,
      subtitle,
      image_url,
      link_category_id,
      link_url,
      sort_order: Number.isFinite(sort_order) ? sort_order : 1,
      is_active,
    });
    await recordCatalogAudit(
      'slider_created',
      'admin',
      getClientIp(req),
      'slider',
      String(created.id),
      title
    );
    res.status(201).json({ ...created, is_active: Boolean(created.is_active) });
  } catch (error) {
    next(error);
  }
});

app.patch('/api/admin/sliders/:id', requireAdmin, async (req, res, next) => {
  const id = Number(req.params.id);
  try {
    const existing = await getSlider(id);
    if (!existing) {
      res.status(404).json({ error: 'الشريحة غير موجودة.' });
      return;
    }

    const title = req.body?.title !== undefined ? String(req.body.title).trim().slice(0, 120) : existing.title;
    const subtitle = req.body?.subtitle !== undefined ? String(req.body.subtitle).trim().slice(0, 240) : existing.subtitle;
    const image_url =
      req.body?.image_url !== undefined ? sanitizeMediaUrl(req.body.image_url, 'image') : existing.image_url;
    if (!title || !image_url) {
      res.status(400).json({ error: 'عنوان الشريحة أو رابط الصورة غير صالح.' });
      return;
    }
    const link_category_id =
      req.body?.link_category_id !== undefined
        ? req.body.link_category_id
          ? Number(req.body.link_category_id)
          : null
        : existing.link_category_id;
    const link_url =
      req.body?.link_url !== undefined
        ? (/^https?:\/\/.{3,}/i.test(String(req.body.link_url).trim()) || !String(req.body.link_url).trim())
          ? String(req.body.link_url).trim().slice(0, 500)
          : null
        : existing.link_url || '';
    if (link_url === null) {
      res.status(400).json({ error: 'رابط الشريحة يجب أن يبدأ بـ http:// أو https://.' });
      return;
    }
    const sort_order = req.body?.sort_order !== undefined ? Number(req.body.sort_order) : existing.sort_order;
    const is_active = req.body?.is_active !== undefined ? (req.body.is_active ? 1 : 0) : existing.is_active;

    const updated = await updateSlider(id, {
      title,
      subtitle,
      image_url,
      link_category_id,
      link_url,
      sort_order: Number.isFinite(sort_order) ? sort_order : 1,
      is_active,
    });
    if (!updated) {
      res.status(404).json({ error: 'الشريحة غير موجودة.' });
      return;
    }
    await recordCatalogAudit('slider_updated', 'admin', getClientIp(req), 'slider', String(id), title);
    res.json({ ...updated, is_active: Boolean(updated.is_active) });
  } catch (error) {
    next(error);
  }
});

app.delete('/api/admin/sliders/:id', requireAdmin, async (req, res, next) => {
  const id = Number(req.params.id);
  try {
    await deleteSlider(id);
    await recordCatalogAudit('slider_deleted', 'admin', getClientIp(req), 'slider', String(id));
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

// Admin Reports
app.get('/api/admin/reports', requireAdmin, async (_req, res, next) => {
  try {
    res.json(await listAdminReports());
  } catch (error) {
    next(error);
  }
});

app.patch('/api/admin/reports/:id', requireAdmin, async (req, res, next) => {
  const id = Number(req.params.id);
  const status = String(req.body?.status || '');
  if (!['open', 'reviewed', 'dismissed'].includes(status)) {
    res.status(400).json({ error: 'حالة البلاغ غير صالحة.' });
    return;
  }

  try {
    await updateListingReportStatus(id, status as 'open' | 'reviewed' | 'dismissed');
    await recordCatalogAudit('report_updated', 'admin', getClientIp(req), 'report', String(id), `status=${status}`);
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

// Admin Overview Stats & Charts
app.get('/api/admin/overview', requireAdmin, async (req, res, next) => {
  const days = Number(req.query.days) === 30 ? 30 : 7;

  try {
    const listingOverview = await getListingOverviewData(days);
    const totalVisits = await countSiteVisits();
    const arabicWeekdays = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
    const activitySeries: Array<{ date: string; label: string; count: number }> = [];
    const today = new Date();
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - i));
      const iso = d.toISOString().slice(0, 10);
      const label =
        days === 7
          ? arabicWeekdays[d.getUTCDay()]
          : `${d.getUTCDate()}/${d.getUTCMonth() + 1}`;
      activitySeries.push({
        date: iso,
        label,
        count: listingOverview.activityByDay.get(iso) || 0,
      });
    }

    res.json({
      totalVisits,
      publishedListings: listingOverview.publishedListings,
      pendingListings: listingOverview.pendingListings,
      rejectedListings: listingOverview.rejectedListings,
      totalCategories: listingOverview.totalCategories,
      openReports: listingOverview.openReports,
      unreadNotifications: listingOverview.unreadNotifications,
      activitySeries,
      categoryDistribution: listingOverview.categoryDistribution,
    });
  } catch (error) {
    next(error);
  }
});

// Admin Global Search
app.get('/api/admin/search', requireAdmin, async (req, res, next) => {
  const q = String(req.query.q || '').trim().slice(0, 120);
  if (!q) {
    res.json({ listings: [], categories: [] });
    return;
  }
  try {
    const allListings = await listListings({
      includeHidden: true,
      includeDemo: true,
      includeContact: true,
    });
    const normalizedQuery = q.toLocaleLowerCase();
    const listings = allListings
      .filter((listing) =>
        [
          listing.title,
          listing.brand,
          listing.keywords,
          listing.description,
          listing.governorate,
          listing.category_name,
        ].some((value) => String(value || '').toLocaleLowerCase().includes(normalizedQuery))
      )
      .slice(0, 30)
      .map((listing) => formatListingRow(listing, true));

    const categories = await searchAdminCategories(q, allListings);

    res.json({ listings, categories });
  } catch (error) {
    next(error);
  }
});

// Admin Notifications
app.get('/api/admin/notifications', requireAdmin, async (_req, res, next) => {
  try {
    res.json(await listAdminNotifications());
  } catch (error) {
    next(error);
  }
});

app.patch('/api/admin/notifications/:id/read', requireAdmin, async (req, res, next) => {
  const id = Number(req.params.id);
  try {
    await markAdminNotificationRead(id);
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.post('/api/admin/notifications/read-all', requireAdmin, async (_req, res, next) => {
  try {
    await markAllAdminNotificationsRead();
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

// Admin Security Audit Logs (read-only)
app.get('/api/admin/audit-logs', requireAdmin, async (_req, res, next) => {
  try {
    const catalogRows = await listCatalogAuditLogs();
    res.json(
      catalogRows
        .sort(
          (a, b) =>
            new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
        )
        .slice(0, 50)
    );
  } catch (error) {
    next(error);
  }
});

// Admin Settings
app.get('/api/admin/settings', requireAdmin, async (_req, res, next) => {
  try {
    res.json(await getAdminSettings());
  } catch (error) {
    next(error);
  }
});

app.patch('/api/admin/settings', requireAdmin, async (req, res, next) => {
  const allowed = ['platform_name', 'support_phone', 'moderation_note', 'slider_autoplay_enabled', 'slider_interval_ms'];
  const body = req.body || {};
  const updates: Record<string, string> = {};
  for (const key of allowed) {
    if (body[key] !== undefined) {
      updates[key] = String(body[key]).slice(0, 500);
    }
  }

  try {
    await saveAdminSettings(updates);
    await recordCatalogAudit('settings_updated', 'admin', getClientIp(req), 'settings', '');
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

// Change Admin PIN / Passphrase (requires verifying current PIN, hashes with scrypt, invalidates ALL prior sessions)
app.post('/api/admin/settings/pin', requireAdmin, async (req, res, next) => {
  const currentPin = normalizeDigitsServer(String(req.body?.currentPin || ''));
  const newPin = normalizeDigitsServer(String(req.body?.newPin || ''));

  try {
    const pinHash = await getAdminPinHash();
    if (!pinHash || !currentPin || !verifyPassword(currentPin, pinHash)) {
      await logAudit('pin_change_failed', 'admin', getClientIp(req), 'settings', '', 'الرمز الحالي غير صحيح');
      res.status(403).json({ error: 'الرمز الحالي غير صحيح.' });
      return;
    }

    if (newPin.length < 6 || newPin.length > 128) {
      res.status(400).json({ error: 'يجب أن يتكون الرمز أو عبارة المرور الجديدة من 6 إلى 128 خانة.' });
      return;
    }

    await saveAdminPinHash(hashPassword(newPin));
    await deleteAllAdminSessions();

    const now = Date.now();
    const nextSessionToken = generateToken(32);
    const nextCsrfToken = generateToken(32);
    await createAdminSession({
      token_hash: sha256(nextSessionToken),
      username: 'admin',
      role: 'admin',
      csrf_token: nextCsrfToken,
      last_activity_at: now,
      expires_at: now + MAX_SESSION_MS,
      ip_address: getClientIp(req),
      user_agent: String(req.headers['user-agent'] || '').slice(0, 200),
    });

    setCookie(req, res, ADMIN_COOKIE_NAME, nextSessionToken, Math.floor(MAX_SESSION_MS / 1000));
    await logAudit('pin_changed', 'admin', getClientIp(req), 'settings', '', 'تم تغيير رمز الإدارة وإبطال جميع الجلسات السابقة');
    res.json({ ok: true, csrfToken: nextCsrfToken });
  } catch (error) {
    next(error);
  }
});

// Admin Managed Synonym Dictionary CRUD
app.get('/api/admin/synonyms', requireAdmin, async (_req, res, next) => {
  try {
    const [rows, listings] = await Promise.all([
      listManagedSynonyms(),
      listListings({ includeHidden: true, includeDemo: true }),
    ]);
    const knownBrands = new Set(
      listings.map((listing) => listing.brand).filter((brand) => brand !== '')
    );
    for (const row of rows) {
      if (row.target_type === 'brand' && row.canonical_value) {
        knownBrands.add(row.canonical_value);
      }
    }

    res.json({
      synonyms: rows.map((row) => ({
        id: row.id,
        term: row.term,
        normalized_term: row.normalized_term,
        target_type: row.target_type,
        canonical_value: row.canonical_value,
        category_id: row.category_id ?? null,
        category_name: row.category_name ?? null,
        category_slug: row.category_slug ?? null,
        disambiguation_options: formatSynonymOptions(row.disambiguation_options_json),
        is_active: Boolean(row.is_active),
        notes: row.notes || '',
        created_at: row.created_at,
        updated_at: row.updated_at,
      })),
      knownBrands: Array.from(knownBrands),
    });
  } catch (error) {
    next(error);
  }
});

app.post('/api/admin/synonyms', requireAdmin, async (req, res, next) => {
  const term = String(req.body?.term || '').trim().slice(0, 80);
  const target_type = String(req.body?.target_type || '').trim();
  const canonical_value = String(req.body?.canonical_value || '').trim().slice(0, 120);
  const category_id = req.body?.category_id ? Number(req.body.category_id) : null;
  const disambiguation_options = Array.isArray(req.body?.disambiguation_options)
    ? req.body.disambiguation_options.slice(0, 10)
    : [];
  const is_active = req.body?.is_active !== false ? 1 : 0;
  const notes = String(req.body?.notes || '').trim().slice(0, 240);

  if (!term || !['brand', 'category', 'keyword', 'ambiguous'].includes(target_type)) {
    res.status(400).json({ error: 'يرجى إدخال المصطلح وتحديد نوع الربط.' });
    return;
  }

  try {
    let resolvedCanonical = canonical_value;
    let categoryName: string | null = null;
    let categorySlug: string | null = null;
    const category = category_id ? await getCategoryForListing(category_id) : null;
    if (target_type === 'category' && category_id && !category) {
      res.status(400).json({ error: 'القسم المحدد غير موجود.' });
      return;
    }
    if (category) {
      categoryName = category.name_ar;
      categorySlug = category.slug;
    }
    if (target_type === 'category' && category) {
      if (!resolvedCanonical) resolvedCanonical = category.slug;
    }

    const created = await insertManagedSynonym({
      term,
      normalized_term: normalizeArabicText(term),
      target_type: target_type as 'brand' | 'category' | 'keyword' | 'ambiguous',
      canonical_value: resolvedCanonical,
      category_id,
      disambiguation_options_json: disambiguation_options,
      is_active,
      notes,
    });
    await recordCatalogAudit('synonym_created', 'admin', getClientIp(req), 'synonym', String(created.id), term);
    res.status(201).json({
      ...created,
      category_name: categoryName,
      category_slug: categorySlug,
      disambiguation_options_json: JSON.stringify(disambiguation_options),
      disambiguation_options: disambiguation_options,
      is_active: Boolean(created.is_active),
    });
  } catch (error) {
    next(error);
  }
});

app.patch('/api/admin/synonyms/:id', requireAdmin, async (req, res, next) => {
  const id = Number(req.params.id);
  try {
    const existing = await getManagedSynonym(id);
    if (!existing) {
      res.status(404).json({ error: 'المصطلح غير موجود.' });
      return;
    }

    const term = req.body?.term !== undefined ? String(req.body.term).trim().slice(0, 80) : existing.term;
    const target_type =
      req.body?.target_type !== undefined ? String(req.body.target_type) : existing.target_type;
    if (!term || !['brand', 'category', 'keyword', 'ambiguous'].includes(target_type)) {
      res.status(400).json({ error: 'بيانات المصطلح غير صالحة.' });
      return;
    }
    let canonical_value =
      req.body?.canonical_value !== undefined
        ? String(req.body.canonical_value).trim().slice(0, 120)
        : existing.canonical_value;
    const category_id =
      req.body?.category_id !== undefined
        ? req.body.category_id
          ? Number(req.body.category_id)
          : null
        : existing.category_id;
    const is_active =
      req.body?.is_active !== undefined ? (req.body.is_active ? 1 : 0) : existing.is_active;
    const notes = req.body?.notes !== undefined ? String(req.body.notes).trim().slice(0, 240) : existing.notes;
    const disambiguation_options_json =
      req.body?.disambiguation_options !== undefined
        ? Array.isArray(req.body.disambiguation_options)
          ? req.body.disambiguation_options.slice(0, 10)
          : []
        : existing.disambiguation_options_json;
    let categoryName: string | null = null;
    let categorySlug: string | null = null;

    let category = category_id ? await getCategoryForListing(category_id) : null;
    if (target_type === 'category' && category_id && !category) {
      res.status(400).json({ error: 'القسم المحدد غير موجود.' });
      return;
    }
    if (target_type === 'category' && category && !canonical_value) {
      canonical_value = category.slug;
    }

    const updated = await updateManagedSynonym(id, {
      term,
      normalized_term: normalizeArabicText(term),
      target_type: target_type as 'brand' | 'category' | 'keyword' | 'ambiguous',
      canonical_value,
      category_id,
      disambiguation_options_json,
      is_active,
      notes,
    });
    if (!updated) {
      res.status(404).json({ error: 'المصطلح غير موجود.' });
      return;
    }
    if (!category && updated.category_id !== null) {
      category = await getCategoryForListing(updated.category_id);
    }
    categoryName = category?.name_ar ?? null;
    categorySlug = category?.slug ?? null;

    await recordCatalogAudit('synonym_updated', 'admin', getClientIp(req), 'synonym', String(id), term);
    res.json({
      ...updated,
      category_name: categoryName,
      category_slug: categorySlug,
      disambiguation_options_json: JSON.stringify(
        formatSynonymOptions(updated.disambiguation_options_json)
      ),
      disambiguation_options: formatSynonymOptions(updated.disambiguation_options_json),
      is_active: Boolean(updated.is_active),
    });
  } catch (error) {
    next(error);
  }
});

app.delete('/api/admin/synonyms/:id', requireAdmin, async (req, res, next) => {
  const id = Number(req.params.id);
  try {
    await deleteManagedSynonym(id);
    await recordCatalogAudit('synonym_deleted', 'admin', getClientIp(req), 'synonym', String(id));
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

// Reject unknown /api/* calls cleanly instead of falling through to SPA HTML
app.use('/api', (_req, res) => {
  res.status(404).json({ error: 'المسار غير موجود.' });
});

// Server-side guard on /admin page route: never disclose protected section to unauthorized callers
app.use('/admin', async (req, res, next) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.setHeader('Pragma', 'no-cache');
  try {
    const session = await getAdminSession(req, res, { touchActivity: false });
    if (!session || session.role !== 'admin') {
      const acceptsHtml = (req.headers.accept || '').includes('text/html');
      if (req.method === 'GET' && acceptsHtml) {
        res.redirect(302, '/');
        return;
      }
      res.status(404).json({ error: 'المسار غير موجود.' });
      return;
    }
    next();
  } catch (error) {
    next(error);
  }
});

// Global safe error handler (never leaks stack traces or DB internals)
app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  console.error('[Server Error]', err?.message || 'Unknown internal error');
  if (res.headersSent) return;
  res.status(500).json({ error: 'حدث خطأ داخلي في الخادم، يرجى المحاولة لاحقاً.' });
});

async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Darajati server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
