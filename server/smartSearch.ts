import type { ListingSearchData, SearchSynonymRecord } from './repositories/listings.ts';

export type SearchSynonymRow = SearchSynonymRecord;

export interface SmartSearchChip {
  key: string;
  label: string;
  kind:
    | 'category'
    | 'brand'
    | 'governorate'
    | 'condition'
    | 'engine_cc'
    | 'motor_watts'
    | 'price'
    | 'model_year'
    | 'keyword';
  source: 'query' | 'filter';
}

export interface SmartSearchConflict {
  type: 'governorate' | 'category' | 'price';
  message: string;
  pageValue: string;
  queryValue: string;
  suggestedCategoryId?: number | null;
}

export interface SmartSearchClarification {
  term: string;
  message: string;
  options: Array<{
    label: string;
    applyQuery?: string;
    categoryId?: number;
    brand?: string;
  }>;
}

export interface ParsedSearchIntent {
  originalQuery: string;
  normalizedQuery: string;
  governorate: string | null;
  categoryIds: number[];
  categoryLabel: string | null;
  excludePartsByDefault: boolean;
  electricScooterIntent: boolean;
  brand: string | null;
  condition: 'new' | 'used' | null;
  engineCc: number | null;
  motorWatts: number | null;
  modelYear: number | null;
  minPrice: number | null;
  minPriceExclusive: boolean;
  maxPrice: number | null;
  maxPriceExclusive: boolean;
  priceLabel: string | null;
  keywords: string[];
  matchedSynonyms: Array<{
    term: string;
    targetType: string;
    canonicalValue: string;
    categoryId: number | null;
  }>;
  clarifications: SmartSearchClarification[];
}

export interface ListingSearchInput {
  q?: string;
  governorate?: string;
  categoryId?: number | null;
  minPrice?: number | null;
  maxPrice?: number | null;
  sort?: 'newest' | 'price_asc' | 'price_desc';
  hideDemo?: boolean;
  ignoredChips?: string[];
  brandFilter?: string;
  conditionFilter?: 'new' | 'used' | null;
}

export function toAsciiDigits(input: string): string {
  const arabicDigits = '٠١٢٣٤٥٦٧٨٩';
  const persianDigits = '۰۱۲۳۴۵۶۷۸۹';
  let out = String(input || '');
  for (let i = 0; i < 10; i++) {
    out = out.replaceAll(arabicDigits[i], String(i)).replaceAll(persianDigits[i], String(i));
  }
  return out;
}

export function normalizeArabicText(input: string): string {
  let out = toAsciiDigits(String(input || '').trim().toLowerCase());
  // Remove Tashkeel and Tatweel
  out = out.replace(/[\u064B-\u065F\u0670\u06D6-\u06ED\u0640]/g, '');
  // Normalize Arabic letters
  out = out
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي');
  // Separate digits and letters where helpful (except keep cc/w attached normalization handled cleanly)
  out = out.replace(/[^\p{L}\p{N}\s.]/gu, ' ');
  out = out.replace(/\s+/g, ' ').trim();
  return out;
}

// Governorate dictionary with Iraqi colloquial prefixes & spelling variations
const GOVERNORATE_ALIASES: Array<{ canonical: string; aliases: string[] }> = [
  { canonical: 'بغداد', aliases: ['بغداد', 'ببغداد', 'بغدادي', 'العاصمه'] },
  { canonical: 'البصرة', aliases: ['البصره', 'بصره', 'بالبصره', 'ببصره'] },
  { canonical: 'نينوى', aliases: ['نينوي', 'الموصل', 'موصل', 'بالموصل', 'بنينوي'] },
  { canonical: 'أربيل', aliases: ['اربيل', 'باربيل', 'هولير', 'بهولير'] },
  { canonical: 'النجف', aliases: ['النجف', 'نجف', 'بالنجف', 'بنجف'] },
  { canonical: 'كربلاء', aliases: ['كربلاء', 'كربلا', 'كربله', 'بكربلاء', 'بكربلا', 'بكربله'] },
  { canonical: 'بابل', aliases: ['بابل', 'الحله', 'حله', 'ببابل', 'بالحله'] },
  { canonical: 'الأنبار', aliases: ['الانبار', 'انبار', 'بالانبار', 'الرمادي', 'بالرمادي', 'الفلوجه'] },
  { canonical: 'ديالى', aliases: ['ديالي', 'بديالي', 'بعقوبه', 'ببعقوبه'] },
  { canonical: 'ذي قار', aliases: ['ذي قار', 'بذي قار', 'الناصريه', 'ناصريه', 'بالناصريه'] },
  { canonical: 'كركوك', aliases: ['كركوك', 'بكركوك'] },
  { canonical: 'صلاح الدين', aliases: ['صلاح الدين', 'بصلاح الدين', 'تكريت', 'بتكريت', 'سامراء'] },
  { canonical: 'السليمانية', aliases: ['السليمانيه', 'سليمانيه', 'بالسليمانيه', 'بسليمانيه'] },
  { canonical: 'دهوك', aliases: ['دهوك', 'بدهوك'] },
  { canonical: 'واسط', aliases: ['واسط', 'بواسط', 'الكوت', 'كوت', 'بالكوت'] },
  { canonical: 'ميسان', aliases: ['ميسان', 'بميسان', 'العماره', 'عماره', 'بالعماره'] },
  { canonical: 'المثنى', aliases: ['المثني', 'مثني', 'بالمثني', 'السماوه', 'بالسماوه'] },
  { canonical: 'القادسية', aliases: ['القادسيه', 'قادسيه', 'بالقادسيه', 'الديوانيه', 'ديوانيه', 'بالديوانيه'] },
];

const MULTI_WORD_FILLERS = [
  'ادور علي',
  'بدور علي',
  'ابحث عن',
  'اريد اشتري',
  'عايز اشتري',
  'محتاج اشتري',
  'ابغي اشتري',
  'ممكن الاقي',
  'وين الاقي',
  'فين الاقي',
  'لو سمحت',
  'من فضلك',
  'ان امكن',
  'تكون نظيفه',
  'يكون نظيف',
];

const SINGLE_FILLERS = new Set([
  'اريد',
  'محتاج',
  'محتاجه',
  'محتاجين',
  'عايز',
  'عايزه',
  'عاوز',
  'عاوزه',
  'ابغي',
  'ادور',
  'بدور',
  'ابحث',
  'ممكن',
  'فدوه',
  'بس',
  'يعني',
  'تقريبا',
  'حوالي',
  'يكون',
  'تكون',
  'سعرها',
  'سعره',
  'حالتها',
  'حالته',
  'لونها',
  'لونه',
  'لبيع',
  'للبيع',
  'شراء',
  'اشتري',
  'عندي',
  'في',
  'من',
  'علي',
  'الي',
  'عن',
  'مع',
  'او',
  'و',
]);

const CONDITION_NEW_WORDS = new Set([
  'جديد',
  'جديده',
  'جديدات',
  'زيرو',
  'وكاله',
  'بالباكيت',
  'غير مستعمل',
]);

const CONDITION_USED_WORDS = new Set([
  'مستعمل',
  'مستعمله',
  'مستعملات',
  'مستخدم',
  'مستخدمه',
  'قديم',
  'قديمه',
  'باله',
]);

const ARABIC_NUMBER_WORDS: Record<string, number> = {
  نص: 0.5,
  نصف: 0.5,
  ربع: 0.25,
  واحد: 1,
  وحده: 1,
  اثنين: 2,
  اثنان: 2,
  تنين: 2,
  ثلاثه: 3,
  تلاته: 3,
  اربعه: 4,
  خمسه: 5,
  سته: 6,
  سبعه: 7,
  ثمانيه: 8,
  تسعه: 9,
  عشره: 10,
  ميه: 100,
  مئه: 100,
  ميت: 100,
  ميتين: 200,
  مئتين: 200,
  ثلاثميه: 300,
  اربعميه: 400,
  خمسميه: 500,
  ستميه: 600,
  سبعميه: 700,
  ثمانميه: 800,
  تسعميه: 900,
};

function parsePriceAmount(rawText: string): { value: number; display: string } | null {
  const txt = normalizeArabicText(rawText);

  // "مليون ونص" / "2 ونص مليون" / "مليون ونصف"
  const milHalf1 = txt.match(/(?:^|\s)(مليون)\s+و\s*(نص|نصف)(?:\s|$)/);
  if (milHalf1) return { value: 1500000, display: 'مليون ونصف د.ع' };

  const numMilHalf = txt.match(/(\d+(?:\.\d+)?)\s*و\s*(نص|نصف)\s*(مليون|ملايين)/);
  if (numMilHalf) {
    const val = (Number(numMilHalf[1]) + 0.5) * 1_000_000;
    return { value: Math.round(val), display: `${new Intl.NumberFormat('en-US').format(Math.round(val))} د.ع` };
  }

  // "مليونين"
  if (/(?:^|\s)مليونين(?:\s|$)/.test(txt)) {
    return { value: 2_000_000, display: '2,000,000 د.ع' };
  }

  // "نص مليون" / "نصف مليون"
  if (/(?:^|\s)(?:نص|نصف)\s+مليون(?:\s|$)/.test(txt)) {
    return { value: 500_000, display: '500,000 د.ع' };
  }

  // "3 مليون" / "1.5 مليون" / "ملايين"
  const numMillion = txt.match(/(\d+(?:\.\d+)?)\s*(مليون|ملايين)/);
  if (numMillion) {
    const val = Math.round(Number(numMillion[1]) * 1_000_000);
    return { value: val, display: `${new Intl.NumberFormat('en-US').format(val)} د.ع` };
  }

  // Word + مليون e.g. "ثلاثه ملايين" / "خمسه مليون"
  for (const [w, num] of Object.entries(ARABIC_NUMBER_WORDS)) {
    const re = new RegExp(`(?:^|\\s)${w}\\s*(مليون|ملايين)(?:\\s|$)`);
    if (re.test(txt)) {
      const val = Math.round(num * 1_000_000);
      return { value: val, display: `${new Intl.NumberFormat('en-US').format(val)} د.ع` };
    }
  }

  // Standalone "مليون"
  if (/(?:^|\s)مليون(?:\s|$)/.test(txt)) {
    return { value: 1_000_000, display: 'مليون د.ع' };
  }

  // "500 الف" / "500 الف دينار" / "ميت الف"
  const numThousand = txt.match(/(\d+(?:\.\d+)?)\s*(?:الف|الاف)/);
  if (numThousand) {
    const val = Math.round(Number(numThousand[1]) * 1000);
    return { value: val, display: `${new Intl.NumberFormat('en-US').format(val)} د.ع` };
  }

  for (const [w, num] of Object.entries(ARABIC_NUMBER_WORDS)) {
    const re = new RegExp(`(?:^|\\s)${w}\\s*(?:الف|الاف)(?:\\s|$)`);
    if (re.test(txt)) {
      const val = Math.round(num * 1000);
      return { value: val, display: `${new Intl.NumberFormat('en-US').format(val)} د.ع` };
    }
  }

  // Explicit numeric IQD >= 10,000 (e.g. "1000000" or "750000")
  const rawNum = txt.match(/(\d{5,9})/);
  if (rawNum) {
    const val = Number(rawNum[1]);
    if (val >= 10000) {
      return { value: val, display: `${new Intl.NumberFormat('en-US').format(val)} د.ع` };
    }
  }

  return null;
}

export function parseSmartQuery(
  rawQuery: string,
  ignoredChips: string[] = [],
  searchData: ListingSearchData
): ParsedSearchIntent {
  const ignored = new Set(ignoredChips);
  const { categories, synonyms } = searchData;
  const catBySlug = Object.fromEntries(categories.map((c) => [c.slug, c]));
  const catById = Object.fromEntries(categories.map((c) => [c.id, c]));

  let working = normalizeArabicText(rawQuery);
  const originalNormalized = working;

  const intent: ParsedSearchIntent = {
    originalQuery: rawQuery,
    normalizedQuery: originalNormalized,
    governorate: null,
    categoryIds: [],
    categoryLabel: null,
    excludePartsByDefault: false,
    electricScooterIntent: false,
    brand: null,
    condition: null,
    engineCc: null,
    motorWatts: null,
    modelYear: null,
    minPrice: null,
    minPriceExclusive: false,
    maxPrice: null,
    maxPriceExclusive: false,
    priceLabel: null,
    keywords: [],
    matchedSynonyms: [],
    clarifications: [],
  };

  if (!working) return intent;

  // 1. Strip conversational filler multi-word phrases
  for (const phrase of MULTI_WORD_FILLERS) {
    working = working.replaceAll(phrase, ' ');
  }
  working = working.replace(/\s+/g, ' ').trim();

  // 2. Extract Engine CC ONLY when clear CC/engine context is present (NEVER from standalone number like 150)
  const ccRegex1 = /(?:^|\s)(\d{2,4})\s*(?:cc|c\.c\.|سي\s*سي|سيسي)(?=\s|$)/g;
  const ccRegex2 = /(?:^|\s)(?:سعه|محرك|مكينه|حجم)\s*(?:محرك\s*)?(\d{2,4})(?=\s|$)/g;
  const ccMatch = ccRegex1.exec(working) || ccRegex2.exec(working);
  if (ccMatch) {
    const val = Number(ccMatch[1]);
    if (val >= 30 && val <= 2500) {
      if (!ignored.has('engineCc')) {
        intent.engineCc = val;
      }
      working = working.replace(ccMatch[0], ' ');
    }
  }

  // 3. Extract Electric Motor Power (Watts) separately from CC
  const wattRegex = /(?:^|\s)(\d{2,5})\s*(?:w|watt|واط|وات)(?=\s|$)/g;
  const wattMatch = wattRegex.exec(working);
  if (wattMatch) {
    const val = Number(wattMatch[1]);
    if (val >= 100 && val <= 20000) {
      if (!ignored.has('motorWatts')) {
        intent.motorWatts = val;
      }
      working = working.replace(wattMatch[0], ' ');
    }
  }

  // 4. Extract Price Constraints ("بأقل من مليون", "تحت 500 الف", "فوق 2 مليون", "من 1 مليون الى 3 مليون")
  const maxPricePatterns = [
    /(?:ب\s*)?(?:اقل|تحت|دون|اصغر|لا يتجاوز|ما يتجاوز|ما يزيد عن|بحدود|لحد|حد اقصي)\s*(?:من\s*)?((?:\d+(?:\.\d+)?|\S+)\s*(?:و\s*(?:نص|نصف)\s*)?(?:مليونين|مليون|ملايين|الف|الاف)?(?:\s*و\s*(?:نص|نصف))?(?:\s*(?:دينار|د\.ع|عراقي))?)/,
  ];
  for (const re of maxPricePatterns) {
    const m = working.match(re);
    if (m) {
      const parsed = parsePriceAmount(m[1]);
      if (parsed) {
        const isStrictLess = /اقل|تحت|دون|اصغر/.test(m[0]);
        if (!ignored.has('maxPrice')) {
          intent.maxPrice = parsed.value;
          intent.maxPriceExclusive = isStrictLess;
          intent.priceLabel = `${isStrictLess ? 'أقل من' : 'حتى'} ${parsed.display}`;
        }
        working = working.replace(m[0], ' ');
        break;
      }
    }
  }

  const minPricePatterns = [
    /(?:ب\s*)?(?:اكثر|فوق|اعلي|يبدا)\s*(?:من\s*)?((?:\d+(?:\.\d+)?|\S+)\s*(?:و\s*(?:نص|نصف)\s*)?(?:مليونين|مليون|ملايين|الف|الاف)?(?:\s*و\s*(?:نص|نصف))?(?:\s*(?:دينار|د\.ع|عراقي))?)/,
  ];
  for (const re of minPricePatterns) {
    const m = working.match(re);
    if (m) {
      const parsed = parsePriceAmount(m[1]);
      if (parsed) {
        const isStrictMore = /اكثر|فوق|اعلي/.test(m[0]);
        if (!ignored.has('minPrice')) {
          intent.minPrice = parsed.value;
          intent.minPriceExclusive = isStrictMore;
          intent.priceLabel = intent.priceLabel
            ? `${intent.priceLabel} · أكثر من ${parsed.display}`
            : `أكثر من ${parsed.display}`;
        }
        working = working.replace(m[0], ' ');
        break;
      }
    }
  }

  // Standalone "بمليون" or "بسعر 500 الف" -> treat as approximate budget cap (+15%) unless ignored
  if (!intent.maxPrice && !intent.minPrice) {
    const approxMatch = working.match(/(?:بسعر|سعر|ب)\s*(مليونين|مليون|(?:\d+(?:\.\d+)?)\s*(?:مليون|ملايين|الف|الاف))/);
    if (approxMatch) {
      const parsed = parsePriceAmount(approxMatch[1]);
      if (parsed) {
        if (!ignored.has('maxPrice')) {
          intent.maxPrice = Math.round(parsed.value * 1.15);
          intent.maxPriceExclusive = false;
          intent.priceLabel = `بحدود ${parsed.display}`;
        }
        working = working.replace(approxMatch[0], ' ');
      }
    }
  }

  // 5. Extract Governorate (with Iraqi prefixes like بكربلاء / ببغداد / في النجف)
  for (const gov of GOVERNORATE_ALIASES) {
    const sortedAliases = [...gov.aliases].sort((a, b) => b.length - a.length);
    let matched = false;
    for (const alias of sortedAliases) {
      const re = new RegExp(`(?:^|\\s)(?:في\\s+)?${alias}(?:\\s|$)`);
      if (re.test(working)) {
        if (!ignored.has('governorate')) {
          intent.governorate = gov.canonical;
        }
        working = working.replace(re, ' ');
        matched = true;
        break;
      }
    }
    if (matched) break;
  }

  // 6. Extract Model Year (e.g. "موديل 2022" or standalone 2010..2027)
  const yearMatch = working.match(/(?:^|\s)(?:موديل\s+|سنه\s+)?(20[0-2]\d|19[89]\d)(?=\s|$)/);
  if (yearMatch) {
    const yr = Number(yearMatch[1]);
    if (yr >= 1980 && yr <= new Date().getFullYear() + 1) {
      if (!ignored.has('modelYear')) {
        intent.modelYear = yr;
      }
      working = working.replace(yearMatch[0], ' ');
    }
  }

  // 7. Extract Condition (new / used)
  for (const w of CONDITION_USED_WORDS) {
    const re = new RegExp(`(?:^|\\s)${w}(?:\\s|$)`);
    if (re.test(working)) {
      if (!ignored.has('condition')) {
        intent.condition = 'used';
      }
      working = working.replace(re, ' ');
    }
  }
  for (const w of CONDITION_NEW_WORDS) {
    const re = new RegExp(`(?:^|\\s)${w}(?:\\s|$)`);
    if (re.test(working)) {
      if (!ignored.has('condition') && !intent.condition) {
        intent.condition = 'new';
      }
      working = working.replace(re, ' ');
    }
  }

  // 8. Context-aware Vehicle Type Phrases (BEFORE tokenizing single words)
  // "سكوتر كهربائي" / "سكوتر شحن" -> electric scooter intent (matches ebikes OR electric scooters)
  const electricScooterRe = /(?:^|\s)(?:سكوتر\s+(?:كهربايي|كهرباييه|كهربا|شحن)|سكوترات\s+(?:كهرباييه|شحن))(?:\s|$)/;
  if (electricScooterRe.test(working)) {
    if (!ignored.has('category')) {
      intent.electricScooterIntent = true;
      const ebikeCat = catBySlug['ebikes'];
      const scooterCat = catBySlug['scooters'];
      const ids: number[] = [];
      if (ebikeCat) ids.push(ebikeCat.id);
      if (scooterCat) ids.push(scooterCat.id);
      intent.categoryIds = ids;
      intent.categoryLabel = 'سكوترات كهربائية';
    }
    working = working.replace(electricScooterRe, ' ');
  }

  // Specific multi-word category names: دراجة كهربائية / دراجة هوائية / دراجة نارية / قطع غيار / اكسسوارات
  const categoryPhrases: Array<{ re: RegExp; slug: string; label?: string }> = [
    { re: /(?:^|\s)دراج(?:ه|ات)\s+(?:كهرباييه|كهرباء|شحن)(?:\s|$)/, slug: 'ebikes' },
    { re: /(?:^|\s)دراج(?:ه|ات)\s+(?:هواييه|جبليه)(?:\s|$)/, slug: 'bicycles' },
    { re: /(?:^|\s)دراج(?:ه|ات)\s+(?:ناريه|سباق|سبورت|رياضيه)(?:\s|$)/, slug: 'motorcycles' },
    { re: /(?:^|\s)(?:قطع\s+غيار|ادوات\s+احتياطيه)(?:\s|$)/, slug: 'spare-parts' },
    { re: /(?:^|\s)(?:اكسسوارات(?:\s+ومستلزمات)?|مستلزمات)(?:\s|$)/, slug: 'accessories' },
  ];

  for (const cp of categoryPhrases) {
    if (cp.re.test(working)) {
      const cat = catBySlug[cp.slug];
      if (cat && !ignored.has('category')) {
        intent.categoryIds = [cat.id];
        intent.categoryLabel = cat.name_ar;
      }
      working = working.replace(cp.re, ' ');
    }
  }

  // 9. Match remaining words against managed search_synonyms & context words
  const tokens = working
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0 && !SINGLE_FILLERS.has(t));

  const residualTokens: string[] = [];

  for (const tok of tokens) {
    // Check managed synonyms first (exact normalized match)
    const synMatches = synonyms.filter((s) => s.normalized_term === tok);
    const activeSyn = synMatches.find((s) => s.is_active === 1 && s.target_type !== 'ambiguous');
    const ambiguousOrUnassigned = synMatches.find(
      (s) => s.target_type === 'ambiguous' || s.is_active === 0
    );

    if (activeSyn) {
      if (activeSyn.target_type === 'brand' && activeSyn.canonical_value) {
        if (!ignored.has('brand')) {
          intent.brand = activeSyn.canonical_value;
        }
        intent.matchedSynonyms.push({
          term: tok,
          targetType: 'brand',
          canonicalValue: activeSyn.canonical_value,
          categoryId: null,
        });
        continue;
      }
      if (activeSyn.target_type === 'category' && activeSyn.category_id) {
        if (!ignored.has('category') && intent.categoryIds.length === 0) {
          intent.categoryIds = [activeSyn.category_id];
          intent.categoryLabel = activeSyn.category_name || activeSyn.canonical_value;
        }
        intent.matchedSynonyms.push({
          term: tok,
          targetType: 'category',
          canonicalValue: activeSyn.category_name || activeSyn.canonical_value,
          categoryId: activeSyn.category_id,
        });
        continue;
      }
      if (activeSyn.target_type === 'keyword' && activeSyn.canonical_value) {
        intent.matchedSynonyms.push({
          term: tok,
          targetType: 'keyword',
          canonicalValue: activeSyn.canonical_value,
          categoryId: null,
        });
        residualTokens.push(activeSyn.canonical_value);
        continue;
      }
    }

    if (ambiguousOrUnassigned) {
      let opts: Array<{ label: string; categorySlug?: string; brand?: string; query?: string }> = [];
      try {
        const configuredOptions = ambiguousOrUnassigned.disambiguation_options_json;
        opts = Array.isArray(configuredOptions)
          ? configuredOptions
          : JSON.parse(typeof configuredOptions === 'string' ? configuredOptions || '[]' : '[]');
      } catch {
        opts = [];
      }

      const mappedOptions = opts.map((o) => ({
        label: o.label,
        categoryId: o.categorySlug ? catBySlug[o.categorySlug]?.id : undefined,
        brand: o.brand,
        applyQuery: o.query || o.brand || (o.categorySlug ? catBySlug[o.categorySlug]?.name_ar : undefined),
      }));

      intent.clarifications.push({
        term: ambiguousOrUnassigned.term,
        message:
          ambiguousOrUnassigned.is_active === 0
            ? `مصطلح «${ambiguousOrUnassigned.term}» غير مربوط بنوع محدد بعد — يمكنك اختيار ما تقصده:`
            : `كلمة «${ambiguousOrUnassigned.term}» قد تعني أكثر من نوع، اختر المقصود:`,
        options: mappedOptions,
      });

      // Keep token as literal search term so posts containing it directly still match, WITHOUT guessing a category!
      residualTokens.push(tok);
      continue;
    }

    // Contextual standalone "سكوتر" / "سكوترات" (when NOT paired with كهربائي)
    if (tok === 'سكوتر' || tok === 'سكوترات') {
      const cat = catBySlug['scooters'];
      if (cat && !ignored.has('category') && intent.categoryIds.length === 0) {
        intent.categoryIds = [cat.id];
        intent.categoryLabel = cat.name_ar;
      }
      continue;
    }

    // Contextual "كهربائي" / "كهربائيه" / "كهرباء" alone
    if (tok === 'كهربايي' || tok === 'كهرباييه' || tok === 'كهرباء' || tok === 'شحن') {
      const cat = catBySlug['ebikes'];
      if (cat && !ignored.has('category') && intent.categoryIds.length === 0) {
        intent.categoryIds = [cat.id];
        intent.categoryLabel = cat.name_ar;
      } else {
        residualTokens.push(tok);
      }
      continue;
    }

    // Contextual "هوائيه" / "جبليه"
    if (tok === 'هواييه' || tok === 'جبليه') {
      const cat = catBySlug['bicycles'];
      if (cat && !ignored.has('category') && intent.categoryIds.length === 0) {
        intent.categoryIds = [cat.id];
        intent.categoryLabel = cat.name_ar;
      } else {
        residualTokens.push(tok);
      }
      continue;
    }

    // Contextual "ناريه"
    if (tok === 'ناريه') {
      const cat = catBySlug['motorcycles'];
      if (cat && !ignored.has('category') && intent.categoryIds.length === 0) {
        intent.categoryIds = [cat.id];
        intent.categoryLabel = cat.name_ar;
      }
      continue;
    }

    // Contextual "دراجة" / "دراجات"
    if (tok === 'دراجه' || tok === 'دراجات') {
      if (!ignored.has('category') && intent.categoryIds.length === 0) {
        if (intent.engineCc) {
          // e.g. "اريد دراجة 150cc" => motorcycles or scooters (engine bikes)
          const moto = catBySlug['motorcycles'];
          const scoot = catBySlug['scooters'];
          intent.categoryIds = [moto?.id, scoot?.id].filter((x): x is number => Boolean(x));
          intent.categoryLabel = 'دراجات بمحرك';
        } else {
          // "دراجة" alone => vehicles (not spare parts/accessories) AND show quick clarification options
          intent.excludePartsByDefault = true;
          const vehicleCats = categories.filter((c) => !c.is_parts_or_accessories);
          if (vehicleCats.length > 0 && intent.clarifications.length === 0) {
            intent.clarifications.push({
              term: 'دراجة',
              message: 'حدّد نوع الدراجة لنتائج أدق:',
              options: vehicleCats.map((c) => ({
                label: c.name_ar,
                categoryId: c.id,
              })),
            });
          }
        }
      }
      continue;
    }

    // Check direct category name partial/exact match if single token matches a category keyword cleanly
    const matchedDirectCat = categories.find((c) => normalizeArabicText(c.name_ar) === tok);
    if (matchedDirectCat && !ignored.has('category') && intent.categoryIds.length === 0) {
      intent.categoryIds = [matchedDirectCat.id];
      intent.categoryLabel = matchedDirectCat.name_ar;
      continue;
    }

    residualTokens.push(tok);
  }

  // Re-evaluate if engineCc exists without "دراجة" (e.g., "150cc" alone)
  if (intent.engineCc && intent.categoryIds.length === 0 && !ignored.has('category')) {
    intent.excludePartsByDefault = true;
  }

  // Strip residual brand prefix if exact brand exists in listings
  if (!intent.brand && !ignored.has('brand') && residualTokens.length > 0) {
    const nextResidual: string[] = [];
    for (const t of residualTokens) {
      const exactBrand = searchData.brands.find((b) => normalizeArabicText(b.brand) === t);
      if (exactBrand && !intent.brand) {
        intent.brand = exactBrand.brand;
      } else {
        nextResidual.push(t);
      }
    }
    intent.keywords = nextResidual;
  } else {
    intent.keywords = residualTokens;
  }

  // Ensure categoryLabel populated if categoryIds came from id lookup
  if (intent.categoryIds.length === 1 && !intent.categoryLabel) {
    intent.categoryLabel = catById[intent.categoryIds[0]]?.name_ar || null;
  }

  return intent;
}

// Fast Damerau-Levenshtein edit distance for minor Arabic/English spelling mistakes
export function editDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (Math.abs(m - n) > 3) return 99;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost
      );
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        dp[i][j] = Math.min(dp[i][j], dp[i - 2][j - 2] + 1);
      }
    }
  }
  return dp[m][n];
}

function isNumericOnly(token: string): boolean {
  return /^\d+(?:\.\d+)?$/.test(token);
}

interface MatchEvaluation {
  matched: boolean;
  tier: 1 | 2 | 3; // 1 = exact, 2 = approved synonym, 3 = fuzzy typo
  score: number;
}

function evaluateTextTokensAgainstRow(
  tokens: string[],
  row: any,
  synonyms: SearchSynonymRow[]
): MatchEvaluation {
  if (tokens.length === 0) {
    return { matched: true, tier: 1, score: 100 };
  }

  const titleNorm = normalizeArabicText(row.title || '');
  const brandNorm = normalizeArabicText(row.brand || '');
  const catNorm = normalizeArabicText(row.category_name || '');
  const keywordsNorm = normalizeArabicText(row.keywords || '');
  const descNorm = normalizeArabicText(row.description || '');
  const areaNorm = normalizeArabicText(row.area || '');
  const govNorm = normalizeArabicText(row.governorate || '');
  const modelStr = row.model_year ? String(row.model_year) : '';
  const ccStr = row.engine_cc ? `${row.engine_cc}cc ${row.engine_cc}` : '';
  const wattStr = row.motor_watts ? `${row.motor_watts}w ${row.motor_watts}` : '';

  const combined = `${titleNorm} ${brandNorm} ${catNorm} ${keywordsNorm} ${descNorm} ${areaNorm} ${govNorm} ${modelStr} ${ccStr} ${wattStr}`.trim();
  const combinedWords = combined.split(/\s+/).filter((w) => w.length >= 2);

  let worstTier: 1 | 2 | 3 = 1;
  let totalScore = 0;

  for (const tok of tokens) {
    // 1. Direct exact / partial match (start, middle, or end of words)
    if (titleNorm.includes(tok) || brandNorm.includes(tok)) {
      const isPrefix = titleNorm.split(/\s+/).some((w) => w.startsWith(tok)) || brandNorm.startsWith(tok);
      totalScore += isPrefix ? 60 : 45;
      continue;
    }
    if (keywordsNorm.includes(tok) || catNorm.includes(tok) || areaNorm.includes(tok)) {
      totalScore += 35;
      continue;
    }
    if (descNorm.includes(tok) || modelStr === tok || ccStr.includes(tok)) {
      totalScore += 25;
      continue;
    }

    // 2. Approved Synonym expansion match (even for partial brand synonyms)
    const activeSynonymCanonical = synonyms
      .filter(
        (s) =>
          s.is_active === 1 &&
          s.target_type !== 'ambiguous' &&
          (s.normalized_term === tok || s.normalized_term.includes(tok))
      )
      .map((s) => normalizeArabicText(s.canonical_value))
      .filter(Boolean);

    let matchedBySyn = false;
    for (const canonical of activeSynonymCanonical) {
      if (combined.includes(canonical)) {
        matchedBySyn = true;
        worstTier = Math.max(worstTier, 2) as 1 | 2 | 3;
        totalScore += 30;
        break;
      }
    }
    if (matchedBySyn) continue;

    // 3. Fuzzy typo tolerance ONLY for non-numeric alphabetic tokens of length >= 3
    if (!isNumericOnly(tok) && tok.length >= 3) {
      const maxAllowedDist = tok.length <= 5 ? 1 : 2;
      let bestDist = 99;
      for (const word of combinedWords) {
        if (isNumericOnly(word) || word.length < 3) continue;
        const d = editDistance(tok, word);
        if (d < bestDist) bestDist = d;
        if (bestDist === 1) break;
      }
      if (bestDist <= maxAllowedDist) {
        worstTier = Math.max(worstTier, 3) as 1 | 2 | 3;
        totalScore += bestDist === 1 ? 15 : 8;
        continue;
      }
    }

    // Token failed to match
    return { matched: false, tier: 3, score: 0 };
  }

  return { matched: true, tier: worstTier, score: totalScore };
}

function rowMatchesEngineCc(row: any, engineCc: number): boolean {
  if (row.engine_cc && Number(row.engine_cc) === engineCc) return true;
  const hay = normalizeArabicText(`${row.title || ''} ${row.description || ''} ${row.keywords || ''}`);
  const ccPattern = new RegExp(`(?:^|\\s)${engineCc}\\s*(?:cc|سي\\s*سي|سيسي)(?=\\s|$)`);
  return ccPattern.test(hay);
}

function rowMatchesElectricScooter(row: any): boolean {
  if (row.category_slug === 'ebikes') return true;
  if (row.category_slug === 'scooters') {
    const hay = normalizeArabicText(`${row.title || ''} ${row.description || ''} ${row.keywords || ''}`);
    return /كهرباي|كهربا|شحن|بطاريه|ليثيوم|واط/.test(hay) || Boolean(row.motor_watts);
  }
  return false;
}

export function runSmartSearch(
  input: ListingSearchInput,
  formatRow: (row: any) => any,
  searchData: ListingSearchData
) {
  const q = String(input.q || '').trim();
  const hasTextQuery = q.length > 0;
  const { categories, synonyms } = searchData;
  const catById = Object.fromEntries(categories.map((c) => [c.id, c]));

  const parsed = hasTextQuery ? parseSmartQuery(q, input.ignoredChips || [], searchData) : null;

  // Detect conflicts between explicit page filters and NLP-extracted query intents
  const conflicts: SmartSearchConflict[] = [];
  const pageGov =
    input.governorate && input.governorate !== 'جميع المحافظات' ? input.governorate.trim() : null;
  const pageCatId = input.categoryId && !Number.isNaN(input.categoryId) ? Number(input.categoryId) : null;
  const pageMinPrice = input.minPrice && !Number.isNaN(input.minPrice) && input.minPrice > 0 ? Number(input.minPrice) : null;
  const pageMaxPrice = input.maxPrice && !Number.isNaN(input.maxPrice) && input.maxPrice > 0 ? Number(input.maxPrice) : null;

  if (parsed?.governorate && pageGov && parsed.governorate !== pageGov) {
    conflicts.push({
      type: 'governorate',
      message: `تعارض في المحافظة: فلتر الصفحة محدد على «${pageGov}» بينما البحث يطلب «${parsed.governorate}»`,
      pageValue: pageGov,
      queryValue: parsed.governorate,
    });
  }

  if (parsed && parsed.categoryIds.length > 0 && pageCatId && !parsed.categoryIds.includes(pageCatId)) {
    const pageCatName = catById[pageCatId]?.name_ar || 'القسم المحدد';
    conflicts.push({
      type: 'category',
      message: `تعارض في القسم: الصفحة تعرض «${pageCatName}» بينما البحث يطلب «${parsed.categoryLabel || 'قسم آخر'}»`,
      pageValue: pageCatName,
      queryValue: parsed.categoryLabel || '',
      suggestedCategoryId: parsed.categoryIds[0] ?? null,
    });
  }

  if (parsed?.minPrice && pageMaxPrice && parsed.minPrice > pageMaxPrice) {
    conflicts.push({
      type: 'price',
      message: `تعارض في السعر: الحد الأعلى في الفلتر أقل من السعر المطلوب في البحث`,
      pageValue: String(pageMaxPrice),
      queryValue: String(parsed.minPrice),
    });
  }
  if (parsed?.maxPrice && pageMinPrice && parsed.maxPrice < pageMinPrice) {
    conflicts.push({
      type: 'price',
      message: `تعارض في السعر: الحد الأدنى في الفلتر أعلى من السقف المطلوب في البحث`,
      pageValue: String(pageMinPrice),
      queryValue: String(parsed.maxPrice),
    });
  }

  // Build chips representing all active understood conditions
  const chips: SmartSearchChip[] = [];
  if (parsed) {
    if (parsed.categoryLabel) {
      chips.push({ key: 'category', label: parsed.categoryLabel, kind: 'category', source: 'query' });
    }
    if (parsed.brand) {
      chips.push({ key: 'brand', label: `الماركة: ${parsed.brand}`, kind: 'brand', source: 'query' });
    }
    if (parsed.governorate) {
      chips.push({ key: 'governorate', label: parsed.governorate, kind: 'governorate', source: 'query' });
    }
    if (parsed.condition) {
      chips.push({
        key: 'condition',
        label: parsed.condition === 'new' ? 'جديدة' : 'مستعملة',
        kind: 'condition',
        source: 'query',
      });
    }
    if (parsed.engineCc) {
      chips.push({ key: 'engineCc', label: `${parsed.engineCc} سي سي`, kind: 'engine_cc', source: 'query' });
    }
    if (parsed.motorWatts) {
      chips.push({ key: 'motorWatts', label: `${parsed.motorWatts} واط`, kind: 'motor_watts', source: 'query' });
    }
    if (parsed.modelYear) {
      chips.push({ key: 'modelYear', label: `موديل ${parsed.modelYear}`, kind: 'model_year', source: 'query' });
    }
    if (parsed.maxPrice) {
      chips.push({
        key: 'maxPrice',
        label: parsed.priceLabel || `أقل من ${new Intl.NumberFormat('en-US').format(parsed.maxPrice)} د.ع`,
        kind: 'price',
        source: 'query',
      });
    }
    if (parsed.minPrice) {
      chips.push({
        key: 'minPrice',
        label: `أكثر من ${new Intl.NumberFormat('en-US').format(parsed.minPrice)} د.ع`,
        kind: 'price',
        source: 'query',
      });
    }
  }

  const allowedStatuses = hasTextQuery ? ['approved'] : ['approved', 'sold'];
  const allRows = searchData.listings.filter((row) => allowedStatuses.includes(row.status));

  // Constraint checker with optional relaxation flags for Near Results
  const evaluateRow = (
    row: any,
    relax: {
      ignoreGov?: boolean;
      ignoreCondition?: boolean;
      ignorePrice?: boolean;
      ignoreCc?: boolean;
      ignoreCategory?: boolean;
    } = {}
  ): { ok: boolean; tier: 1 | 2 | 3; score: number } => {
    // Page filters ALWAYS apply (and combine with query conditions without silent ignoring)
    if (!relax.ignoreGov && pageGov && row.governorate !== pageGov) return { ok: false, tier: 3, score: 0 };
    if (!relax.ignoreCategory && pageCatId && row.category_id !== pageCatId) return { ok: false, tier: 3, score: 0 };
    if (!relax.ignorePrice && pageMinPrice && row.price_iqd < pageMinPrice) return { ok: false, tier: 3, score: 0 };
    if (!relax.ignorePrice && pageMaxPrice && row.price_iqd > pageMaxPrice) return { ok: false, tier: 3, score: 0 };
    if (input.conditionFilter && !relax.ignoreCondition && row.condition !== input.conditionFilter) {
      return { ok: false, tier: 3, score: 0 };
    }
    if (input.brandFilter && normalizeArabicText(row.brand) !== normalizeArabicText(input.brandFilter)) {
      return { ok: false, tier: 3, score: 0 };
    }

    if (!parsed) {
      return { ok: true, tier: 1, score: 100 };
    }

    if (!relax.ignoreGov && parsed.governorate && row.governorate !== parsed.governorate) {
      return { ok: false, tier: 3, score: 0 };
    }

    if (!relax.ignoreCondition && parsed.condition && row.condition !== parsed.condition) {
      return { ok: false, tier: 3, score: 0 };
    }

    if (!relax.ignorePrice) {
      if (parsed.maxPrice !== null) {
        if (parsed.maxPriceExclusive ? row.price_iqd >= parsed.maxPrice : row.price_iqd > parsed.maxPrice) {
          return { ok: false, tier: 3, score: 0 };
        }
      }
      if (parsed.minPrice !== null) {
        if (parsed.minPriceExclusive ? row.price_iqd <= parsed.minPrice : row.price_iqd < parsed.minPrice) {
          return { ok: false, tier: 3, score: 0 };
        }
      }
    }

    if (!relax.ignoreCc && parsed.engineCc !== null && !rowMatchesEngineCc(row, parsed.engineCc)) {
      return { ok: false, tier: 3, score: 0 };
    }

    if (parsed.motorWatts !== null) {
      const hay = normalizeArabicText(`${row.title || ''} ${row.description || ''}`);
      if (row.motor_watts !== parsed.motorWatts && !hay.includes(String(parsed.motorWatts))) {
        return { ok: false, tier: 3, score: 0 };
      }
    }

    if (parsed.modelYear !== null && row.model_year !== parsed.modelYear) {
      return { ok: false, tier: 3, score: 0 };
    }

    if (!relax.ignoreCategory) {
      if (parsed.electricScooterIntent) {
        if (!rowMatchesElectricScooter(row)) return { ok: false, tier: 3, score: 0 };
      } else if (parsed.categoryIds.length > 0) {
        if (!parsed.categoryIds.includes(row.category_id)) {
          return { ok: false, tier: 3, score: 0 };
        }
      } else if (parsed.excludePartsByDefault && row.is_parts_or_accessories) {
        return { ok: false, tier: 3, score: 0 };
      }
    }

    // Brand constraint from recognized brand/synonym
    let brandBoost = 0;
    let brandTier: 1 | 2 | 3 = 1;
    if (parsed.brand) {
      const bNorm = normalizeArabicText(parsed.brand);
      const rowBrandNorm = normalizeArabicText(row.brand || '');
      const rowTitleNorm = normalizeArabicText(row.title || '');
      const rowDescNorm = normalizeArabicText(row.description || '');
      const rowKeyNorm = normalizeArabicText(row.keywords || '');

      if (rowBrandNorm === bNorm || rowTitleNorm.includes(bNorm)) {
        brandBoost = 70;
      } else if (rowKeyNorm.includes(bNorm) || rowDescNorm.includes(bNorm)) {
        brandBoost = 40;
      } else {
        return { ok: false, tier: 3, score: 0 };
      }
      if (parsed.matchedSynonyms.some((s) => s.targetType === 'brand')) {
        brandTier = 2;
      }
    }

    // Residual keyword matching (exact -> synonym -> fuzzy)
    const textEval = evaluateTextTokensAgainstRow(parsed.keywords, row, synonyms);
    if (!textEval.matched) return { ok: false, tier: 3, score: 0 };

    // Extra relevance boost if electric scooter literal phrase appears
    let contextBoost = 0;
    if (parsed.electricScooterIntent) {
      const titleDesc = normalizeArabicText(`${row.title} ${row.keywords}`);
      if (titleDesc.includes('سكوتر كهربايي')) contextBoost += 40;
    }
    if (parsed.matchedSynonyms.some((s) => s.targetType === 'category')) {
      brandTier = Math.max(brandTier, 2) as 1 | 2 | 3;
    }

    const finalTier = Math.max(brandTier, textEval.tier) as 1 | 2 | 3;
    return {
      ok: true,
      tier: finalTier,
      score: textEval.score + brandBoost + contextBoost,
    };
  };

  // Evaluate strict matches
  const matchedEntries: Array<{ row: any; tier: 1 | 2 | 3; score: number }> = [];
  for (const row of allRows) {
    const res = evaluateRow(row);
    if (res.ok) {
      matchedEntries.push({ row, tier: res.tier, score: res.score });
    }
  }

  // Sort results: Tier (exact -> synonym -> fuzzy), then score or requested sort
  matchedEntries.sort((a, b) => {
    if (hasTextQuery && a.tier !== b.tier) {
      return a.tier - b.tier;
    }
    if (input.sort === 'price_asc') {
      return a.row.price_iqd - b.row.price_iqd;
    }
    if (input.sort === 'price_desc') {
      return b.row.price_iqd - a.row.price_iqd;
    }
    if (hasTextQuery && a.score !== b.score) {
      return b.score - a.score;
    }
    return new Date(b.row.created_at).getTime() - new Date(a.row.created_at).getTime() || b.row.id - a.row.id;
  });

  const items = matchedEntries.map((m) => ({
    ...formatRow(m.row),
    matchTier: m.tier === 1 ? 'exact' : m.tier === 2 ? 'synonym' : 'fuzzy',
  }));

  // Compute transparent "نتائج قريبة" when strict matches = 0 and a search or conflict exists
  const nearResults: Array<any & { differenceNote: string }> = [];
  if (items.length === 0 && (hasTextQuery || pageGov || pageCatId || pageMinPrice || pageMaxPrice)) {
    const matchedIds = new Set<number>();
    const relaxations: Array<{
      flags: Parameters<typeof evaluateRow>[1];
      describe: (row: any) => string[];
    }> = [
      {
        flags: { ignoreGov: true },
        describe: (row) => {
          const targetGov = parsed?.governorate || pageGov;
          return targetGov && row.governorate !== targetGov
            ? [`موجودة في ${row.governorate} بدلاً من ${targetGov}`]
            : [];
        },
      },
      {
        flags: { ignoreCondition: true },
        describe: (row) => {
          const targetCond = parsed?.condition || input.conditionFilter;
          if (!targetCond || row.condition === targetCond) return [];
          return [
            `الحالة ${row.condition === 'new' ? 'جديدة' : 'مستعملة'} بدلاً من ${
              targetCond === 'new' ? 'جديدة' : 'مستعملة'
            }`,
          ];
        },
      },
      {
        flags: { ignorePrice: true },
        describe: (row) => {
          const maxCap = parsed?.maxPrice ?? pageMaxPrice;
          const minCap = parsed?.minPrice ?? pageMinPrice;
          const notes: string[] = [];
          if (maxCap && row.price_iqd >= maxCap) {
            notes.push(`السعر ${new Intl.NumberFormat('en-US').format(row.price_iqd)} د.ع أعلى من السقف المطلوب`);
          }
          if (minCap && row.price_iqd <= minCap) {
            notes.push(`السعر ${new Intl.NumberFormat('en-US').format(row.price_iqd)} د.ع أقل من الحد المطلوب`);
          }
          return notes;
        },
      },
      {
        flags: { ignoreCc: true },
        describe: (row) => {
          if (!parsed?.engineCc) return [];
          return row.engine_cc
            ? [`سعة المحرك ${row.engine_cc} سي سي بدلاً من ${parsed.engineCc} سي سي`]
            : [`سعة المحرك غير مطابقة لـ ${parsed.engineCc} سي سي`];
        },
      },
      {
        flags: { ignoreGov: true, ignoreCondition: true },
        describe: (row) => {
          const diffs: string[] = [];
          const targetGov = parsed?.governorate || pageGov;
          const targetCond = parsed?.condition || input.conditionFilter;
          if (targetGov && row.governorate !== targetGov) diffs.push(`في ${row.governorate}`);
          if (targetCond && row.condition !== targetCond) {
            diffs.push(`الحالة: ${row.condition === 'new' ? 'جديدة' : 'مستعملة'}`);
          }
          return diffs;
        },
      },
    ];

    for (const rel of relaxations) {
      if (nearResults.length >= 6) break;
      for (const row of allRows) {
        if (matchedIds.has(row.id)) continue;
        const evalRes = evaluateRow(row, rel.flags);
        if (evalRes.ok) {
          const diffs = rel.describe(row);
          if (diffs.length > 0) {
            matchedIds.add(row.id);
            nearResults.push({
              ...formatRow(row),
              differenceNote: diffs.join(' · '),
            });
            if (nearResults.length >= 6) break;
          }
        }
      }
    }
  }

  return {
    items,
    nearResults,
    chips,
    conflicts,
    clarifications: parsed?.clarifications || [],
    parsedIntent: parsed
      ? {
          governorate: parsed.governorate,
          categoryIds: parsed.categoryIds,
          categoryLabel: parsed.categoryLabel,
          brand: parsed.brand,
          condition: parsed.condition,
          engineCc: parsed.engineCc,
          motorWatts: parsed.motorWatts,
          modelYear: parsed.modelYear,
          minPrice: parsed.minPrice,
          maxPrice: parsed.maxPrice,
          keywords: parsed.keywords,
        }
      : null,
  };
}

export function getSmartSuggestions(rawQuery: string, searchData: ListingSearchData) {
  const { categories, synonyms } = searchData;
  const qNorm = normalizeArabicText(rawQuery);
  const parsed = qNorm ? parseSmartQuery(rawQuery, [], searchData) : null;

  if (!qNorm) {
    return {
      categories: categories.slice(0, 6),
      brands: [] as string[],
      listings: [] as any[],
      clarifications: [] as SmartSearchClarification[],
    };
  }

  const tokens = qNorm.split(/\s+/).filter((t) => t.length > 0 && !SINGLE_FILLERS.has(t));
  const lastToken = tokens[tokens.length - 1] || qNorm;

  // 1. Matching categories (direct name or active synonym)
  const matchingCats = categories.filter((c) => {
    const cNorm = normalizeArabicText(c.name_ar);
    if (cNorm.includes(lastToken) || cNorm.includes(qNorm)) return true;
    if (parsed?.categoryIds.includes(c.id)) return true;
    return synonyms.some(
      (s) =>
        s.is_active === 1 &&
        s.target_type === 'category' &&
        s.category_id === c.id &&
        (s.normalized_term.includes(lastToken) || lastToken.includes(s.normalized_term))
    );
  });

  // 2. Matching real brands from approved listings + active brand synonyms
  const brandSet = new Set<string>();
  for (const row of searchData.brands) {
    const bn = normalizeArabicText(row.brand);
    if (bn.includes(lastToken) || editDistance(lastToken, bn) <= 1) {
      brandSet.add(row.brand);
    }
  }
  for (const s of synonyms) {
    if (s.is_active === 1 && s.target_type === 'brand' && s.canonical_value) {
      if (
        s.normalized_term.includes(lastToken) ||
        normalizeArabicText(s.canonical_value).includes(lastToken)
      ) {
        brandSet.add(s.canonical_value);
      }
    }
  }

  // 3. Matching approved available listings (up to 5)
  const approvedRows = searchData.listings.filter((row) => row.status === 'approved');

  const matchedListings: Array<{
    id: number;
    title: string;
    brand: string;
    category_name: string;
    governorate: string;
    price_iqd: number;
    engine_cc: number | null;
    image_url: string | null;
  }> = [];

  for (const r of approvedRows) {
    const ev = evaluateTextTokensAgainstRow(
      parsed ? parsed.keywords : tokens,
      r,
      synonyms
    );
    const matchesParsedCat = parsed?.electricScooterIntent
      ? rowMatchesElectricScooter(r)
      : !parsed?.categoryIds.length ||
        parsed.categoryIds.some((cid) =>
          categories.find((c) => c.id === cid)?.name_ar === r.category_name
        );
    const matchesParsedGov = !parsed?.governorate || r.governorate === parsed.governorate;
    const matchesParsedCc = !parsed?.engineCc || rowMatchesEngineCc(r, parsed.engineCc);
    const matchesParsedCond = !parsed?.condition || r.condition === parsed.condition;
    const matchesParsedBrand =
      !parsed?.brand ||
      normalizeArabicText(r.brand || '') === normalizeArabicText(parsed.brand);

    if (
      ev.matched &&
      matchesParsedCat &&
      matchesParsedGov &&
      matchesParsedCc &&
      matchesParsedCond &&
      matchesParsedBrand
    ) {
      let imgs: Array<{ url: string; isCover?: boolean }> = [];
      try {
        imgs = Array.isArray(r.images_json)
          ? r.images_json
          : JSON.parse(typeof r.images_json === 'string' ? r.images_json || '[]' : '[]');
      } catch {
        imgs = [];
      }
      matchedListings.push({
        id: r.id,
        title: r.title,
        brand: r.brand || '',
        category_name: r.category_name || '',
        governorate: r.governorate,
        price_iqd: r.price_iqd,
        engine_cc: r.engine_cc ?? null,
        image_url: imgs.find((i) => i.isCover)?.url || imgs[0]?.url || null,
      });
      if (matchedListings.length >= 5) break;
    }
  }

  return {
    categories: matchingCats.slice(0, 4),
    brands: Array.from(brandSet).slice(0, 5),
    listings: matchedListings,
    clarifications: parsed?.clarifications || [],
  };
}
