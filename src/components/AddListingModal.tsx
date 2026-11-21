import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  Bike,
  Calendar,
  Check,
  CheckCircle2,
  Copy,
  FileText,
  Film,
  ImagePlus,
  Layers,
  Loader2,
  MapPin,
  Navigation,
  Phone,
  Star,
  Tag,
  Trash2,
  X,
} from 'lucide-react';
import {
  Category,
  IRAQI_GOVERNORATES,
  isValidIraqiPhone,
  Listing,
  ListingImage,
  normalizeIraqiPhone,
} from '../types';
import {
  AddListingDraft,
  ApiError,
  checkServerReachable,
  clearAddDraft,
  createListingApi,
  loadAddDraft,
  saveAddDraft,
  saveOwnership,
  uploadImagesApi,
  uploadVideoApi,
} from '../utils/api';

const EMPTY_DRAFT: AddListingDraft = {
  governorate: '',
  title: '',
  brand: '',
  category_id: '',
  model_year: '',
  engine_cc: '',
  motor_watts: '',
  condition: 'used',
  price_iqd: '',
  negotiable: false,
  phone: '',
  area: '',
  description: '',
  keywords: '',
  images: [],
  video_url: null,
};

export function AddListingModal({
  isOpen,
  isOnline = true,
  categories,
  defaultGovernorate,
  onClose,
  onCreatedPreview,
}: {
  isOpen: boolean;
  isOnline?: boolean;
  categories: Category[];
  defaultGovernorate: string;
  onClose: () => void;
  onCreatedPreview: (listing: Listing) => void;
}) {
  const [form, setForm] = useState<AddListingDraft>(() => {
    const saved = loadAddDraft();
    if (saved) return saved;
    return {
      ...EMPTY_DRAFT,
      governorate:
        defaultGovernorate && defaultGovernorate !== 'جميع المحافظات'
          ? defaultGovernorate
          : '',
    };
  });

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isUploadingImages, setIsUploadingImages] = useState(false);
  const [isUploadingVideo, setIsUploadingVideo] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [createdResult, setCreatedResult] = useState<{
    listing: Listing;
    ownerCode: string;
  } | null>(null);
  const [copiedCode, setCopiedCode] = useState(false);

  // Mobile drag-to-dismiss state on handle
  const [sheetDragY, setSheetDragY] = useState(0);
  const dragStartYRef = useRef<number | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);

  const selectedCategory = useMemo(
    () => categories.find((c) => String(c.id) === String(form.category_id)),
    [categories, form.category_id]
  );

  const isPartsOrAccessories = Boolean(selectedCategory?.is_parts_or_accessories);
  const isElectricCategory = selectedCategory?.slug === 'ebikes';
  const showEngineCcField =
    Boolean(selectedCategory) &&
    !isPartsOrAccessories &&
    selectedCategory?.slug !== 'bicycles' &&
    !isElectricCategory;

  // Persist draft cleanly while editing
  useEffect(() => {
    if (!isOpen || createdResult) return;
    saveAddDraft(form);
  }, [form, isOpen, createdResult]);

  // Lock background body scroll when modal open
  useEffect(() => {
    if (!isOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [isOpen]);

  // Reset created confirmation screen when reopened cleanly
  useEffect(() => {
    if (isOpen) {
      setSubmitError(null);
      setSheetDragY(0);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const updateField = <K extends keyof AddListingDraft>(key: K, value: AddListingDraft[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    if (errors[key]) {
      setErrors((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
    }
    if (submitError) setSubmitError(null);
  };

  const handleInputFocus = (e: React.FocusEvent<HTMLElement>) => {
    // Ensure soft keyboard on mobile never hides the focused field
    window.setTimeout(() => {
      e.target.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }, 220);
  };

  const handleImagesChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = Array.from(e.target.files || []);
    e.target.value = '';
    if (fileList.length === 0) return;

    if (!isOnline || !(await checkServerReachable())) {
      setErrors((prev) => ({
        ...prev,
        images: 'إضافة دراجة ورفع الصور تحتاج اتصالًا بالإنترنت.',
      }));
      return;
    }

    const remaining = 10 - form.images.length;
    if (remaining <= 0) {
      setErrors((prev) => ({ ...prev, images: 'الحد الأقصى هو 10 صور.' }));
      return;
    }

    const toUpload = fileList.slice(0, remaining);
    setIsUploadingImages(true);
    setErrors((prev) => {
      const n = { ...prev };
      delete n.images;
      return n;
    });

    try {
      const urls = await uploadImagesApi(toUpload);
      setForm((prev) => {
        const hasCover = prev.images.some((i) => i.isCover);
        const added: ListingImage[] = urls.map((url, idx) => ({
          url,
          isCover: !hasCover && idx === 0,
        }));
        return { ...prev, images: [...prev.images, ...added].slice(0, 10) };
      });
    } catch (err: any) {
      setErrors((prev) => ({
        ...prev,
        images: err?.message || 'فشل رفع الصور، تحقق من الصيغة واتصال الإنترنت.',
      }));
    } finally {
      setIsUploadingImages(false);
    }
  };

  const handleRemoveImage = (index: number) => {
    setForm((prev) => {
      const next = prev.images.filter((_, idx) => idx !== index);
      if (next.length > 0 && !next.some((img) => img.isCover)) {
        next[0] = { ...next[0], isCover: true };
      }
      return { ...prev, images: next };
    });
  };

  const handleSetCover = (index: number) => {
    setForm((prev) => ({
      ...prev,
      images: prev.images.map((img, idx) => ({ ...img, isCover: idx === index })),
    }));
  };

  const handleVideoChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    if (!isOnline || !(await checkServerReachable())) {
      setErrors((prev) => ({
        ...prev,
        video: 'رفع الفيديو يحتاج اتصالًا بالإنترنت.',
      }));
      return;
    }

    if (file.size > 35 * 1024 * 1024) {
      setErrors((prev) => ({
        ...prev,
        video: 'حجم الفيديو يتجاوز 35 ميجابايت. يرجى اختيار ملف أصغر.',
      }));
      return;
    }

    setIsUploadingVideo(true);
    setErrors((prev) => {
      const n = { ...prev };
      delete n.video;
      return n;
    });

    try {
      const url = await uploadVideoApi(file);
      updateField('video_url', url);
    } catch (err: any) {
      setErrors((prev) => ({
        ...prev,
        video: err?.message || 'تعذر رفع الفيديو.',
      }));
    } finally {
      setIsUploadingVideo(false);
    }
  };

  const validateForm = (): boolean => {
    const nextErrors: Record<string, string> = {};
    if (!form.governorate) {
      nextErrors.governorate = 'يرجى اختيار المحافظة.';
    }
    if (form.title.trim().length < 3) {
      nextErrors.title = isPartsOrAccessories
        ? 'يرجى كتابة اسم القطعة أو المنتج (3 أحرف على الأقل).'
        : 'يرجى كتابة اسم الدراجة (3 أحرف على الأقل).';
    }
    if (!form.category_id) {
      nextErrors.category_id = 'يرجى اختيار القسم.';
    }
    const maxYear = new Date().getFullYear() + 1;
    if (!isPartsOrAccessories) {
      const yr = Number(form.model_year);
      if (!form.model_year.trim() || Number.isNaN(yr) || yr < 1970 || yr > maxYear) {
        nextErrors.model_year = `يرجى إدخال سنة صنع بين 1970 و ${maxYear}.`;
      }
    } else if (form.model_year.trim()) {
      const yr = Number(form.model_year);
      if (Number.isNaN(yr) || yr < 1970 || yr > maxYear) {
        nextErrors.model_year = 'سنة التوافق غير صحيحة.';
      }
    }

    if (showEngineCcField && form.engine_cc?.trim()) {
      const cc = Number(form.engine_cc);
      if (Number.isNaN(cc) || cc < 30 || cc > 2500) {
        nextErrors.engine_cc = 'سعة المحرك يجب أن تكون بين 30 و 2500 سي سي.';
      }
    }

    if (isElectricCategory && form.motor_watts?.trim()) {
      const w = Number(form.motor_watts);
      if (Number.isNaN(w) || w < 100 || w > 20000) {
        nextErrors.motor_watts = 'قدرة المحرك الكهربائي يجب أن تكون بين 100 و 20000 واط.';
      }
    }

    const numericPrice = Number(form.price_iqd.replace(/,/g, '').trim());
    if (!numericPrice || Number.isNaN(numericPrice) || numericPrice < 1000) {
      nextErrors.price_iqd = 'يرجى إدخال سعر صحيح بالدينار العراقي (1,000 دينار فأكثر).';
    }

    if (!isValidIraqiPhone(form.phone)) {
      nextErrors.phone = 'يرجى إدخال رقم هاتف عراقي صحيح يبدأ بـ 07 (11 رقماً).';
    }

    if (form.description.trim().length < 10) {
      nextErrors.description = 'يرجى كتابة وصف واضح (10 أحرف على الأقل).';
    }

    if (form.images.length === 0) {
      nextErrors.images = 'يرجى رفع صورة واحدة على الأقل للمنتج.';
    }

    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting || isUploadingImages || isUploadingVideo) return;

    if (!validateForm()) {
      setSubmitError('يرجى تصحيح الحقول المحددة قبل النشر.');
      return;
    }

    if (!isOnline || !(await checkServerReachable())) {
      setSubmitError('إضافة دراجة تحتاج اتصالًا بالإنترنت. تم الاحتفاظ بمسودتك ولن تُحذف.');
      return;
    }

    setIsSubmitting(true);
    setSubmitError(null);

    try {
      const numericPrice = Number(form.price_iqd.replace(/,/g, '').trim());
      const res = await createListingApi({
        governorate: form.governorate,
        title: form.title.trim(),
        brand: (form.brand || '').trim(),
        category_id: Number(form.category_id),
        model_year: form.model_year.trim() ? Number(form.model_year.trim()) : null,
        engine_cc:
          showEngineCcField && form.engine_cc?.trim()
            ? Number(form.engine_cc.trim())
            : null,
        motor_watts:
          isElectricCategory && form.motor_watts?.trim()
            ? Number(form.motor_watts.trim())
            : null,
        condition: form.condition,
        price_iqd: numericPrice,
        negotiable: form.negotiable,
        phone: normalizeIraqiPhone(form.phone),
        area: form.area.trim(),
        description: form.description.trim(),
        keywords: (form.keywords || '').trim(),
        images: form.images,
        video_url: form.video_url,
      });

      // Save ownership securely locally for edit/sold controls without an account tab
      saveOwnership({
        listingId: res.listing.id,
        ownerToken: res.ownerToken,
        ownerCode: res.ownerCode,
        title: res.listing.title,
        createdAt: res.listing.created_at,
      });

      clearAddDraft();
      setForm({
        ...EMPTY_DRAFT,
        governorate:
          defaultGovernorate && defaultGovernorate !== 'جميع المحافظات'
            ? defaultGovernorate
            : '',
      });
      setCreatedResult({ listing: res.listing, ownerCode: res.ownerCode });
    } catch (err: any) {
      if (err instanceof ApiError && err.fieldErrors) {
        setErrors((prev) => ({ ...prev, ...err.fieldErrors }));
      }
      setSubmitError(
        err?.message ||
          'تعذر إرسال المنشور للخادم. احتفظنا ببياناتك، يرجى المحاولة مرة أخرى.'
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCopyCode = async () => {
    if (!createdResult) return;
    try {
      await navigator.clipboard.writeText(createdResult.ownerCode);
      setCopiedCode(true);
      window.setTimeout(() => setCopiedCode(false), 2000);
    } catch {
      // ignore
    }
  };

  const closeAndResetResult = () => {
    setCreatedResult(null);
    onClose();
  };

  // Handle touch drag on top drag handle bar (mobile)
  const onHandleTouchStart = (e: React.TouchEvent) => {
    dragStartYRef.current = e.touches[0].clientY;
  };
  const onHandleTouchMove = (e: React.TouchEvent) => {
    if (dragStartYRef.current === null) return;
    const diff = e.touches[0].clientY - dragStartYRef.current;
    if (diff > 0) setSheetDragY(diff);
  };
  const onHandleTouchEnd = () => {
    if (sheetDragY > 110) {
      setSheetDragY(0);
      dragStartYRef.current = null;
      closeAndResetResult();
    } else {
      setSheetDragY(0);
      dragStartYRef.current = null;
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-[#0D2545]/55 backdrop-blur-xs"
      onClick={(e) => {
        if (e.target === e.currentTarget && !isSubmitting) closeAndResetResult();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-listing-title"
        style={{
          transform: sheetDragY > 0 ? `translateY(${sheetDragY}px)` : undefined,
        }}
        className="w-full md:max-w-2xl bg-white rounded-t-3xl md:rounded-2xl shadow-2xl flex flex-col max-h-[92dvh] md:max-h-[88dvh] transition-transform duration-150 overflow-hidden"
      >
        {/* Top drag handle + header */}
        <div
          onTouchStart={onHandleTouchStart}
          onTouchMove={onHandleTouchMove}
          onTouchEnd={onHandleTouchEnd}
          className="px-5 pt-3 pb-3.5 border-b border-slate-100 shrink-0 bg-white select-none"
        >
          <div className="w-11 h-1.5 bg-slate-300 rounded-full mx-auto mb-3 md:hidden" />
          <div className="flex items-center justify-between">
            <div className="w-10" />
            <h2
              id="add-listing-title"
              className="text-lg sm:text-xl font-extrabold text-[#0D2545]"
            >
              {createdResult
                ? 'تم استلام منشورك بنجاح'
                : isPartsOrAccessories
                  ? 'إضافة قطعة غيار أو إكسسوار'
                  : 'إضافة دراجة'}
            </h2>
            <button
              type="button"
              onClick={closeAndResetResult}
              aria-label="إغلاق النافذة"
              className="w-10 h-10 rounded-full hover:bg-slate-100 flex items-center justify-center text-slate-500 transition-colors cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Success Screen */}
        {createdResult ? (
          <div className="p-6 sm:p-8 overflow-y-auto text-center space-y-5">
            <div className="w-16 h-16 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center mx-auto">
              <CheckCircle2 className="w-10 h-10" />
            </div>
            <div>
              <h3 className="text-xl font-extrabold text-[#0D2545]">
                تم حفظ منشورك وهو قيد المراجعة
              </h3>
              <p className="mt-2 text-sm text-slate-600 leading-relaxed max-w-md mx-auto">
                تم حفظ «{createdResult.listing.title}» في الخادم بنجاح. سيظهر للعامة في الرئيسية وقسم «
                {createdResult.listing.category_name}» فور اعتماده من الإدارة.
              </p>
            </div>

            <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 max-w-md mx-auto">
              <p className="text-xs font-bold text-slate-500 mb-2">
                كود إدارة المنشور (احتفظ به لتعديل الحالة أو إعلان «تم البيع» من أي جهاز)
              </p>
              <div className="flex items-center justify-center gap-3">
                <span
                  dir="ltr"
                  className="text-xl font-extrabold tracking-widest text-[#0D2545] tabular-nums bg-white px-4 py-2 rounded-xl border border-slate-200"
                >
                  {createdResult.ownerCode}
                </span>
                <button
                  type="button"
                  onClick={handleCopyCode}
                  className="h-11 px-4 rounded-xl bg-[#0D2545] hover:bg-[#163661] text-white text-sm font-bold inline-flex items-center gap-1.5 cursor-pointer"
                >
                  {copiedCode ? (
                    <>
                      <Check className="w-4 h-4" />
                      تم النسخ
                    </>
                  ) : (
                    <>
                      <Copy className="w-4 h-4" />
                      نسخ
                    </>
                  )}
                </button>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-2">
              <button
                type="button"
                onClick={() => {
                  const target = createdResult.listing;
                  setCreatedResult(null);
                  onClose();
                  onCreatedPreview(target);
                }}
                className="w-full sm:w-auto px-6 h-12 rounded-xl bg-[#F96B11] hover:bg-[#e55d09] text-white font-bold text-sm transition-colors cursor-pointer"
              >
                معاينة منشوري وإدارته
              </button>
              <button
                type="button"
                onClick={closeAndResetResult}
                className="w-full sm:w-auto px-6 h-12 rounded-xl bg-slate-100 hover:bg-slate-200 text-[#0D2545] font-bold text-sm transition-colors cursor-pointer"
              >
                العودة للتصفح
              </button>
            </div>
          </div>
        ) : (
          <form
            onSubmit={handleSubmit}
            noValidate
            className="flex flex-col flex-1 min-h-0"
          >
            <div
              ref={scrollRef}
              className="flex-1 overflow-y-auto overscroll-contain px-5 py-4 space-y-4"
            >
              {submitError && (
                <div
                  role="alert"
                  className="flex items-start gap-2.5 p-3.5 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm"
                >
                  <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
                  <span>{submitError}</span>
                </div>
              )}

              {/* 1. المحافظة */}
              <div>
                <label
                  htmlFor="add-gov"
                  className="flex items-center gap-2 text-sm font-bold text-[#0D2545] mb-1.5"
                >
                  <MapPin className="w-4 h-4 text-slate-500" />
                  <span>المحافظة</span>
                  <span className="text-red-500">*</span>
                </label>
                <select
                  id="add-gov"
                  value={form.governorate}
                  onChange={(e) => updateField('governorate', e.target.value)}
                  onFocus={handleInputFocus}
                  className={`w-full h-11 px-3.5 rounded-xl border bg-white text-sm text-[#0D2545] focus:outline-none focus:ring-2 focus:ring-[#F96B11] ${
                    errors.governorate ? 'border-red-400' : 'border-slate-200'
                  }`}
                >
                  <option value="">اختر المحافظة</option>
                  {IRAQI_GOVERNORATES.map((gov) => (
                    <option key={gov} value={gov}>
                      {gov}
                    </option>
                  ))}
                </select>
                {errors.governorate && (
                  <p className="mt-1 text-xs text-red-600">{errors.governorate}</p>
                )}
              </div>

              {/* 2. اسم الدراجة / المنتج */}
              <div>
                <label
                  htmlFor="add-title"
                  className="flex items-center gap-2 text-sm font-bold text-[#0D2545] mb-1.5"
                >
                  <Bike className="w-4 h-4 text-slate-500" />
                  <span>
                    {isPartsOrAccessories ? 'اسم القطعة أو المنتج' : 'اسم الدراجة'}
                  </span>
                  <span className="text-red-500">*</span>
                </label>
                <input
                  id="add-title"
                  type="text"
                  value={form.title}
                  onChange={(e) => updateField('title', e.target.value)}
                  onFocus={handleInputFocus}
                  placeholder={
                    isPartsOrAccessories
                      ? 'مثال: خوذة أصلية أو ديسك بريك أمامي'
                      : 'مثال: هوندا CBR600 أو سكوتر ياماها'
                  }
                  className={`w-full h-11 px-3.5 rounded-xl border bg-white text-sm text-[#0D2545] placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#F96B11] ${
                    errors.title ? 'border-red-400' : 'border-slate-200'
                  }`}
                />
                {errors.title && (
                  <p className="mt-1 text-xs text-red-600">{errors.title}</p>
                )}
              </div>

              {/* 3. النوع / القسم */}
              <div>
                <label
                  htmlFor="add-category"
                  className="flex items-center gap-2 text-sm font-bold text-[#0D2545] mb-1.5"
                >
                  <Layers className="w-4 h-4 text-slate-500" />
                  <span>النوع / القسم</span>
                  <span className="text-red-500">*</span>
                </label>
                <select
                  id="add-category"
                  value={form.category_id}
                  onChange={(e) => updateField('category_id', e.target.value)}
                  onFocus={handleInputFocus}
                  className={`w-full h-11 px-3.5 rounded-xl border bg-white text-sm text-[#0D2545] focus:outline-none focus:ring-2 focus:ring-[#F96B11] ${
                    errors.category_id ? 'border-red-400' : 'border-slate-200'
                  }`}
                >
                  <option value="">اختر النوع / القسم</option>
                  {categories.map((cat) => (
                    <option key={cat.id} value={cat.id}>
                      {cat.name_ar}
                    </option>
                  ))}
                </select>
                {errors.category_id && (
                  <p className="mt-1 text-xs text-red-600">{errors.category_id}</p>
                )}
              </div>

              {/* 3.5 الماركة (اختياري) */}
              <div>
                <label
                  htmlFor="add-brand"
                  className="flex items-center gap-2 text-sm font-bold text-[#0D2545] mb-1.5"
                >
                  <Tag className="w-4 h-4 text-slate-500" />
                  <span>الماركة / الشركة المصنّعة (اختياري)</span>
                </label>
                <input
                  id="add-brand"
                  type="text"
                  value={form.brand || ''}
                  onChange={(e) => updateField('brand', e.target.value)}
                  onFocus={handleInputFocus}
                  placeholder="مثال: هوندا، ياماها، فيسبا، دايون، سبيشلايزد"
                  className="w-full h-11 px-3.5 rounded-xl border border-slate-200 bg-white text-sm text-[#0D2545] placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#F96B11]"
                />
              </div>

              {/* 4. الموديل: سنة الصنع + سعة المحرك أو قدرة الكهرباء */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label
                    htmlFor="add-year"
                    className="flex items-center gap-2 text-sm font-bold text-[#0D2545] mb-1.5"
                  >
                    <Calendar className="w-4 h-4 text-slate-500" />
                    <span>
                      {isPartsOrAccessories
                        ? 'موديل التوافق / السنة (اختياري)'
                        : 'الموديل: سنة الصنع'}
                    </span>
                    {!isPartsOrAccessories && <span className="text-red-500">*</span>}
                  </label>
                  <input
                    id="add-year"
                    type="number"
                    inputMode="numeric"
                    value={form.model_year}
                    onChange={(e) => updateField('model_year', e.target.value)}
                    onFocus={handleInputFocus}
                    placeholder={isPartsOrAccessories ? 'مثال: 2023 (اختياري)' : 'مثال: 2022'}
                    className={`w-full h-11 px-3.5 rounded-xl border bg-white text-sm text-[#0D2545] tabular-nums placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#F96B11] ${
                      errors.model_year ? 'border-red-400' : 'border-slate-200'
                    }`}
                  />
                  {errors.model_year && (
                    <p className="mt-1 text-xs text-red-600">{errors.model_year}</p>
                  )}
                </div>

                {showEngineCcField && (
                  <div>
                    <label
                      htmlFor="add-cc"
                      className="flex items-center gap-2 text-sm font-bold text-[#0D2545] mb-1.5"
                    >
                      <span>سعة المحرك — سي سي (اختياري)</span>
                    </label>
                    <div className="relative">
                      <input
                        id="add-cc"
                        type="number"
                        inputMode="numeric"
                        value={form.engine_cc || ''}
                        onChange={(e) => updateField('engine_cc', e.target.value)}
                        onFocus={handleInputFocus}
                        placeholder="مثال: 150 أو 600"
                        className={`w-full h-11 px-3.5 pl-16 rounded-xl border bg-white text-sm text-[#0D2545] tabular-nums placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#F96B11] ${
                          errors.engine_cc ? 'border-red-400' : 'border-slate-200'
                        }`}
                      />
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-400 pointer-events-none">
                        سي سي
                      </span>
                    </div>
                    {errors.engine_cc && (
                      <p className="mt-1 text-xs text-red-600">{errors.engine_cc}</p>
                    )}
                  </div>
                )}

                {isElectricCategory && (
                  <div>
                    <label
                      htmlFor="add-watts"
                      className="flex items-center gap-2 text-sm font-bold text-[#0D2545] mb-1.5"
                    >
                      <span>قدرة المحرك الكهربائي — واط (اختياري)</span>
                    </label>
                    <div className="relative">
                      <input
                        id="add-watts"
                        type="number"
                        inputMode="numeric"
                        value={form.motor_watts || ''}
                        onChange={(e) => updateField('motor_watts', e.target.value)}
                        onFocus={handleInputFocus}
                        placeholder="مثال: 1500"
                        className={`w-full h-11 px-3.5 pl-14 rounded-xl border bg-white text-sm text-[#0D2545] tabular-nums placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#F96B11] ${
                          errors.motor_watts ? 'border-red-400' : 'border-slate-200'
                        }`}
                      />
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-400 pointer-events-none">
                        واط
                      </span>
                    </div>
                    {errors.motor_watts && (
                      <p className="mt-1 text-xs text-red-600">{errors.motor_watts}</p>
                    )}
                  </div>
                )}
              </div>

              {/* 5. الحالة: جديدة أو مستعملة */}
              <div>
                <span className="block text-sm font-bold text-[#0D2545] mb-1.5">
                  الحالة <span className="text-red-500">*</span>
                </span>
                <div className="grid grid-cols-2 gap-2 p-1 bg-slate-100 rounded-xl">
                  <button
                    type="button"
                    onClick={() => updateField('condition', 'new')}
                    className={`h-10 rounded-lg text-sm font-bold transition-colors cursor-pointer ${
                      form.condition === 'new'
                        ? 'bg-white text-[#0D2545] shadow-xs'
                        : 'text-slate-600 hover:text-[#0D2545]'
                    }`}
                  >
                    {isPartsOrAccessories ? 'جديد' : 'جديدة'}
                  </button>
                  <button
                    type="button"
                    onClick={() => updateField('condition', 'used')}
                    className={`h-10 rounded-lg text-sm font-bold transition-colors cursor-pointer ${
                      form.condition === 'used'
                        ? 'bg-white text-[#0D2545] shadow-xs'
                        : 'text-slate-600 hover:text-[#0D2545]'
                    }`}
                  >
                    {isPartsOrAccessories ? 'مستعمل' : 'مستعملة'}
                  </button>
                </div>
              </div>

              {/* 6. السعر بالدينار العراقي + قابل للتفاوض */}
              <div>
                <label
                  htmlFor="add-price"
                  className="flex items-center gap-2 text-sm font-bold text-[#0D2545] mb-1.5"
                >
                  <Tag className="w-4 h-4 text-slate-500" />
                  <span>السعر بالدينار العراقي</span>
                  <span className="text-red-500">*</span>
                </label>
                <div className="flex flex-col sm:flex-row sm:items-center gap-2.5">
                  <div className="relative flex-1">
                    <input
                      id="add-price"
                      type="number"
                      inputMode="numeric"
                      value={form.price_iqd}
                      onChange={(e) => updateField('price_iqd', e.target.value)}
                      onFocus={handleInputFocus}
                      placeholder="مثال: 5500000"
                      className={`w-full h-11 px-3.5 pl-24 rounded-xl border bg-white text-sm text-[#0D2545] tabular-nums placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#F96B11] ${
                        errors.price_iqd ? 'border-red-400' : 'border-slate-200'
                      }`}
                    />
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-semibold text-slate-500 pointer-events-none">
                      دينار عراقي
                    </span>
                  </div>

                  <label className="inline-flex items-center gap-2 h-11 px-3.5 rounded-xl border border-slate-200 bg-slate-50 cursor-pointer select-none shrink-0">
                    <input
                      type="checkbox"
                      checked={form.negotiable}
                      onChange={(e) => updateField('negotiable', e.target.checked)}
                      className="w-4 h-4 accent-[#F96B11] rounded"
                    />
                    <span className="text-sm font-semibold text-[#0D2545]">
                      قابل للتفاوض
                    </span>
                  </label>
                </div>
                {errors.price_iqd && (
                  <p className="mt-1 text-xs text-red-600">{errors.price_iqd}</p>
                )}
              </div>

              {/* 7. رقم الهاتف */}
              <div>
                <label
                  htmlFor="add-phone"
                  className="flex items-center gap-2 text-sm font-bold text-[#0D2545] mb-1.5"
                >
                  <Phone className="w-4 h-4 text-slate-500" />
                  <span>رقم الهاتف</span>
                  <span className="text-red-500">*</span>
                </label>
                <input
                  id="add-phone"
                  type="tel"
                  inputMode="tel"
                  dir="ltr"
                  value={form.phone}
                  onChange={(e) => updateField('phone', e.target.value)}
                  onFocus={handleInputFocus}
                  placeholder="07xxxxxxxxx"
                  className={`w-full h-11 px-3.5 rounded-xl border bg-white text-sm text-right text-[#0D2545] tabular-nums placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#F96B11] ${
                    errors.phone ? 'border-red-400' : 'border-slate-200'
                  }`}
                />
                {errors.phone && (
                  <p className="mt-1 text-xs text-red-600">{errors.phone}</p>
                )}
              </div>

              {/* 8. المنطقة أو العنوان المختصر (اختياري) */}
              <div>
                <label
                  htmlFor="add-area"
                  className="flex items-center gap-2 text-sm font-bold text-[#0D2545] mb-1.5"
                >
                  <Navigation className="w-4 h-4 text-slate-500" />
                  <span>المنطقة أو العنوان المختصر (اختياري)</span>
                </label>
                <input
                  id="add-area"
                  type="text"
                  value={form.area}
                  onChange={(e) => updateField('area', e.target.value)}
                  onFocus={handleInputFocus}
                  placeholder="مثال: الكرادة، حي الحسين، المنصور"
                  className="w-full h-11 px-3.5 rounded-xl border border-slate-200 bg-white text-sm text-[#0D2545] placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#F96B11]"
                />
              </div>

              {/* 9. وصف كبير */}
              <div>
                <label
                  htmlFor="add-description"
                  className="flex items-center gap-2 text-sm font-bold text-[#0D2545] mb-1.5"
                >
                  <FileText className="w-4 h-4 text-slate-500" />
                  <span>الوصف</span>
                  <span className="text-red-500">*</span>
                </label>
                <textarea
                  id="add-description"
                  rows={4}
                  value={form.description}
                  onChange={(e) => updateField('description', e.target.value)}
                  onFocus={handleInputFocus}
                  placeholder={
                    isPartsOrAccessories
                      ? 'اكتب تفاصيل القطعة، التوافق مع الموديلات، الحالة، وأي ملاحظات...'
                      : 'اكتب تفاصيل عن الدراجة مثل الحالة والمواصفات والمسافة المقطوعة والأوراق...'
                  }
                  className={`w-full p-3.5 rounded-xl border bg-white text-sm text-[#0D2545] placeholder:text-slate-400 leading-relaxed focus:outline-none focus:ring-2 focus:ring-[#F96B11] resize-y ${
                    errors.description ? 'border-red-400' : 'border-slate-200'
                  }`}
                />
                {errors.description && (
                  <p className="mt-1 text-xs text-red-600">{errors.description}</p>
                )}
              </div>

              {/* 9.5 كلمات بديلة للبحث (اختياري) */}
              <div>
                <label
                  htmlFor="add-keywords"
                  className="flex items-center gap-2 text-sm font-bold text-[#0D2545] mb-1.5"
                >
                  <span>كلمات بديلة أو أسماء محلية للبحث (اختياري)</span>
                </label>
                <input
                  id="add-keywords"
                  type="text"
                  value={form.keywords || ''}
                  onChange={(e) => updateField('keywords', e.target.value)}
                  onFocus={handleInputFocus}
                  placeholder="مثال: Honda CBR سبورت، أو أي اسم شائع يساعد المشترين بالوصول للإعلان"
                  className="w-full h-11 px-3.5 rounded-xl border border-slate-200 bg-white text-sm text-[#0D2545] placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#F96B11]"
                />
              </div>

              {/* 10. رفع صور فعلية من الجهاز (حتى 10 صور) */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-sm font-bold text-[#0D2545]">
                    الصور (حتى 10 صور) <span className="text-red-500">*</span>
                  </span>
                  <span className="text-xs text-slate-500 tabular-nums">
                    {form.images.length} / 10
                  </span>
                </div>

                <input
                  ref={imageInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  multiple
                  onChange={handleImagesChange}
                  className="hidden"
                />

                <button
                  type="button"
                  disabled={isUploadingImages || form.images.length >= 10}
                  onClick={() => imageInputRef.current?.click()}
                  className={`w-full py-5 px-4 rounded-2xl border-2 border-dashed flex flex-col items-center justify-center gap-1.5 transition-colors cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed ${
                    errors.images
                      ? 'border-red-400 bg-red-50/40'
                      : 'border-slate-300 bg-slate-50/70 hover:bg-slate-100/70'
                  }`}
                >
                  {isUploadingImages ? (
                    <>
                      <Loader2 className="w-7 h-7 text-[#F96B11] animate-spin" />
                      <span className="text-sm font-bold text-[#0D2545]">
                        جاري ضغط ورفع الصور...
                      </span>
                    </>
                  ) : (
                    <>
                      <div className="flex items-center gap-2 text-[#0D2545] font-bold text-sm">
                        <ImagePlus className="w-5 h-5 text-slate-600" />
                        <span>إضافة صور</span>
                      </div>
                      <span className="text-xs text-slate-500">
                        {isPartsOrAccessories
                          ? 'ارفع صوراً واضحة للقطعة من جهازك (JPG, PNG, WebP)'
                          : 'ارفع صوراً للدراجة من جهازك (حتى 10 صور — ضغط تلقائي)'}
                      </span>
                    </>
                  )}
                </button>
                {errors.images && (
                  <p className="mt-1 text-xs text-red-600">{errors.images}</p>
                )}

                {form.images.length > 0 && (
                  <div className="mt-3 grid grid-cols-3 sm:grid-cols-5 gap-2.5">
                    {form.images.map((img, idx) => (
                      <div
                        key={`${img.url}-${idx}`}
                        className={`relative aspect-square rounded-xl overflow-hidden border-2 ${
                          img.isCover ? 'border-[#F96B11]' : 'border-slate-200'
                        }`}
                      >
                        <img
                          src={img.url}
                          alt={`صورة ${idx + 1}`}
                          className="w-full h-full object-cover"
                        />
                        <button
                          type="button"
                          onClick={() => handleRemoveImage(idx)}
                          aria-label="حذف الصورة"
                          className="absolute top-1 left-1 w-7 h-7 rounded-full bg-black/65 hover:bg-red-600 text-white flex items-center justify-center cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleSetCover(idx)}
                          className={`absolute bottom-1 inset-x-1 py-1 rounded-lg text-[11px] font-bold flex items-center justify-center gap-1 cursor-pointer ${
                            img.isCover
                              ? 'bg-[#F96B11] text-white'
                              : 'bg-black/60 text-white hover:bg-black/80'
                          }`}
                        >
                          <Star
                            className={`w-3 h-3 ${img.isCover ? 'fill-white' : ''}`}
                          />
                          <span>{img.isCover ? 'الغلاف' : 'تعيين غلاف'}</span>
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* 11. فيديو اختياري */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-sm font-bold text-[#0D2545]">
                    فيديو اختياري
                  </span>
                  <span className="text-xs text-slate-500">
                    MP4 / WebM / MOV — حد أقصى 35 MB
                  </span>
                </div>

                <input
                  ref={videoInputRef}
                  type="file"
                  accept="video/mp4,video/webm,video/quicktime"
                  onChange={handleVideoChange}
                  className="hidden"
                />

                {form.video_url ? (
                  <div className="relative rounded-2xl overflow-hidden border border-slate-200 bg-black">
                    <video
                      src={form.video_url}
                      controls
                      className="w-full max-h-52 object-contain"
                    />
                    <button
                      type="button"
                      onClick={() => updateField('video_url', null)}
                      className="absolute top-2 left-2 px-3 py-1.5 rounded-lg bg-red-600 hover:bg-red-700 text-white text-xs font-bold inline-flex items-center gap-1 cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      حذف الفيديو
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    disabled={isUploadingVideo}
                    onClick={() => videoInputRef.current?.click()}
                    className="w-full py-3.5 px-4 rounded-xl border border-slate-200 bg-slate-50 hover:bg-slate-100 flex items-center justify-center gap-2 text-sm font-semibold text-[#0D2545] transition-colors cursor-pointer disabled:opacity-60"
                  >
                    {isUploadingVideo ? (
                      <>
                        <Loader2 className="w-4 h-4 text-[#F96B11] animate-spin" />
                        <span>جاري رفع الفيديو...</span>
                      </>
                    ) : (
                      <>
                        <Film className="w-4 h-4 text-slate-500" />
                        <span>إرفاق فيديو قصير (اختياري)</span>
                      </>
                    )}
                  </button>
                )}
                {errors.video && (
                  <p className="mt-1 text-xs text-red-600">{errors.video}</p>
                )}
              </div>
            </div>

            {/* Sticky Submit Button Footer */}
            <div className="p-4 border-t border-slate-100 bg-white shrink-0 pb-safe space-y-2">
              {!isOnline && (
                <p className="text-xs font-bold text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 text-center">
                  إضافة دراجة تحتاج اتصالًا بالإنترنت — مسوّدتك محفوظة بأمان.
                </p>
              )}
              <button
                type="submit"
                disabled={!isOnline || isSubmitting || isUploadingImages || isUploadingVideo}
                className="w-full h-12 rounded-xl bg-[#F96B11] hover:bg-[#e55d09] active:scale-[0.99] text-white font-extrabold text-base shadow-md shadow-[#F96B11]/25 flex items-center justify-center gap-2 transition-all disabled:opacity-60 disabled:cursor-not-allowed cursor-pointer"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" />
                    <span>جاري الحفظ والنشر...</span>
                  </>
                ) : (
                  <span>
                    {isPartsOrAccessories ? 'نشر المنتج' : 'نشر الدراجة'}
                  </span>
                )}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
