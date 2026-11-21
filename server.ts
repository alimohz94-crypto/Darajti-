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
  db,
  generateOwnerCode,
  generateToken,
  hashPassword,
  initDatabase,
  sha256,
  verifyPassword,
} from './server/db.ts';
import {
  getSmartSuggestions,
  normalizeArabicText,
  runSmartSearch,
} from './server/smartSearch.ts';

initDatabase();

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
): void {
  try {
    db.prepare(
      `INSERT INTO admin_audit_logs (event_type, actor, ip_address, target_type, target_id, details) VALUES (?, ?, ?, ?, ?, ?)`
    ).run(
      eventType.slice(0, 64),
      actor.slice(0, 64),
      ipAddress.slice(0, 80),
      targetType.slice(0, 64),
      String(targetId).slice(0, 64),
      details.slice(0, 300)
    );
  } catch {
    // Do not crash request flow on audit insert failure
  }
}

function normalizeDigitsServer(input: string): string {
  const arabicDigits = '٠١٢٣٤٥٦٧٨٩';
  const persianDigits = '۰۱۲۳۴۵۶۷۸۹';
  let out = String(input || '').trim();
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

function getAdminSession(
  req: Request,
  res?: Response,
  options: { touchActivity?: boolean } = {}
): AdminSessionContext | null {
  const cookies = parseCookies(req);
  const rawSid = cookies[ADMIN_COOKIE_NAME];
  if (!rawSid || rawSid.length < 32 || rawSid.length > 256) return null;

  const tokenHash = sha256(rawSid);
  const session = db
    .prepare(
      `SELECT token_hash, username, role, csrf_token, last_activity_at, expires_at
       FROM admin_sessions WHERE token_hash = ?`
    )
    .get(tokenHash) as
    | {
        token_hash: string;
        username: string;
        role: string;
        csrf_token: string;
        last_activity_at: number;
        expires_at: number;
      }
    | undefined;

  if (!session) return null;

  const now = Date.now();
  const isAbsoluteExpired = now > session.expires_at;
  const isIdleExpired = now - session.last_activity_at > IDLE_TIMEOUT_MS;

  if (isAbsoluteExpired || isIdleExpired) {
    db.prepare(`DELETE FROM admin_sessions WHERE token_hash = ?`).run(tokenHash);
    if (res) clearCookie(req, res, ADMIN_COOKIE_NAME);
    logAudit(
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
    db.prepare(`UPDATE admin_sessions SET last_activity_at = ? WHERE token_hash = ?`).run(
      now,
      tokenHash
    );
  }

  return {
    username: session.username,
    role: session.role || 'admin',
    csrfToken: session.csrf_token,
    tokenHash: session.token_hash,
  };
}

function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const session = getAdminSession(req, res, { touchActivity: true });
  if (!session || session.role !== 'admin') {
    res.status(401).json({ error: 'تعذّر المتابعة.' });
    return;
  }

  // Enforce Origin + CSRF token on all state-changing admin requests
  if (['POST', 'PATCH', 'PUT', 'DELETE'].includes(req.method.toUpperCase())) {
    if (!verifySameOrigin(req)) {
      logAudit('csrf_origin_blocked', session.username, getClientIp(req), 'route', req.path);
      res.status(403).json({ error: 'مصدر الطلب غير مصرح به.' });
      return;
    }
    const headerCsrf = String(req.headers['x-csrf-token'] || '').trim();
    if (!safeEqualStrings(headerCsrf, session.csrfToken)) {
      logAudit('csrf_token_invalid', session.username, getClientIp(req), 'route', req.path);
      res.status(403).json({ error: 'تعذر التحقق من رمز الحماية (CSRF). أعد تحديث الصفحة.' });
      return;
    }
  }

  (req as any).adminSession = session;
  (req as any).adminUsername = session.username;
  next();
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

function verifyOwnerOrAdmin(
  req: Request,
  res: Response,
  listingRow: any
): 'admin' | 'owner' | null {
  const adminSession = getAdminSession(req, res, { touchActivity: true });
  if (adminSession && adminSession.role === 'admin') return 'admin';

  const ownerToken = String(req.headers['x-owner-token'] || '').trim();
  if (ownerToken && safeEqualStrings(sha256(ownerToken), listingRow.owner_token_hash)) {
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

const MIME_BY_EXT: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
};

// Authorized media file handler (blocks public access to pending/rejected/unattached media!)
app.get('/uploads/:kind/:filename', (req, res) => {
  const kind = req.params.kind;
  const filename = req.params.filename;
  if ((kind !== 'images' && kind !== 'videos') || !/^[a-zA-Z0-9_.-]+$/.test(filename)) {
    res.status(400).json({ error: 'مسار الملف غير صالح.' });
    return;
  }

  const baseDir = kind === 'images' ? IMAGES_DIR : VIDEOS_DIR;
  const resolved = path.resolve(baseDir, filename);
  if (!resolved.startsWith(baseDir + path.sep)) {
    res.status(403).json({ error: 'الوصول مرفوض.' });
    return;
  }
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
    res.status(404).json({ error: 'الملف غير موجود.' });
    return;
  }

  const relUrl = `/uploads/${kind}/${filename}`;

  // Check if file is referenced publicly by an active slider or category
  const publicSliderOrCat =
    db.prepare(`SELECT id FROM sliders WHERE image_url = ? AND is_active = 1 LIMIT 1`).get(relUrl) ||
    db.prepare(`SELECT id FROM categories WHERE image_url = ? LIMIT 1`).get(relUrl);

  let isPubliclyPublished = Boolean(publicSliderOrCat);
  let authorized = isPubliclyPublished;

  if (!authorized) {
    const asset = db
      .prepare(
        `SELECT m.listing_id, m.upload_token_hash, l.status, l.owner_token_hash
         FROM media_assets m
         LEFT JOIN listings l ON l.id = m.listing_id
         WHERE m.filename = ? AND m.kind = ?`
      )
      .get(filename, kind) as
      | {
          listing_id: number | null;
          upload_token_hash: string;
          status: string | null;
          owner_token_hash: string | null;
        }
      | undefined;

    if (asset?.listing_id && (asset.status === 'approved' || asset.status === 'sold')) {
      isPubliclyPublished = true;
      authorized = true;
    } else if (!asset) {
      // Legacy file check against approved/sold listings
      const publicListing = db
        .prepare(
          `SELECT id FROM listings
           WHERE status IN ('approved', 'sold')
             AND (images_json LIKE ? OR video_url = ?)
           LIMIT 1`
        )
        .get(`%${relUrl}%`, relUrl);
      if (publicListing) {
        isPubliclyPublished = true;
        authorized = true;
      }
    }

    if (!authorized) {
      // Allow ONLY Admin session OR verified owner cookie / owner token
      const adminSession = getAdminSession(req, res, { touchActivity: false });
      if (adminSession && adminSession.role === 'admin') {
        authorized = true;
      } else {
        const ownerCookieHash = getOwnerCookieHash(req);
        if (ownerCookieHash) {
          if (asset?.upload_token_hash && safeEqualStrings(ownerCookieHash, asset.upload_token_hash)) {
            authorized = true;
          } else if (asset?.listing_id) {
            const grant = db
              .prepare(`SELECT 1 FROM owner_media_grants WHERE token_hash = ? AND listing_id = ?`)
              .get(ownerCookieHash, asset.listing_id);
            if (grant) authorized = true;
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

  if (!authorized) {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.status(403).json({ error: 'غير مصرح بعرض هذا الملف حالياً.' });
    return;
  }

  const ext = path.extname(filename).toLowerCase();
  const mime = MIME_BY_EXT[ext] || 'application/octet-stream';
  res.setHeader('Content-Type', mime);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
  if (isPubliclyPublished) {
    res.setHeader('X-Darajati-Media-Scope', 'public');
    res.setHeader('Cache-Control', 'public, max-age=86400');
  } else {
    res.setHeader('X-Darajati-Media-Scope', 'private');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  }
  res.sendFile(resolved);
});

// Helper to normalize listing row
function formatListingRow(row: any) {
  let images = [];
  try {
    images = JSON.parse(row.images_json || '[]');
  } catch {
    images = [];
  }
  return {
    id: row.id,
    title: row.title,
    brand: row.brand || '',
    category_id: row.category_id,
    category_name: row.category_name,
    category_slug: row.category_slug,
    is_parts_or_accessories: Boolean(row.is_parts_or_accessories),
    governorate: row.governorate,
    area: row.area || '',
    model_year: row.model_year ?? null,
    engine_cc: row.engine_cc ?? null,
    motor_watts: row.motor_watts ?? null,
    condition: row.condition,
    price_iqd: row.price_iqd,
    negotiable: Boolean(row.negotiable),
    phone: row.phone,
    description: row.description,
    keywords: row.keywords || '',
    images,
    video_url: row.video_url || null,
    status: row.status,
    is_demo: Boolean(row.is_demo),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
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
app.post('/api/upload/images', (req, res) => {
  if (!verifySameOrigin(req)) {
    res.status(403).json({ error: 'مصدر الطلب غير مصرح به.' });
    return;
  }
  if (!checkUploadRateLimit(req, res)) return;

  uploadImages.array('images', 10)(req, res, (err: any) => {
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
    const insertMedia = db.prepare(
      `INSERT OR REPLACE INTO media_assets (filename, kind, upload_token_hash, listing_id) VALUES (?, 'images', ?, NULL)`
    );
    for (const f of files) {
      insertMedia.run(f.filename, ownerHash);
    }

    res.json({
      urls: files.map((f) => `/uploads/images/${f.filename}`),
    });
  });
});

app.post('/api/upload/video', (req, res) => {
  if (!verifySameOrigin(req)) {
    res.status(403).json({ error: 'مصدر الطلب غير مصرح به.' });
    return;
  }
  if (!checkUploadRateLimit(req, res)) return;

  uploadVideo.single('video')(req, res, (err: any) => {
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
    db.prepare(
      `INSERT OR REPLACE INTO media_assets (filename, kind, upload_token_hash, listing_id) VALUES (?, 'videos', ?, NULL)`
    ).run(file.filename, sha256(ownerSid));

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

// Public Categories
app.get('/api/categories', (_req, res) => {
  const rows = db
    .prepare(
      `
      SELECT c.*,
        (SELECT COUNT(*) FROM listings l WHERE l.category_id = c.id AND l.status IN ('approved', 'sold')) as listings_count
      FROM categories c
      ORDER BY c.sort_order ASC, c.id ASC
    `
    )
    .all();

  res.json(
    rows.map((r: any) => ({
      id: r.id,
      slug: r.slug,
      name_ar: r.name_ar,
      image_url: r.image_url,
      is_parts_or_accessories: Boolean(r.is_parts_or_accessories),
      sort_order: r.sort_order,
      listings_count: r.listings_count || 0,
    }))
  );
});

// Public Sliders
app.get('/api/sliders', (_req, res) => {
  const rows = db
    .prepare(`SELECT * FROM sliders WHERE is_active = 1 ORDER BY sort_order ASC, id ASC`)
    .all();
  res.json(
    rows.map((r: any) => ({
      id: r.id,
      title: r.title,
      subtitle: r.subtitle,
      image_url: r.image_url,
      link_category_id: r.link_category_id ?? null,
      sort_order: r.sort_order,
      is_active: Boolean(r.is_active),
    }))
  );
});

// Smart Search Endpoint
app.get('/api/search', (req, res) => {
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

  const result = runSmartSearch(
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
    formatListingRow
  );
  res.json(result);
});

// Live Autocomplete Suggestions
app.get('/api/search/suggestions', (req, res) => {
  const q = String(req.query.q || '').trim().slice(0, 200);
  res.json(getSmartSuggestions(q));
});

// Public Listings
app.get('/api/listings', (req, res) => {
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

  const result = runSmartSearch(
    { q, governorate, categoryId, minPrice, maxPrice, sort, hideDemo },
    formatListingRow
  );
  res.json(result.items);
});

// Get single listing (pending/rejected restricted to owner or admin!)
app.get('/api/listings/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: 'معرف المنشور غير صالح.' });
    return;
  }

  const row = db
    .prepare(
      `
      SELECT l.*, c.name_ar as category_name, c.slug as category_slug, c.is_parts_or_accessories
      FROM listings l
      JOIN categories c ON c.id = l.category_id
      WHERE l.id = ?
    `
    )
    .get(id) as any;

  if (!row) {
    res.status(404).json({ error: 'المنشور غير موجود أو تم حذفه.' });
    return;
  }

  const role = verifyOwnerOrAdmin(req, res, row);
  if (row.status === 'pending' || row.status === 'rejected') {
    if (!role) {
      res.status(403).json({ error: 'هذا المنشور قيد المراجعة حالياً ولا يمكن عرضه للعامة بعد.' });
      return;
    }
  }

  res.json({
    listing: formatListingRow(row),
    isOwner: role === 'owner' || role === 'admin',
  });
});

// Create listing: server ALWAYS enforces initialStatus = 'pending' and ignores any client role/status!
app.post('/api/listings', (req, res) => {
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

  if (!governorate || typeof governorate !== 'string') {
    errors.governorate = 'يرجى اختيار المحافظة.';
  }

  const cat = db.prepare(`SELECT * FROM categories WHERE id = ?`).get(Number(category_id)) as any;
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

  const cleanPhone = normalizePhoneServer(phone);
  if (!/^07[3-9]\d{8}$/.test(cleanPhone)) {
    errors.phone = 'يرجى إدخال رقم هاتف عراقي صحيح (مثال: 07701234567).';
  }

  const cleanDesc = String(description || '').trim().slice(0, 3000);
  if (cleanDesc.length < 10) {
    errors.description = 'يرجى كتابة وصف واضح لا يقل عن 10 أحرف.';
  }

  const cleanImages = Array.isArray(images)
    ? images
        .map((img, idx) => {
          const safeUrl = sanitizeMediaUrl(img?.url, 'image');
          if (!safeUrl) return null;
          return { url: safeUrl, isCover: Boolean(img?.isCover) || idx === 0 };
        })
        .filter((x): x is { url: string; isCover: boolean } => x !== null)
        .slice(0, 10)
    : [];

  if (cleanImages.length === 0) {
    errors.images = 'يرجى رفع صورة واحدة على الأقل بصيغة صالحة.';
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

  const ownerToken = generateToken(24);
  const ownerCode = generateOwnerCode();
  const initialStatus = 'pending'; // Exclusively pending on creation; Admin alone can approve!

  const result = db
    .prepare(
      `
      INSERT INTO listings (
        title, brand, category_id, governorate, area, model_year, engine_cc, motor_watts, condition,
        price_iqd, negotiable, phone, description, keywords, images_json, video_url,
        status, is_demo, owner_token_hash, owner_code_hash
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
    `
    )
    .run(
      cleanTitle,
      String(brand || '').trim().slice(0, 80),
      cat.id,
      String(governorate).trim().slice(0, 60),
      String(area || '').trim().slice(0, 80),
      parsedYear,
      parsedCc ? Math.round(parsedCc) : null,
      parsedWatts ? Math.round(parsedWatts) : null,
      condition,
      Math.round(parsedPrice),
      negotiable ? 1 : 0,
      cleanPhone,
      cleanDesc,
      String(keywords || '').trim().slice(0, 300),
      JSON.stringify(cleanImages),
      cleanVideoUrl,
      initialStatus,
      sha256(ownerToken),
      sha256(ownerCode)
    );

  const listingId = Number(result.lastInsertRowid);

  // Link uploaded media assets to this listing and grant owner cookie preview access
  const ownerSid = getOrCreateOwnerMediaCookie(req, res);
  const ownerSidHash = sha256(ownerSid);
  db.prepare(`INSERT OR IGNORE INTO owner_media_grants (token_hash, listing_id) VALUES (?, ?)`).run(
    ownerSidHash,
    listingId
  );

  for (const img of cleanImages) {
    if (img.url.startsWith('/uploads/images/')) {
      const fn = path.basename(img.url);
      db.prepare(`UPDATE media_assets SET listing_id = ? WHERE filename = ? AND kind = 'images'`).run(
        listingId,
        fn
      );
    }
  }
  if (cleanVideoUrl && cleanVideoUrl.startsWith('/uploads/videos/')) {
    const fn = path.basename(cleanVideoUrl);
    db.prepare(`UPDATE media_assets SET listing_id = ? WHERE filename = ? AND kind = 'videos'`).run(
      listingId,
      fn
    );
  }

  db.prepare(
    `INSERT INTO admin_notifications (type, title, body, target_section, target_id) VALUES (?, ?, ?, ?, ?)`
  ).run(
    'new_listing',
    'طلب نشر دراجة/منتج جديد قيد المراجعة',
    `${cleanTitle} · ${String(governorate).trim()}`,
    'pending',
    listingId
  );

  const createdRow = db
    .prepare(
      `
      SELECT l.*, c.name_ar as category_name, c.slug as category_slug, c.is_parts_or_accessories
      FROM listings l JOIN categories c ON c.id = l.category_id
      WHERE l.id = ?
    `
    )
    .get(listingId);

  res.status(201).json({
    listing: formatListingRow(createdRow),
    ownerToken,
    ownerCode,
  });
});

// Rate limit owner code verification to prevent brute force
const ownerCodeAttempts = new Map<string, { count: number; windowStart: number; lockedUntil: number }>();

app.post('/api/listings/:id/verify-owner', (req, res) => {
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
  const row = db.prepare(`SELECT * FROM listings WHERE id = ?`).get(id) as any;
  if (!row) {
    res.status(404).json({ error: 'المنشور غير موجود.' });
    return;
  }
  if (!code || !safeEqualStrings(sha256(code), row.owner_code_hash)) {
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
  db.prepare(`UPDATE listings SET owner_token_hash = ?, updated_at = datetime('now') WHERE id = ?`).run(
    sha256(newToken),
    id
  );

  const ownerSid = getOrCreateOwnerMediaCookie(req, res);
  db.prepare(`INSERT OR IGNORE INTO owner_media_grants (token_hash, listing_id) VALUES (?, ?)`).run(
    sha256(ownerSid),
    id
  );

  res.json({ ownerToken: newToken });
});

// Owner or Admin updates listing status
app.patch('/api/listings/:id/status', (req, res) => {
  if (!verifySameOrigin(req)) {
    res.status(403).json({ error: 'مصدر الطلب غير مصرح به.' });
    return;
  }
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: 'معرف المنشور غير صالح.' });
    return;
  }

  const row = db.prepare(`SELECT * FROM listings WHERE id = ?`).get(id) as any;
  if (!row) {
    res.status(404).json({ error: 'المنشور غير موجود.' });
    return;
  }
  const role = verifyOwnerOrAdmin(req, res, row);
  if (!role) {
    res.status(403).json({ error: 'غير مصرح لك بتعديل حالة هذا المنشور.' });
    return;
  }

  if (role === 'admin') {
    const adminSession = getAdminSession(req, res, { touchActivity: true });
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
  } else if (!['pending', 'approved', 'sold', 'rejected', 'hidden'].includes(nextStatus)) {
    res.status(400).json({ error: 'الحالة غير صالحة.' });
    return;
  }

  db.prepare(`UPDATE listings SET status = ?, updated_at = datetime('now') WHERE id = ?`).run(nextStatus, id);

  if (role === 'admin') {
    logAudit('listing_status_changed', 'admin', getClientIp(req), 'listing', String(id), `status=${nextStatus}`);
  }

  const updated = db
    .prepare(
      `SELECT l.*, c.name_ar as category_name, c.slug as category_slug, c.is_parts_or_accessories
       FROM listings l JOIN categories c ON c.id = l.category_id WHERE l.id = ?`
    )
    .get(id);
  res.json({ listing: formatListingRow(updated) });
});

// Owner or Admin edits listing fields
app.patch('/api/listings/:id', (req, res) => {
  if (!verifySameOrigin(req)) {
    res.status(403).json({ error: 'مصدر الطلب غير مصرح به.' });
    return;
  }
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: 'معرف المنشور غير صالح.' });
    return;
  }
  const row = db.prepare(`SELECT * FROM listings WHERE id = ?`).get(id) as any;
  if (!row) {
    res.status(404).json({ error: 'المنشور غير موجود.' });
    return;
  }
  const role = verifyOwnerOrAdmin(req, res, row);
  if (!role) {
    res.status(403).json({ error: 'غير مصرح لك بتعديل هذا المنشور.' });
    return;
  }
  if (role === 'admin') {
    const adminSession = getAdminSession(req, res, { touchActivity: true });
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

  db.prepare(
    `
    UPDATE listings
    SET title = ?, brand = ?, price_iqd = ?, negotiable = ?, area = ?, governorate = ?,
        description = ?, keywords = ?, model_year = ?, engine_cc = ?, motor_watts = ?,
        condition = ?, phone = ?, status = ?, updated_at = datetime('now')
    WHERE id = ?
  `
  ).run(
    title,
    brand,
    Math.round(price_iqd),
    negotiable,
    area,
    governorate,
    description,
    keywords,
    model_year,
    engine_cc ? Math.round(engine_cc) : null,
    motor_watts ? Math.round(motor_watts) : null,
    condition,
    phone,
    status,
    id
  );

  if (role === 'admin') {
    logAudit('listing_updated', 'admin', getClientIp(req), 'listing', String(id));
  }

  const updated = db
    .prepare(
      `SELECT l.*, c.name_ar as category_name, c.slug as category_slug, c.is_parts_or_accessories
       FROM listings l JOIN categories c ON c.id = l.category_id WHERE l.id = ?`
    )
    .get(id);
  res.json({ listing: formatListingRow(updated) });
});

// Owner or Admin deletes listing
app.delete('/api/listings/:id', (req, res) => {
  if (!verifySameOrigin(req)) {
    res.status(403).json({ error: 'مصدر الطلب غير مصرح به.' });
    return;
  }
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: 'معرف المنشور غير صالح.' });
    return;
  }
  const row = db.prepare(`SELECT * FROM listings WHERE id = ?`).get(id) as any;
  if (!row) {
    res.status(404).json({ error: 'المنشور غير موجود.' });
    return;
  }
  const role = verifyOwnerOrAdmin(req, res, row);
  if (!role) {
    res.status(403).json({ error: 'غير مصرح لك بحذف هذا المنشور.' });
    return;
  }
  if (role === 'admin') {
    const adminSession = getAdminSession(req, res, { touchActivity: true });
    const headerCsrf = String(req.headers['x-csrf-token'] || '').trim();
    if (!adminSession || !safeEqualStrings(headerCsrf, adminSession.csrfToken)) {
      res.status(403).json({ error: 'تعذر التحقق من رمز الحماية (CSRF).' });
      return;
    }
  }

  db.prepare(`DELETE FROM listings WHERE id = ?`).run(id);
  if (role === 'admin') {
    logAudit('listing_deleted', 'admin', getClientIp(req), 'listing', String(id));
  }
  res.json({ ok: true });
});

// Report listing (only approved/sold public listings can be reported publicly)
app.post('/api/reports', (req, res) => {
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
  const exists = db
    .prepare(`SELECT id, title, status FROM listings WHERE id = ? AND status IN ('approved', 'sold')`)
    .get(listing_id) as { id: number; title: string; status: string } | undefined;
  if (!exists) {
    res.status(404).json({ error: 'المنشور غير موجود.' });
    return;
  }

  db.prepare(`INSERT INTO reports (listing_id, reason, details) VALUES (?, ?, ?)`).run(listing_id, reason, details);
  db.prepare(
    `INSERT INTO admin_notifications (type, title, body, target_section, target_id) VALUES (?, ?, ?, ?, ?)`
  ).run('new_report', `بلاغ جديد على: ${exists.title}`, reason, 'reports', listing_id);

  res.status(201).json({ ok: true });
});

// Track unique public visits
app.post('/api/analytics/visit', (req, res) => {
  if (getAdminSession(req, res, { touchActivity: false })) {
    res.json({ counted: false });
    return;
  }
  const sessionId = String(req.body?.sessionId || '').trim();
  if (!sessionId || sessionId.length > 128) {
    res.status(400).json({ error: 'جلسة غير صالحة.' });
    return;
  }
  const info = db.prepare(`INSERT OR IGNORE INTO site_visits (session_id) VALUES (?)`).run(sessionId);
  res.json({ counted: info.changes > 0 });
});

// ================= ADMIN AUTH & HARDENED MANAGEMENT =================

const PIN_MAX_ATTEMPTS = 5;
const PIN_WINDOW_MS = 15 * 60 * 1000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

app.get('/api/admin/auth-status', (req, res) => {
  const session = getAdminSession(req, res, { touchActivity: false });
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
});

app.post('/api/admin/verify-pin', async (req, res) => {
  if (!verifySameOrigin(req)) {
    res.status(403).json({ error: 'تعذّر المتابعة' });
    return;
  }
  if (req.headers['x-requested-with'] !== 'Darajati-Client') {
    res.status(403).json({ error: 'تعذّر المتابعة' });
    return;
  }

  const clientKey = getClientIp(req);
  const now = Date.now();

  const rateRow = db
    .prepare(`SELECT * FROM admin_auth_rate_limits WHERE client_key = ?`)
    .get(clientKey) as
    | {
        client_key: string;
        fail_count: number;
        lock_level: number;
        first_fail_at: number;
        locked_until: number;
        updated_at: number;
      }
    | undefined;

  if (rateRow && rateRow.locked_until > now) {
    const minutesLeft = Math.max(1, Math.ceil((rateRow.locked_until - now) / 60000));
    logAudit('login_rate_limited', 'anonymous', clientKey, 'auth', '', `locked_minutes=${minutesLeft}`);
    res.setHeader('Retry-After', String(Math.ceil((rateRow.locked_until - now) / 1000)));
    res.status(429).json({
      error: 'تعذّر المتابعة مؤقتاً، حاول لاحقاً',
    });
    return;
  }

  const customPinRow = db.prepare(`SELECT value FROM admin_settings WHERE key = 'admin_pin_hash'`).get() as
    | { value: string }
    | undefined;

  if (!customPinRow?.value || !customPinRow.value.includes(':')) {
    res.status(503).json({
      error: 'تعذّر المتابعة',
    });
    return;
  }

  const normalizedPin = normalizeDigitsServer(String(req.body?.pin || ''));
  const isMatch =
    normalizedPin.length >= 4 &&
    normalizedPin.length <= 128 &&
    verifyPassword(normalizedPin, customPinRow.value);

  if (!isMatch) {
    const freshWindow = !rateRow || now - rateRow.first_fail_at > PIN_WINDOW_MS;
    const nextCount = freshWindow ? 1 : rateRow.fail_count + 1;
    const prevLockLevel = freshWindow ? 0 : rateRow.lock_level;
    let nextLockLevel = prevLockLevel;
    let lockedUntil = 0;

    if (nextCount >= PIN_MAX_ATTEMPTS) {
      nextLockLevel = Math.min(5, prevLockLevel + 1);
      const lockMinutes = Math.min(60, 5 * Math.pow(2, nextLockLevel - 1));
      lockedUntil = now + lockMinutes * 60 * 1000;
    }

    db.prepare(
      `
      INSERT INTO admin_auth_rate_limits (client_key, fail_count, lock_level, first_fail_at, locked_until, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(client_key) DO UPDATE SET
        fail_count = excluded.fail_count,
        lock_level = excluded.lock_level,
        first_fail_at = excluded.first_fail_at,
        locked_until = excluded.locked_until,
        updated_at = excluded.updated_at
    `
    ).run(
      clientKey,
      nextCount >= PIN_MAX_ATTEMPTS ? 0 : nextCount,
      nextLockLevel,
      freshWindow ? now : rateRow.first_fail_at,
      lockedUntil,
      now
    );

    logAudit('login_failed', 'anonymous', clientKey, 'auth', '', `attempt=${nextCount}`);

    // Progressive exponential delay against brute force
    const delayMs = Math.min(3500, nextCount * 600);
    await sleep(delayMs);

    if (lockedUntil > 0) {
      res.setHeader('Retry-After', String(Math.ceil((lockedUntil - now) / 1000)));
      res.status(429).json({
        error: 'تعذّر المتابعة مؤقتاً، حاول لاحقاً',
      });
      return;
    }

    res.status(401).json({ error: 'تعذّر المتابعة' });
    return;
  }

  // Clear per-source rate limit on success & prune expired sessions
  db.prepare(`DELETE FROM admin_auth_rate_limits WHERE client_key = ?`).run(clientKey);
  db.prepare(`DELETE FROM admin_sessions WHERE expires_at < ? OR (? - last_activity_at) > ?`).run(
    now,
    now,
    IDLE_TIMEOUT_MS
  );

  const sessionToken = generateToken(32);
  const csrfToken = generateToken(32);
  const expiresAt = now + MAX_SESSION_MS;

  db.prepare(
    `INSERT INTO admin_sessions (token_hash, username, role, csrf_token, last_activity_at, expires_at, ip_address, user_agent)
     VALUES (?, ?, 'admin', ?, ?, ?, ?, ?)`
  ).run(
    sha256(sessionToken),
    'admin',
    csrfToken,
    now,
    expiresAt,
    clientKey,
    String(req.headers['user-agent'] || '').slice(0, 200)
  );

  setCookie(req, res, ADMIN_COOKIE_NAME, sessionToken, Math.floor(MAX_SESSION_MS / 1000));
  logAudit('login_success', 'admin', clientKey, 'session', '');

  // Never expose sessionToken in response body; it resides strictly in HttpOnly cookie!
  res.json({
    authenticated: true,
    username: 'admin',
    role: 'admin',
    csrfToken,
  });
});

app.post('/api/admin/logout', (req, res) => {
  if (!verifySameOrigin(req)) {
    res.status(403).json({ error: 'مصدر الطلب غير مصرح به.' });
    return;
  }
  const session = getAdminSession(req, res, { touchActivity: false });
  if (session) {
    const headerCsrf = String(req.headers['x-csrf-token'] || '').trim();
    if (!safeEqualStrings(headerCsrf, session.csrfToken) && req.headers['x-requested-with'] !== 'Darajati-Client') {
      res.status(403).json({ error: 'طلب غير مصرح به.' });
      return;
    }
    db.prepare(`DELETE FROM admin_sessions WHERE token_hash = ?`).run(session.tokenHash);
    logAudit('logout', session.username, getClientIp(req), 'session', '');
  }
  clearCookie(req, res, ADMIN_COOKIE_NAME);
  res.json({ ok: true });
});

// Admin Listings
app.get('/api/admin/listings', requireAdmin, (req, res) => {
  const status = String(req.query.status || 'all');
  let where = '';
  let params: any[] = [];
  if (status === 'approved_or_sold') {
    where = `WHERE l.status IN ('approved', 'sold')`;
  } else if (['pending', 'approved', 'sold', 'rejected', 'hidden'].includes(status)) {
    where = `WHERE l.status = ?`;
    params = [status];
  }
  const rows = db
    .prepare(
      `
      SELECT l.*, c.name_ar as category_name, c.slug as category_slug, c.is_parts_or_accessories
      FROM listings l
      JOIN categories c ON c.id = l.category_id
      ${where}
      ORDER BY CASE WHEN l.status = 'pending' THEN 0 ELSE 1 END, l.created_at DESC
    `
    )
    .all(...params);
  res.json(rows.map(formatListingRow));
});

// Admin Create Listing (creates directly with approved status by default)
app.post('/api/admin/listings', requireAdmin, (req, res) => {
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
    status = 'approved',
  } = req.body || {};

  const cleanTitle = String(title || '').trim().slice(0, 120);
  const cat = db.prepare(`SELECT * FROM categories WHERE id = ?`).get(Number(category_id)) as any;
  if (!cat || cleanTitle.length < 3) {
    res.status(400).json({ error: 'يرجى التحقق من صحة عنوان المنشور والقسم.' });
    return;
  }
  const cleanImages = Array.isArray(images)
    ? images
        .map((img, idx) => {
          const safeUrl = sanitizeMediaUrl(img?.url, 'image');
          if (!safeUrl) return null;
          return { url: safeUrl, isCover: Boolean(img?.isCover) || idx === 0 };
        })
        .filter((x): x is { url: string; isCover: boolean } => x !== null)
        .slice(0, 10)
    : [];

  if (cleanImages.length === 0) {
    res.status(400).json({ error: 'يرجى إرفاق صورة واحدة على الأقل.' });
    return;
  }

  const finalStatus = ['approved', 'sold', 'hidden', 'pending'].includes(status) ? status : 'approved';
  const ownerToken = generateToken(24);
  const ownerCode = generateOwnerCode();

  const result = db
    .prepare(
      `
      INSERT INTO listings (
        title, brand, category_id, governorate, area, model_year, engine_cc, motor_watts, condition,
        price_iqd, negotiable, phone, description, keywords, images_json, video_url,
        status, is_demo, owner_token_hash, owner_code_hash
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
    `
    )
    .run(
      cleanTitle,
      String(brand || '').trim().slice(0, 80),
      cat.id,
      String(governorate || '').trim().slice(0, 60),
      String(area || '').trim().slice(0, 80),
      model_year !== null && model_year !== undefined && model_year !== '' ? Number(model_year) : null,
      engine_cc !== null && engine_cc !== undefined && engine_cc !== '' ? Number(engine_cc) : null,
      motor_watts !== null && motor_watts !== undefined && motor_watts !== '' ? Number(motor_watts) : null,
      condition === 'new' ? 'new' : 'used',
      Math.max(1000, Number(price_iqd) || 0),
      negotiable ? 1 : 0,
      normalizePhoneServer(phone),
      String(description || '').trim().slice(0, 3000),
      String(keywords || '').trim().slice(0, 200),
      JSON.stringify(cleanImages),
      video_url ? sanitizeMediaUrl(video_url, 'video') : null,
      finalStatus,
      sha256(ownerToken),
      hashPassword(ownerCode)
    );

  const newId = Number(result.lastInsertRowid);
  const row = db
    .prepare(
      `
      SELECT l.*, c.name_ar as category_name, c.slug as category_slug, c.is_parts_or_accessories
      FROM listings l
      JOIN categories c ON c.id = l.category_id
      WHERE l.id = ?
    `
    )
    .get(newId);

  logAudit('admin_listing_created', 'admin', getClientIp(req), 'listing', String(newId), cleanTitle);
  res.status(201).json({
    listing: formatListingRow(row),
    ownerToken,
    ownerCode,
  });
});

app.delete('/api/admin/demo-listings', requireAdmin, (req, res) => {
  const info = db.prepare(`DELETE FROM listings WHERE is_demo = 1`).run();
  logAudit('demo_listings_deleted', 'admin', getClientIp(req), 'listings', 'demo', `deleted=${info.changes}`);
  res.json({ deleted: info.changes });
});

// Admin Categories
app.post('/api/admin/categories', requireAdmin, (req, res) => {
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
    const result = db
      .prepare(
        `INSERT INTO categories (slug, name_ar, image_url, is_parts_or_accessories, sort_order) VALUES (?, ?, ?, ?, ?)`
      )
      .run(slug, name_ar, image_url, is_parts_or_accessories, Number.isFinite(sort_order) ? sort_order : 10);
    const created = db.prepare(`SELECT * FROM categories WHERE id = ?`).get(result.lastInsertRowid) as any;
    logAudit('category_created', 'admin', getClientIp(req), 'category', String(created.id), name_ar);
    res.status(201).json({
      ...created,
      is_parts_or_accessories: Boolean(created.is_parts_or_accessories),
    });
  } catch {
    res.status(400).json({ error: 'تعذر إضافة القسم، قد يكون الاسم أو المعرف مستخدماً مسبقاً.' });
  }
});

app.patch('/api/admin/categories/:id', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare(`SELECT * FROM categories WHERE id = ?`).get(id) as any;
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

  db.prepare(
    `UPDATE categories SET name_ar = ?, image_url = ?, is_parts_or_accessories = ?, sort_order = ? WHERE id = ?`
  ).run(name_ar, image_url, is_parts_or_accessories, Number.isFinite(sort_order) ? sort_order : 10, id);

  logAudit('category_updated', 'admin', getClientIp(req), 'category', String(id), name_ar);
  const updated = db.prepare(`SELECT * FROM categories WHERE id = ?`).get(id) as any;
  res.json({ ...updated, is_parts_or_accessories: Boolean(updated.is_parts_or_accessories) });
});

app.delete('/api/admin/categories/:id', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const count = (db.prepare(`SELECT COUNT(*) as cnt FROM listings WHERE category_id = ?`).get(id) as { cnt: number }).cnt;
  if (count > 0) {
    res.status(400).json({ error: 'لا يمكن حذف قسم يحتوي على منشورات حالية. احذف أو انقل المنشورات أولاً.' });
    return;
  }
  db.prepare(`DELETE FROM categories WHERE id = ?`).run(id);
  logAudit('category_deleted', 'admin', getClientIp(req), 'category', String(id));
  res.json({ ok: true });
});

// Admin Sliders
app.get('/api/admin/sliders', requireAdmin, (_req, res) => {
  const rows = db.prepare(`SELECT * FROM sliders ORDER BY sort_order ASC, id ASC`).all();
  res.json(rows.map((r: any) => ({ ...r, is_active: Boolean(r.is_active) })));
});

app.post('/api/admin/sliders', requireAdmin, (req, res) => {
  const title = String(req.body?.title || '').trim().slice(0, 120);
  const subtitle = String(req.body?.subtitle || '').trim().slice(0, 240);
  const image_url = sanitizeMediaUrl(req.body?.image_url, 'image');
  const link_category_id = req.body?.link_category_id ? Number(req.body.link_category_id) : null;
  const sort_order = Number(req.body?.sort_order || 1);
  const is_active = req.body?.is_active !== false ? 1 : 0;

  if (!title || !image_url) {
    res.status(400).json({ error: 'يرجى إدخال عنوان الشريحة ورفع صورة صالحة.' });
    return;
  }

  const result = db
    .prepare(
      `INSERT INTO sliders (title, subtitle, image_url, link_category_id, sort_order, is_active) VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(title, subtitle, image_url, link_category_id, Number.isFinite(sort_order) ? sort_order : 1, is_active);

  const created = db.prepare(`SELECT * FROM sliders WHERE id = ?`).get(result.lastInsertRowid) as any;
  logAudit('slider_created', 'admin', getClientIp(req), 'slider', String(created.id), title);
  res.status(201).json({ ...created, is_active: Boolean(created.is_active) });
});

app.patch('/api/admin/sliders/:id', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare(`SELECT * FROM sliders WHERE id = ?`).get(id) as any;
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
  const sort_order = req.body?.sort_order !== undefined ? Number(req.body.sort_order) : existing.sort_order;
  const is_active = req.body?.is_active !== undefined ? (req.body.is_active ? 1 : 0) : existing.is_active;

  db.prepare(
    `UPDATE sliders SET title = ?, subtitle = ?, image_url = ?, link_category_id = ?, sort_order = ?, is_active = ? WHERE id = ?`
  ).run(title, subtitle, image_url, link_category_id, Number.isFinite(sort_order) ? sort_order : 1, is_active, id);

  logAudit('slider_updated', 'admin', getClientIp(req), 'slider', String(id), title);
  const updated = db.prepare(`SELECT * FROM sliders WHERE id = ?`).get(id) as any;
  res.json({ ...updated, is_active: Boolean(updated.is_active) });
});

app.delete('/api/admin/sliders/:id', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  db.prepare(`DELETE FROM sliders WHERE id = ?`).run(id);
  logAudit('slider_deleted', 'admin', getClientIp(req), 'slider', String(id));
  res.json({ ok: true });
});

// Admin Reports
app.get('/api/admin/reports', requireAdmin, (_req, res) => {
  const rows = db
    .prepare(
      `
      SELECT r.*, l.title as listing_title, l.status as listing_status
      FROM reports r
      JOIN listings l ON l.id = r.listing_id
      ORDER BY CASE WHEN r.status = 'open' THEN 0 ELSE 1 END, r.created_at DESC
    `
    )
    .all();
  res.json(rows);
});

app.patch('/api/admin/reports/:id', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const status = String(req.body?.status || '');
  if (!['open', 'reviewed', 'dismissed'].includes(status)) {
    res.status(400).json({ error: 'حالة البلاغ غير صالحة.' });
    return;
  }
  db.prepare(`UPDATE reports SET status = ? WHERE id = ?`).run(status, id);
  logAudit('report_updated', 'admin', getClientIp(req), 'report', String(id), `status=${status}`);
  res.json({ ok: true });
});

// Admin Overview Stats & Charts
app.get('/api/admin/overview', requireAdmin, (req, res) => {
  const days = Number(req.query.days) === 30 ? 30 : 7;

  const totalVisits = (db.prepare(`SELECT COUNT(*) as cnt FROM site_visits`).get() as { cnt: number }).cnt;
  const publishedListings = (
    db.prepare(`SELECT COUNT(*) as cnt FROM listings WHERE status IN ('approved', 'sold')`).get() as { cnt: number }
  ).cnt;
  const pendingListings = (
    db.prepare(`SELECT COUNT(*) as cnt FROM listings WHERE status = 'pending'`).get() as { cnt: number }
  ).cnt;
  const rejectedListings = (
    db.prepare(`SELECT COUNT(*) as cnt FROM listings WHERE status = 'rejected'`).get() as { cnt: number }
  ).cnt;
  const totalCategories = (db.prepare(`SELECT COUNT(*) as cnt FROM categories`).get() as { cnt: number }).cnt;
  const openReports = (
    db.prepare(`SELECT COUNT(*) as cnt FROM reports WHERE status = 'open'`).get() as { cnt: number }
  ).cnt;
  const unreadNotifications = (
    db.prepare(`SELECT COUNT(*) as cnt FROM admin_notifications WHERE is_read = 0`).get() as { cnt: number }
  ).cnt;

  const rawActivity = db
    .prepare(
      `
      SELECT date(created_at) as day, COUNT(*) as cnt
      FROM listings
      WHERE date(created_at) >= date('now', ?)
      GROUP BY date(created_at)
      ORDER BY day ASC
    `
    )
    .all(`-${days - 1} days`) as Array<{ day: string; cnt: number }>;

  const activityMap = new Map<string, number>();
  for (const row of rawActivity) {
    activityMap.set(row.day, row.cnt);
  }

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
      count: activityMap.get(iso) || 0,
    });
  }

  const categoryDistribution = db
    .prepare(
      `
      SELECT c.id, c.name_ar, COUNT(l.id) as count
      FROM categories c
      LEFT JOIN listings l ON l.category_id = c.id AND l.status != 'rejected'
      GROUP BY c.id
      ORDER BY c.sort_order ASC, c.id ASC
    `
    )
    .all() as Array<{ id: number; name_ar: string; count: number }>;

  res.json({
    totalVisits,
    publishedListings,
    pendingListings,
    rejectedListings,
    totalCategories,
    openReports,
    unreadNotifications,
    activitySeries,
    categoryDistribution,
  });
});

// Admin Global Search
app.get('/api/admin/search', requireAdmin, (req, res) => {
  const q = String(req.query.q || '').trim().slice(0, 120);
  if (!q) {
    res.json({ listings: [], categories: [] });
    return;
  }
  const like = `%${q}%`;
  const listings = db
    .prepare(
      `
      SELECT l.*, c.name_ar as category_name, c.slug as category_slug, c.is_parts_or_accessories
      FROM listings l
      JOIN categories c ON c.id = l.category_id
      WHERE l.title LIKE ? OR l.brand LIKE ? OR l.keywords LIKE ? OR l.description LIKE ? OR l.governorate LIKE ? OR c.name_ar LIKE ?
      ORDER BY l.created_at DESC
      LIMIT 30
    `
    )
    .all(like, like, like, like, like, like)
    .map(formatListingRow);

  const categories = db
    .prepare(
      `
      SELECT c.*,
        (SELECT COUNT(*) FROM listings l WHERE l.category_id = c.id AND l.status != 'rejected') as listings_count
      FROM categories c
      WHERE c.name_ar LIKE ?
      ORDER BY c.sort_order ASC
    `
    )
    .all(like)
    .map((r: any) => ({
      ...r,
      is_parts_or_accessories: Boolean(r.is_parts_or_accessories),
    }));

  res.json({ listings, categories });
});

// Admin Notifications
app.get('/api/admin/notifications', requireAdmin, (_req, res) => {
  const rows = db
    .prepare(`SELECT * FROM admin_notifications ORDER BY is_read ASC, created_at DESC, id DESC LIMIT 100`)
    .all() as any[];
  res.json(rows.map((r) => ({ ...r, is_read: Boolean(r.is_read) })));
});

app.patch('/api/admin/notifications/:id/read', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  db.prepare(`UPDATE admin_notifications SET is_read = 1 WHERE id = ?`).run(id);
  res.json({ ok: true });
});

app.post('/api/admin/notifications/read-all', requireAdmin, (_req, res) => {
  db.prepare(`UPDATE admin_notifications SET is_read = 1 WHERE is_read = 0`).run();
  res.json({ ok: true });
});

// Admin Security Audit Logs (read-only)
app.get('/api/admin/audit-logs', requireAdmin, (_req, res) => {
  const rows = db
    .prepare(
      `SELECT id, event_type, actor, ip_address, target_type, target_id, details, created_at
       FROM admin_audit_logs ORDER BY id DESC LIMIT 50`
    )
    .all();
  res.json(rows);
});

// Admin Settings
app.get('/api/admin/settings', requireAdmin, (_req, res) => {
  const rows = db
    .prepare(`SELECT key, value FROM admin_settings WHERE key != 'admin_pin_hash'`)
    .all() as Array<{ key: string; value: string }>;
  const settings: Record<string, string> = {};
  for (const r of rows) settings[r.key] = r.value;
  res.json(settings);
});

app.patch('/api/admin/settings', requireAdmin, (req, res) => {
  const allowed = ['platform_name', 'support_phone', 'moderation_note'];
  const upsert = db.prepare(
    `INSERT INTO admin_settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`
  );
  const body = req.body || {};
  for (const key of allowed) {
    if (body[key] !== undefined) {
      upsert.run(key, String(body[key]).slice(0, 500));
    }
  }
  logAudit('settings_updated', 'admin', getClientIp(req), 'settings', '');
  res.json({ ok: true });
});

// Change Admin PIN / Passphrase (requires verifying current PIN, hashes with scrypt, invalidates ALL prior sessions)
app.post('/api/admin/settings/pin', requireAdmin, (req, res) => {
  const currentPin = normalizeDigitsServer(String(req.body?.currentPin || ''));
  const newPin = normalizeDigitsServer(String(req.body?.newPin || ''));

  const pinRow = db.prepare(`SELECT value FROM admin_settings WHERE key = 'admin_pin_hash'`).get() as
    | { value: string }
    | undefined;

  if (!pinRow?.value || !currentPin || !verifyPassword(currentPin, pinRow.value)) {
    logAudit('pin_change_failed', 'admin', getClientIp(req), 'settings', '', 'الرمز الحالي غير صحيح');
    res.status(403).json({ error: 'الرمز الحالي غير صحيح.' });
    return;
  }

  if (newPin.length < 6 || newPin.length > 128) {
    res.status(400).json({ error: 'يجب أن يتكون الرمز أو عبارة المرور الجديدة من 6 إلى 128 خانة.' });
    return;
  }

  const newHash = hashPassword(newPin);
  db.prepare(
    `INSERT INTO admin_settings (key, value, updated_at) VALUES ('admin_pin_hash', ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`
  ).run(newHash);

  // Invalidate ALL previous admin sessions and rotate to a fresh session for current admin
  db.prepare(`DELETE FROM admin_sessions`).run();

  const now = Date.now();
  const nextSessionToken = generateToken(32);
  const nextCsrfToken = generateToken(32);
  db.prepare(
    `INSERT INTO admin_sessions (token_hash, username, role, csrf_token, last_activity_at, expires_at, ip_address, user_agent)
     VALUES (?, 'admin', 'admin', ?, ?, ?, ?, ?)`
  ).run(
    sha256(nextSessionToken),
    nextCsrfToken,
    now,
    now + MAX_SESSION_MS,
    getClientIp(req),
    String(req.headers['user-agent'] || '').slice(0, 200)
  );

  setCookie(req, res, ADMIN_COOKIE_NAME, nextSessionToken, Math.floor(MAX_SESSION_MS / 1000));
  logAudit('pin_changed', 'admin', getClientIp(req), 'settings', '', 'تم تغيير رمز الإدارة وإبطال جميع الجلسات السابقة');
  res.json({ ok: true, csrfToken: nextCsrfToken });
});

// Admin Managed Synonym Dictionary CRUD
app.get('/api/admin/synonyms', requireAdmin, (_req, res) => {
  const rows = db
    .prepare(
      `
      SELECT s.*, c.name_ar as category_name, c.slug as category_slug
      FROM search_synonyms s
      LEFT JOIN categories c ON c.id = s.category_id
      ORDER BY CASE WHEN s.is_active = 0 AND s.target_type = 'ambiguous' THEN 0 ELSE 1 END, s.id DESC
    `
    )
    .all() as any[];

  const brands = db
    .prepare(
      `SELECT DISTINCT brand FROM listings WHERE brand != ''
       UNION
       SELECT DISTINCT canonical_value as brand FROM search_synonyms WHERE target_type = 'brand' AND canonical_value != ''`
    )
    .all()
    .map((r: any) => r.brand);

  res.json({
    synonyms: rows.map((r) => {
      let options = [];
      try {
        options = JSON.parse(r.disambiguation_options_json || '[]');
      } catch {
        options = [];
      }
      return {
        id: r.id,
        term: r.term,
        normalized_term: r.normalized_term,
        target_type: r.target_type,
        canonical_value: r.canonical_value,
        category_id: r.category_id ?? null,
        category_name: r.category_name ?? null,
        category_slug: r.category_slug ?? null,
        disambiguation_options: options,
        is_active: Boolean(r.is_active),
        notes: r.notes || '',
        created_at: r.created_at,
        updated_at: r.updated_at,
      };
    }),
    knownBrands: brands,
  });
});

app.post('/api/admin/synonyms', requireAdmin, (req, res) => {
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

  let resolvedCanonical = canonical_value;
  if (target_type === 'category' && category_id) {
    const cat = db.prepare(`SELECT slug, name_ar FROM categories WHERE id = ?`).get(category_id) as any;
    if (!cat) {
      res.status(400).json({ error: 'القسم المحدد غير موجود.' });
      return;
    }
    if (!resolvedCanonical) resolvedCanonical = cat.slug;
  }

  const normalized_term = normalizeArabicText(term);
  const result = db
    .prepare(
      `
      INSERT INTO search_synonyms (
        term, normalized_term, target_type, canonical_value, category_id, disambiguation_options_json, is_active, notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `
    )
    .run(
      term,
      normalized_term,
      target_type,
      resolvedCanonical,
      category_id,
      JSON.stringify(disambiguation_options),
      is_active,
      notes
    );

  const created = db
    .prepare(
      `SELECT s.*, c.name_ar as category_name, c.slug as category_slug
       FROM search_synonyms s LEFT JOIN categories c ON c.id = s.category_id WHERE s.id = ?`
    )
    .get(result.lastInsertRowid) as any;

  logAudit('synonym_created', 'admin', getClientIp(req), 'synonym', String(created.id), term);
  res.status(201).json({
    ...created,
    disambiguation_options: disambiguation_options,
    is_active: Boolean(created.is_active),
  });
});

app.patch('/api/admin/synonyms/:id', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare(`SELECT * FROM search_synonyms WHERE id = ?`).get(id) as any;
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
      ? JSON.stringify(
          Array.isArray(req.body.disambiguation_options)
            ? req.body.disambiguation_options.slice(0, 10)
            : []
        )
      : existing.disambiguation_options_json;

  if (target_type === 'category' && category_id && !canonical_value) {
    const cat = db.prepare(`SELECT slug FROM categories WHERE id = ?`).get(category_id) as any;
    if (cat) canonical_value = cat.slug;
  }

  db.prepare(
    `
    UPDATE search_synonyms
    SET term = ?, normalized_term = ?, target_type = ?, canonical_value = ?,
        category_id = ?, disambiguation_options_json = ?, is_active = ?, notes = ?,
        updated_at = datetime('now')
    WHERE id = ?
  `
  ).run(
    term,
    normalizeArabicText(term),
    target_type,
    canonical_value,
    category_id,
    disambiguation_options_json,
    is_active,
    notes,
    id
  );

  logAudit('synonym_updated', 'admin', getClientIp(req), 'synonym', String(id), term);

  const updated = db
    .prepare(
      `SELECT s.*, c.name_ar as category_name, c.slug as category_slug
       FROM search_synonyms s LEFT JOIN categories c ON c.id = s.category_id WHERE s.id = ?`
    )
    .get(id) as any;

  let opts = [];
  try {
    opts = JSON.parse(updated.disambiguation_options_json || '[]');
  } catch {
    opts = [];
  }

  res.json({
    ...updated,
    disambiguation_options: opts,
    is_active: Boolean(updated.is_active),
  });
});

app.delete('/api/admin/synonyms/:id', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  db.prepare(`DELETE FROM search_synonyms WHERE id = ?`).run(id);
  logAudit('synonym_deleted', 'admin', getClientIp(req), 'synonym', String(id));
  res.json({ ok: true });
});

// Reject unknown /api/* calls cleanly instead of falling through to SPA HTML
app.use('/api', (_req, res) => {
  res.status(404).json({ error: 'المسار غير موجود.' });
});

// Server-side guard on /admin page route: never disclose protected section to unauthorized callers
app.use('/admin', (req, res, next) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.setHeader('Pragma', 'no-cache');
  const session = getAdminSession(req, res, { touchActivity: false });
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
