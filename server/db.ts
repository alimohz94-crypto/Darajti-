import Database from 'better-sqlite3';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

const dbPath = path.resolve(process.env.DATABASE_PATH || './data/darajati.db');
fs.mkdirSync(path.dirname(dbPath), { recursive: true, mode: 0o750 });

export const db = new Database(dbPath);
try {
  fs.chmodSync(dbPath, 0o600);
} catch {
  // Ignore on filesystems that don't support POSIX chmod
}
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

export function sha256(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

export function verifyPassword(password: string, storedHash: string): boolean {
  const [salt, key] = storedHash.split(':');
  if (!salt || !key) return false;
  const derived = crypto.scryptSync(password, salt, 64);
  const keyBuf = Buffer.from(key, 'hex');
  if (derived.length !== keyBuf.length) return false;
  return crypto.timingSafeEqual(derived, keyBuf);
}

export function generateToken(bytes = 24): string {
  return crypto.randomBytes(bytes).toString('hex');
}

export function generateOwnerCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  const bytes = crypto.randomBytes(8);
  for (let i = 0; i < 8; i++) {
    code += chars[bytes[i] % chars.length];
  }
  return code;
}

export function initDatabase(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slug TEXT UNIQUE NOT NULL,
      name_ar TEXT NOT NULL,
      image_url TEXT NOT NULL,
      is_parts_or_accessories INTEGER NOT NULL DEFAULT 0,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS listings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      brand TEXT NOT NULL DEFAULT '',
      category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE RESTRICT,
      governorate TEXT NOT NULL,
      area TEXT NOT NULL DEFAULT '',
      model_year INTEGER,
      engine_cc INTEGER,
      motor_watts INTEGER,
      condition TEXT NOT NULL CHECK(condition IN ('new', 'used')),
      price_iqd INTEGER NOT NULL,
      negotiable INTEGER NOT NULL DEFAULT 0,
      phone TEXT NOT NULL,
      description TEXT NOT NULL,
      keywords TEXT NOT NULL DEFAULT '',
      images_json TEXT NOT NULL DEFAULT '[]',
      video_url TEXT,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'approved', 'sold', 'rejected')),
      is_demo INTEGER NOT NULL DEFAULT 0,
      owner_token_hash TEXT NOT NULL,
      owner_code_hash TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_listings_status_created ON listings(status, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_listings_category ON listings(category_id);
    CREATE INDEX IF NOT EXISTS idx_listings_governorate ON listings(governorate);

    CREATE TABLE IF NOT EXISTS search_synonyms (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      term TEXT NOT NULL,
      normalized_term TEXT NOT NULL,
      target_type TEXT NOT NULL CHECK(target_type IN ('brand', 'category', 'keyword', 'ambiguous')),
      canonical_value TEXT NOT NULL DEFAULT '',
      category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
      disambiguation_options_json TEXT NOT NULL DEFAULT '[]',
      is_active INTEGER NOT NULL DEFAULT 1,
      notes TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_synonyms_norm ON search_synonyms(normalized_term);

    CREATE TABLE IF NOT EXISTS sliders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      subtitle TEXT NOT NULL DEFAULT '',
      image_url TEXT NOT NULL,
      link_category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      listing_id INTEGER NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
      reason TEXT NOT NULL,
      details TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open', 'reviewed', 'dismissed')),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS admin_users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS admin_sessions (
      token_hash TEXT PRIMARY KEY,
      username TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'admin',
      csrf_token TEXT NOT NULL DEFAULT '',
      last_activity_at INTEGER NOT NULL DEFAULT 0,
      expires_at INTEGER NOT NULL DEFAULT 0,
      ip_address TEXT NOT NULL DEFAULT '',
      user_agent TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS admin_auth_rate_limits (
      client_key TEXT PRIMARY KEY,
      fail_count INTEGER NOT NULL DEFAULT 0,
      lock_level INTEGER NOT NULL DEFAULT 0,
      first_fail_at INTEGER NOT NULL DEFAULT 0,
      locked_until INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS admin_audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_type TEXT NOT NULL,
      actor TEXT NOT NULL,
      ip_address TEXT NOT NULL DEFAULT '',
      target_type TEXT NOT NULL DEFAULT '',
      target_id TEXT NOT NULL DEFAULT '',
      details TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON admin_audit_logs(created_at DESC);

    CREATE TABLE IF NOT EXISTS media_assets (
      filename TEXT PRIMARY KEY,
      kind TEXT NOT NULL CHECK(kind IN ('images', 'videos')),
      upload_token_hash TEXT NOT NULL DEFAULT '',
      listing_id INTEGER REFERENCES listings(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS owner_media_grants (
      token_hash TEXT NOT NULL,
      listing_id INTEGER NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (token_hash, listing_id)
    );

    CREATE TABLE IF NOT EXISTS site_visits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT UNIQUE NOT NULL,
      visited_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS admin_notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL DEFAULT '',
      target_section TEXT NOT NULL DEFAULT 'pending',
      target_id INTEGER,
      is_read INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS admin_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  // Migrate legacy admin_sessions table if missing hardened columns
  const sessionCols = db.prepare(`PRAGMA table_info(admin_sessions)`).all() as Array<{ name: string }>;
  const sessionColNames = new Set(sessionCols.map((c) => c.name));
  if (!sessionColNames.has('csrf_token') || !sessionColNames.has('last_activity_at')) {
    db.exec(`
      DROP TABLE IF EXISTS admin_sessions;
      CREATE TABLE admin_sessions (
        token_hash TEXT PRIMARY KEY,
        username TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'admin',
        csrf_token TEXT NOT NULL DEFAULT '',
        last_activity_at INTEGER NOT NULL DEFAULT 0,
        expires_at INTEGER NOT NULL DEFAULT 0,
        ip_address TEXT NOT NULL DEFAULT '',
        user_agent TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
  }

  // Safe migrations for existing listings tables
  const listingCols = db.prepare(`PRAGMA table_info(listings)`).all() as Array<{ name: string }>;
  const existingCols = new Set(listingCols.map((c) => c.name));
  if (!existingCols.has('brand')) {
    db.exec(`ALTER TABLE listings ADD COLUMN brand TEXT NOT NULL DEFAULT ''`);
  }
  if (!existingCols.has('engine_cc')) {
    db.exec(`ALTER TABLE listings ADD COLUMN engine_cc INTEGER`);
  }
  if (!existingCols.has('motor_watts')) {
    db.exec(`ALTER TABLE listings ADD COLUMN motor_watts INTEGER`);
  }
  if (!existingCols.has('keywords')) {
    db.exec(`ALTER TABLE listings ADD COLUMN keywords TEXT NOT NULL DEFAULT ''`);
  }

  // Ensure listings status check allows 'hidden'
  try {
    const tableSql = db.prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name='listings'`).get() as { sql: string } | undefined;
    if (tableSql && tableSql.sql && !tableSql.sql.includes("'hidden'")) {
      db.exec(`
        CREATE TABLE listings_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          title TEXT NOT NULL,
          brand TEXT NOT NULL DEFAULT '',
          category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE RESTRICT,
          governorate TEXT NOT NULL,
          area TEXT NOT NULL DEFAULT '',
          model_year INTEGER,
          engine_cc INTEGER,
          motor_watts INTEGER,
          condition TEXT NOT NULL CHECK(condition IN ('new', 'used')),
          price_iqd INTEGER NOT NULL,
          negotiable INTEGER NOT NULL DEFAULT 0,
          phone TEXT NOT NULL,
          description TEXT NOT NULL,
          keywords TEXT NOT NULL DEFAULT '',
          images_json TEXT NOT NULL DEFAULT '[]',
          video_url TEXT,
          status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'approved', 'sold', 'rejected', 'hidden')),
          is_demo INTEGER NOT NULL DEFAULT 0,
          owner_token_hash TEXT NOT NULL,
          owner_code_hash TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        INSERT INTO listings_new SELECT * FROM listings;
        DROP TABLE listings;
        ALTER TABLE listings_new RENAME TO listings;
      `);
    }
  } catch (e) {
    console.error('Migration error for hidden listing status:', e);
  }

  const defaultSettings: Array<[string, string]> = [
    ['platform_name', 'دراجتي'],
    ['support_phone', ''],
    ['moderation_note', 'تُراجع المنشورات الجديدة قبل نشرها للعامة لضمان جودة ومصداقية الإعلانات.'],
  ];
  const insertSetting = db.prepare(`INSERT OR IGNORE INTO admin_settings (key, value) VALUES (?, ?)`);
  for (const [k, v] of defaultSettings) {
    insertSetting.run(k, v);
  }
  // Ensure auto-approve bypass is disabled
  db.prepare(`INSERT INTO admin_settings (key, value) VALUES ('auto_approve_listings', '0') ON CONFLICT(key) DO UPDATE SET value = '0'`).run();

  // Bootstrap admin_pin_hash using scrypt: use process.env.ADMIN_PIN if provided, otherwise default to '199444'
  const rawEnvPin = String(process.env.ADMIN_PIN || '199444').trim();
  const arabicDigits = '٠١٢٣٤٥٦٧٨٩';
  const persianDigits = '۰۱۲۳۴۵۶۷۸۹';
  let normEnvPin = rawEnvPin;
  for (let i = 0; i < 10; i++) {
    normEnvPin = normEnvPin.replaceAll(arabicDigits[i], String(i)).replaceAll(persianDigits[i], String(i));
  }
  const existingPinRow = db.prepare(`SELECT value FROM admin_settings WHERE key = 'admin_pin_hash'`).get() as
    | { value: string }
    | undefined;
  if (!existingPinRow || !existingPinRow.value.includes(':')) {
    db.prepare(
      `INSERT INTO admin_settings (key, value, updated_at) VALUES ('admin_pin_hash', ?, datetime('now'))
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`
    ).run(hashPassword(normEnvPin));
  }

  const categoryCount = (db.prepare('SELECT COUNT(*) as cnt FROM categories').get() as { cnt: number }).cnt;
  if (categoryCount === 0) {
    const insertCat = db.prepare(
      `INSERT INTO categories (slug, name_ar, image_url, is_parts_or_accessories, sort_order) VALUES (?, ?, ?, ?, ?)`
    );
    const seedCategories = [
      ['motorcycles', 'دراجات نارية', '/src/assets/images/cat_motorcycle_1795186795635.jpg', 0, 1],
      ['scooters', 'سكوترات', '/src/assets/images/cat_scooter_1795186796681.jpg', 0, 2],
      ['bicycles', 'دراجات هوائية', '/src/assets/images/cat_bicycle_1795186795956.jpg', 0, 3],
      ['ebikes', 'دراجات كهربائية', '/src/assets/images/cat_ebike_1795186795815.jpg', 0, 4],
      ['spare-parts', 'قطع غيار', '/src/assets/images/cat_spare_parts_1795186796568.jpg', 1, 5],
      ['accessories', 'إكسسوارات ومستلزمات', '/src/assets/images/cat_accessories_1795186795800.jpg', 1, 6],
    ] as const;

    const tx = db.transaction(() => {
      for (const c of seedCategories) {
        insertCat.run(c[0], c[1], c[2], c[3], c[4]);
      }
    });
    tx();
  }

  const sliderCount = (db.prepare('SELECT COUNT(*) as cnt FROM sliders').get() as { cnt: number }).cnt;
  if (sliderCount === 0) {
    const motoCat = db.prepare(`SELECT id FROM categories WHERE slug = 'motorcycles'`).get() as { id: number } | undefined;
    const scooterCat = db.prepare(`SELECT id FROM categories WHERE slug = 'scooters'`).get() as { id: number } | undefined;

    db.prepare(
      `INSERT INTO sliders (title, subtitle, image_url, link_category_id, sort_order, is_active) VALUES (?, ?, ?, ?, ?, ?)`
    ).run(
      'دراجتك الجاية هنا',
      'تصفح مئات الدراجات النارية والسكوترات في جميع محافظات العراق',
      '/src/assets/images/hero_red_sportbike_1795186795990.jpg',
      motoCat?.id ?? null,
      1,
      1
    );

    db.prepare(
      `INSERT INTO sliders (title, subtitle, image_url, link_category_id, sort_order, is_active) VALUES (?, ?, ?, ?, ?, ?)`
    ).run(
      'تواصل مباشر مع البائع',
      'دراجات نارية، سكوترات، دراجات كهربائية وقطع غيار أصلية',
      '/src/assets/images/hero_urban_commute_1795186796549.jpg',
      scooterCat?.id ?? null,
      2,
      1
    );
  }

  const listingCount = (db.prepare('SELECT COUNT(*) as cnt FROM listings').get() as { cnt: number }).cnt;
  if (listingCount === 0) {
    const cats = db.prepare('SELECT id, slug FROM categories').all() as Array<{ id: number; slug: string }>;
    const bySlug = Object.fromEntries(cats.map((c) => [c.slug, c.id]));

    const insertListing = db.prepare(`
      INSERT INTO listings (
        title, brand, category_id, governorate, area, model_year, engine_cc, motor_watts,
        condition, price_iqd, negotiable, phone, description, keywords, images_json, video_url,
        status, is_demo, owner_token_hash, owner_code_hash, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 'approved', 1, ?, ?, datetime('now', ?), datetime('now', ?))
    `);

    const demoSecret = sha256('demo-listing-placeholder-token');
    const demoListings = [
      {
        title: 'هوندا 2022',
        brand: 'هوندا',
        slug: 'motorcycles',
        governorate: 'كربلاء',
        area: 'حي الحسين',
        model_year: 2022,
        engine_cc: 600,
        motor_watts: null,
        condition: 'used',
        price_iqd: 5750000,
        negotiable: 1,
        phone: '07701234567',
        description:
          'دراجة هوندا نظيفة جداً بحالة الوكالة، محرك 600 سي سي، ماشية مسافة قليلة، صيانة دورية منتظمة، إطارات جديدة، أوراق مرورية أصولية جاهزة للتحويل.',
        keywords: 'Honda CBR600 سبورت ياباني',
        images: [
          { url: '/src/assets/images/sample_honda_red_1795186796623.jpg', isCover: true },
          { url: '/src/assets/images/hero_red_sportbike_1795186795990.jpg', isCover: false },
        ],
        offset: '-10 minutes',
      },
      {
        title: 'ياماها R1 رياضية 2023',
        brand: 'ياماها',
        slug: 'motorcycles',
        governorate: 'كربلاء',
        area: 'مركز المدينة',
        model_year: 2023,
        engine_cc: 1000,
        motor_watts: null,
        condition: 'used',
        price_iqd: 6900000,
        negotiable: 1,
        phone: '07801234568',
        description:
          'ياماها أزرق رياضي موديل 2023، تبريد ماء، فرامل ABS، قزوز رياضي أصلي، نظافة فائقة بدون أي حوادث أو صبغ.',
        keywords: 'Yamaha R1 سبورت ريسنك',
        images: [{ url: '/src/assets/images/cat_motorcycle_1795186795635.jpg', isCover: true }],
        offset: '-30 minutes',
      },
      {
        title: 'سكوتر فيسبا كلاسيك أبيض',
        brand: 'فيسبا',
        slug: 'scooters',
        governorate: 'بغداد',
        area: 'المنصور',
        model_year: 2024,
        engine_cc: 150,
        motor_watts: null,
        condition: 'new',
        price_iqd: 2850000,
        negotiable: 0,
        phone: '07712345678',
        description:
          'سكوتر اقتصادي ممتاز للتنقل داخل بغداد، محرك 150 سي سي، تشغيل بصمة وسلف، إضاءة LED كاملة، خزان وقود اقتصادي جداً، مقعد جلدي مريح.',
        keywords: 'Vespa 150cc سكوتر بنزين',
        images: [{ url: '/src/assets/images/cat_scooter_1795186796681.jpg', isCover: true }],
        offset: '-2 hours',
      },
      {
        title: 'دراجة كهربائية شحن سريع 1500 واط',
        brand: 'شحن ذكي',
        slug: 'ebikes',
        governorate: 'أربيل',
        area: 'إمباير',
        model_year: 2025,
        engine_cc: null,
        motor_watts: 1500,
        condition: 'new',
        price_iqd: 1650000,
        negotiable: 1,
        phone: '07501234569',
        description:
          'دراجة كهربائية حديثة ببطارية ليثيوم قابلة للإزالة، تقطع حتى 70 كم بالشحنة الواحدة، شاشة رقمية ذكية مع إنذار ضد السرقة.',
        keywords: 'سكوتر كهربائي شحن كهرباء بطارية ليثيوم',
        images: [{ url: '/src/assets/images/cat_ebike_1795186795815.jpg', isCover: true }],
        offset: '-5 hours',
      },
      {
        title: 'دراجة هوائية جبلية سبيشلايزد مقاس 29',
        brand: 'سبيشلايزد',
        slug: 'bicycles',
        governorate: 'البصرة',
        area: 'العشار',
        model_year: 2023,
        engine_cc: null,
        motor_watts: null,
        condition: 'used',
        price_iqd: 680000,
        negotiable: 1,
        phone: '07723456789',
        description:
          'دراجة هوائية احترافية هيكل ألمنيوم خفيف، مساعدات هوائية أمامية وخلفية، نظام تروس شيمانو أصلي 12 سرعة، مكابح قرصية هيدروليكية.',
        keywords: 'Specialized بايسكل سيكل عجلة جبلية',
        images: [{ url: '/src/assets/images/cat_bicycle_1795186795956.jpg', isCover: true }],
        offset: '-1 day',
      },
      {
        title: 'طقم ديسك بريك وزنجيل ذهبي وفلتر هواء رياضي',
        brand: 'عام / متعدد',
        slug: 'spare-parts',
        governorate: 'النجف',
        area: 'حي الأمير',
        model_year: 2024,
        engine_cc: null,
        motor_watts: null,
        condition: 'new',
        price_iqd: 185000,
        negotiable: 0,
        phone: '07813456780',
        description:
          'طقم صيانة كامل متوافق مع أغلب الدراجات النارية اليابانية والصينية 250cc - 600cc، يشمل ديسك بريك ستانلس ستيل، زنجيل ذهبي مقوى مع مسنن، وفلتر زيت وهواء.',
        keywords: 'سبير قطع غيار صيانة زنجيل فلتر بريك',
        images: [{ url: '/src/assets/images/cat_spare_parts_1795186796568.jpg', isCover: true }],
        offset: '-2 days',
      },
      {
        title: 'خوذة سلامة مطفية مع قفازات جلدية محمية',
        brand: 'حماية',
        slug: 'accessories',
        governorate: 'بغداد',
        area: 'الكرادة',
        model_year: null,
        engine_cc: null,
        motor_watts: null,
        condition: 'new',
        price_iqd: 145000,
        negotiable: 1,
        phone: '07734567891',
        description:
          'خوذة كاملة بمواصفات أمان معتمدة مع واقي شمس داخلي وتهوية ممتازة، تأتي مع زوج قفازات حماية للكف والمفاصل مقاس L/XL.',
        keywords: 'خوذه كفوف اكسسوارات حماية سلامة',
        images: [{ url: '/src/assets/images/cat_accessories_1795186795800.jpg', isCover: true }],
        offset: '-3 days',
      },
    ];

    const tx = db.transaction(() => {
      for (const item of demoListings) {
        insertListing.run(
          item.title,
          item.brand,
          bySlug[item.slug],
          item.governorate,
          item.area,
          item.model_year,
          item.engine_cc,
          item.motor_watts,
          item.condition,
          item.price_iqd,
          item.negotiable,
          item.phone,
          item.description,
          item.keywords,
          JSON.stringify(item.images),
          demoSecret,
          demoSecret,
          item.offset,
          item.offset
        );
      }
    });
    tx();
  } else {
    // Enrich existing demo listings if brand/engine_cc weren't set yet
    db.prepare(`UPDATE listings SET brand = 'هوندا', engine_cc = COALESCE(engine_cc, 600), keywords = CASE WHEN keywords = '' THEN 'Honda CBR600 سبورت ياباني' ELSE keywords END WHERE is_demo = 1 AND title LIKE '%هوندا%' AND brand = ''`).run();
    db.prepare(`UPDATE listings SET brand = 'ياماها', engine_cc = COALESCE(engine_cc, 1000), keywords = CASE WHEN keywords = '' THEN 'Yamaha R1 سبورت ريسنك' ELSE keywords END WHERE is_demo = 1 AND title LIKE '%ياماها%' AND brand = ''`).run();
    db.prepare(`UPDATE listings SET brand = 'فيسبا', engine_cc = COALESCE(engine_cc, 150), keywords = CASE WHEN keywords = '' THEN 'Vespa 150cc سكوتر' ELSE keywords END WHERE is_demo = 1 AND title LIKE '%فيسبا%' AND brand = ''`).run();
    db.prepare(`UPDATE listings SET motor_watts = COALESCE(motor_watts, 1500), keywords = CASE WHEN keywords = '' THEN 'سكوتر كهربائي شحن كهرباء بطارية ليثيوم' ELSE keywords END WHERE is_demo = 1 AND title LIKE '%كهربائية%' AND motor_watts IS NULL`).run();
    db.prepare(`UPDATE listings SET brand = 'سبيشلايزد', keywords = CASE WHEN keywords = '' THEN 'Specialized بايسكل سيكل عجلة' ELSE keywords END WHERE is_demo = 1 AND title LIKE '%سبيشلايزد%' AND brand = ''`).run();
  }

  // Seed managed synonym dictionary if empty
  const synCount = (db.prepare('SELECT COUNT(*) as cnt FROM search_synonyms').get() as { cnt: number }).cnt;
  if (synCount === 0) {
    const cats = db.prepare('SELECT id, slug, name_ar FROM categories').all() as Array<{
      id: number;
      slug: string;
      name_ar: string;
    }>;
    const catBySlug = Object.fromEntries(cats.map((c) => [c.slug, c]));

    const normSimple = (s: string) =>
      s
        .trim()
        .toLowerCase()
        .replace(/[\u064B-\u065F\u0670\u06D6-\u06ED\u0640]/g, '')
        .replace(/[أإآٱ]/g, 'ا')
        .replace(/ى/g, 'ي')
        .replace(/ة/g, 'ه');

    const insertSyn = db.prepare(`
      INSERT INTO search_synonyms (
        term, normalized_term, target_type, canonical_value, category_id, disambiguation_options_json, is_active, notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const seedSynonyms: Array<{
      term: string;
      target_type: 'brand' | 'category' | 'keyword' | 'ambiguous';
      canonical_value: string;
      slug?: string;
      options?: Array<{ label: string; categorySlug?: string; brand?: string; query?: string }>;
      is_active: number;
      notes: string;
    }> = [
      // Unambiguous Brand Equivalents
      { term: 'honda', target_type: 'brand', canonical_value: 'هوندا', is_active: 1, notes: 'مرادف إنجليزي لماركة هوندا' },
      { term: 'هونده', target_type: 'brand', canonical_value: 'هوندا', is_active: 1, notes: 'صيغة كتابة بديلة لهوندا' },
      { term: 'yamaha', target_type: 'brand', canonical_value: 'ياماها', is_active: 1, notes: 'مرادف إنجليزي لماركة ياماها' },
      { term: 'يمها', target_type: 'brand', canonical_value: 'ياماها', is_active: 1, notes: 'صيغة مختصرة لياماها' },
      { term: 'suzuki', target_type: 'brand', canonical_value: 'سوزوكي', is_active: 1, notes: 'مرادف إنجليزي لسوزوكي' },
      { term: 'سزوكي', target_type: 'brand', canonical_value: 'سوزوكي', is_active: 1, notes: 'صيغة كتابة بديلة لسوزوكي' },
      { term: 'kawasaki', target_type: 'brand', canonical_value: 'كاواساكي', is_active: 1, notes: 'مرادف إنجليزي لكاواساكي' },
      { term: 'كوازاكي', target_type: 'brand', canonical_value: 'كاواساكي', is_active: 1, notes: 'صيغة كتابة بديلة لكاواساكي' },
      { term: 'vespa', target_type: 'brand', canonical_value: 'فيسبا', is_active: 1, notes: 'مرادف إنجليزي لسكوتر فيسبا' },
      { term: 'فسبا', target_type: 'brand', canonical_value: 'فيسبا', is_active: 1, notes: 'صيغة كتابة بديلة لفيسبا' },
      { term: 'فيزبا', target_type: 'brand', canonical_value: 'فيسبا', is_active: 1, notes: 'نطق محلي لفيسبا' },
      { term: 'specialized', target_type: 'brand', canonical_value: 'سبيشلايزد', is_active: 1, notes: 'مرادف إنجليزي لدراجات سبيشلايزد' },
      { term: 'bajaj', target_type: 'brand', canonical_value: 'بجاج', is_active: 1, notes: 'مرادف إنجليزي لماركة بجاج' },
      { term: 'باجاج', target_type: 'brand', canonical_value: 'بجاج', is_active: 1, notes: 'صيغة كتابة بديلة لبجاج' },
      { term: 'sym', target_type: 'brand', canonical_value: 'اس واي ام', is_active: 1, notes: 'مرادف إنجليزي لماركة SYM' },
      { term: 'kymco', target_type: 'brand', canonical_value: 'كيمكو', is_active: 1, notes: 'مرادف إنجليزي لماركة كيمكو' },

      // Unambiguous Category / Dialect Equivalents
      { term: 'موتوسيكل', target_type: 'category', canonical_value: 'motorcycles', slug: 'motorcycles', is_active: 1, notes: 'مصطلح مصري/عربي للدراجات النارية' },
      { term: 'موتسيكل', target_type: 'category', canonical_value: 'motorcycles', slug: 'motorcycles', is_active: 1, notes: 'كتابة شائعة لموتوسيكل' },
      { term: 'مكنة', target_type: 'category', canonical_value: 'motorcycles', slug: 'motorcycles', is_active: 1, notes: 'مصطلح مصري للدراجة النارية' },
      { term: 'بايك', target_type: 'category', canonical_value: 'motorcycles', slug: 'motorcycles', is_active: 1, notes: 'مصطلح شائع للدراجات النارية' },
      { term: 'سيكل', target_type: 'category', canonical_value: 'bicycles', slug: 'bicycles', is_active: 1, notes: 'مصطلح خليجي/محلي للدراجة الهوائية' },
      { term: 'بايسكل', target_type: 'category', canonical_value: 'bicycles', slug: 'bicycles', is_active: 1, notes: 'مصطلح عراقي للدراجة الهوائية' },
      { term: 'بسكليت', target_type: 'category', canonical_value: 'bicycles', slug: 'bicycles', is_active: 1, notes: 'مصطلح عربي/مصري للدراجة الهوائية' },
      { term: 'عجلة', target_type: 'category', canonical_value: 'bicycles', slug: 'bicycles', is_active: 1, notes: 'مصطلح مصري للدراجة الهوائية' },
      { term: 'سبير', target_type: 'category', canonical_value: 'spare-parts', slug: 'spare-parts', is_active: 1, notes: 'مصطلح عراقي لقطع الغيار' },
      { term: 'ادوات احتياطية', target_type: 'category', canonical_value: 'spare-parts', slug: 'spare-parts', is_active: 1, notes: 'مرادف لقطع الغيار' },

      // Ambiguous / Context-dependent terms + Pending Admin Binding terms (NOT guessed!)
      {
        term: 'دايوان',
        target_type: 'ambiguous',
        canonical_value: '',
        is_active: 0,
        options: [
          { label: 'ماركة دايون (Dayun)', brand: 'دايون' },
          { label: 'دراجات نارية', categorySlug: 'motorcycles' },
          { label: 'سكوترات', categorySlug: 'scooters' },
        ],
        notes: 'بانتظار التحديد من الإدارة: اختر الماركة أو القسم المقصود دون تخمين.',
      },
      {
        term: 'بطح',
        target_type: 'ambiguous',
        canonical_value: '',
        is_active: 0,
        options: [
          { label: 'دراجات نارية', categorySlug: 'motorcycles' },
          { label: 'سكوترات', categorySlug: 'scooters' },
        ],
        notes: 'بانتظار التحديد من الإدارة: حدد القسم أو الكلمات المقصودة لـ «بطح».',
      },
      {
        term: 'موتر',
        target_type: 'ambiguous',
        canonical_value: '',
        is_active: 1,
        options: [
          { label: 'دراجات نارية', categorySlug: 'motorcycles' },
          { label: 'دراجات كهربائية', categorySlug: 'ebikes' },
          { label: 'سكوترات', categorySlug: 'scooters' },
        ],
        notes: 'مصطلح يختلف معناه حسب السياق، يعرض اقتراحات قصيرة للمستخدم.',
      },
    ];

    const txSyn = db.transaction(() => {
      for (const s of seedSynonyms) {
        const cat = s.slug ? catBySlug[s.slug] : undefined;
        insertSyn.run(
          s.term,
          normSimple(s.term),
          s.target_type,
          s.canonical_value,
          cat?.id ?? null,
          JSON.stringify(s.options || []),
          s.is_active,
          s.notes
        );
      }
    });
    txSyn();
  }
}
