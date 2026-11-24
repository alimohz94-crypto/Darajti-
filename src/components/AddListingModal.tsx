import React, { useEffect, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, ImagePlus, Loader2, RefreshCw, Trash2, X } from 'lucide-react';
import { Category, Listing, ListingImage } from '../types';
import {
  ApiError,
  checkServerReachable,
  createListingApi,
  uploadImagesApi,
} from '../utils/api';

type SimpleForm = {
  title: string;
  brand: string;
  model: string;
  price: string;
  images: ListingImage[];
};

export function AddListingModal({
  isOpen,
  isOnline = true,
  categories,
  initialCategoryId,
  onClose,
  onCreatedPreview,
}: {
  isOpen: boolean;
  isOnline?: boolean;
  categories: Category[];
  initialCategoryId?: number | null;
  onClose: () => void;
  onCreatedPreview: (listing: Listing) => void;
}) {
  const emptyForm: SimpleForm = { title: '', brand: '', model: '', price: '', images: [] };
  const [form, setForm] = useState<SimpleForm>(emptyForm);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submittedTitle, setSubmittedTitle] = useState('');
  const [completed, setCompleted] = useState(false);
  const galleryRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);

  const motorcycleCategory = categories.find((cat) => cat.slug === 'motorcycles');
  const selectedCategory =
    categories.find((cat) => cat.id === initialCategoryId) ||
    motorcycleCategory ||
    categories[0];
  const isPartsOrAccessories = Boolean(selectedCategory?.is_parts_or_accessories);
  const categoryId = Number(selectedCategory?.id || 0);

  useEffect(() => {
    if (!isOpen) return;
    setForm(emptyForm);
    setErrors({});
    setSubmitError(null);
    setSubmittedTitle('');
    setCompleted(false);
  }, [isOpen, initialCategoryId]);

  useEffect(() => {
    if (!isOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const update = (key: keyof SimpleForm, value: string) => {
    setForm((current) => ({ ...current, [key]: value }));
    setErrors((current) => {
      const next = { ...current };
      delete next[key];
      return next;
    });
    setSubmitError(null);
  };

  const handleImage = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    if (!isOnline || !(await checkServerReachable())) {
      setErrors((current) => ({ ...current, images: 'رفع الصورة يحتاج اتصالًا بالإنترنت.' }));
      return;
    }

    setIsUploading(true);
    setErrors((current) => {
      const next = { ...current };
      delete next.images;
      return next;
    });

    try {
      const urls = await uploadImagesApi([file]);
      setForm((current) => ({
        ...current,
        images: [{ url: urls[0], isCover: true }],
      }));
    } catch (error: any) {
      setErrors((current) => ({
        ...current,
        images: error?.message || 'تعذر رفع الصورة، يرجى المحاولة مرة أخرى.',
      }));
    } finally {
      setIsUploading(false);
    }
  };

  const removeImage = () => {
    setForm((current) => ({ ...current, images: [] }));
  };

  const validate = () => {
    const next: Record<string, string> = {};
    if (form.title.trim().length < 3) {
      next.title = isPartsOrAccessories
        ? 'يرجى كتابة اسم المنتج.'
        : 'يرجى كتابة اسم الدراجة.';
    }
    if (!isPartsOrAccessories) {
      const year = Number(form.model);
      const maxYear = new Date().getFullYear() + 1;
      if (!form.model.trim() || !Number.isInteger(year) || year < 1970 || year > maxYear) {
        next.model = `يرجى إدخال سنة صنع صحيحة بين 1970 و ${maxYear}.`;
      }
    } else if (form.model.trim().length > 120) {
      next.model = 'نص التوافق طويل جدًا.';
    }
    const price = Number(form.price.replace(/,/g, '').trim());
    if (!price || !Number.isFinite(price) || price < 1000) {
      next.price = 'يرجى إدخال سعر صحيح بالدينار العراقي.';
    }
    if (form.images.length !== 1) {
      next.images = 'يرجى رفع صورة واحدة للدراجة أو المنتج.';
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (isSubmitting || isUploading) return;
    if (!validate()) {
      setSubmitError('يرجى تصحيح الحقول المحددة قبل الإرسال.');
      return;
    }
    if (!isOnline || !(await checkServerReachable())) {
      setSubmitError('الإضافة تحتاج اتصالًا بالإنترنت.');
      return;
    }

    setIsSubmitting(true);
    setSubmitError(null);
    try {
      const numericModel = !isPartsOrAccessories && form.model.trim()
        ? Number(form.model.trim())
        : null;
      const compatibility = isPartsOrAccessories ? form.model.trim() : '';
      const autoDescription = [
        form.title.trim(),
        form.brand.trim() ? `الشركة المصنّعة: ${form.brand.trim()}` : '',
        compatibility ? `التوافق: ${compatibility}` : '',
      ].filter(Boolean).join(' — ');

      const response = await createListingApi({
        title: form.title.trim(),
        brand: form.brand.trim(),
        category_id: categoryId,
        governorate: '',
        area: '',
        model_year: numericModel,
        engine_cc: null,
        motor_watts: null,
        condition: 'used',
        price_iqd: Number(form.price.replace(/,/g, '').trim()),
        negotiable: false,
        phone: '',
        description: autoDescription,
        keywords: compatibility,
        images: form.images,
        video_url: null,
      });

      setSubmittedTitle(response.listing.title);
      setCompleted(true);
    } catch (error: any) {
      if (error instanceof ApiError && error.fieldErrors) {
        setErrors((current) => ({ ...current, ...error.fieldErrors }));
      }
      setSubmitError(error?.message || 'تعذر إرسال المنشور، يرجى المحاولة مرة أخرى.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const close = () => {
    setCompleted(false);
    setForm(emptyForm);
    setErrors({});
    setSubmitError(null);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-end md:items-center justify-center bg-[#06112B]/55 backdrop-blur-[2px] p-0 md:p-4" role="dialog" aria-modal="true">
      <div className="w-full md:max-w-xl max-h-[92dvh] bg-white rounded-t-3xl md:rounded-2xl shadow-2xl flex flex-col overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between shrink-0">
          <h2 className="text-lg font-extrabold text-[#0D2545]">
            {isPartsOrAccessories ? 'إضافة قطعة غيار أو إكسسوار' : 'إضافة دراجة'}
          </h2>
          <button type="button" onClick={close} aria-label="إغلاق" className="w-10 h-10 rounded-full hover:bg-slate-100 flex items-center justify-center text-slate-500">
            <X className="w-5 h-5" />
          </button>
        </div>

        {completed ? (
          <div className="p-6 sm:p-8 text-center space-y-5 overflow-y-auto">
            <CheckCircle2 className="w-16 h-16 mx-auto text-emerald-600" />
            <h3 className="text-lg sm:text-xl font-extrabold text-[#0D2545]">تم إرسال منشورك</h3>
            <p className="text-sm text-slate-600 leading-relaxed">
              تم إرسال منشورك، سيظهر بعد موافقة الإدارة.
            </p>
            <button type="button" onClick={close} className="w-full h-12 rounded-xl bg-[#F96B11] text-white font-bold">
              تم
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} noValidate className="flex flex-col min-h-0">
            <div className="flex-1 overflow-y-auto px-5 py-5 space-y-4">
              {submitError && (
                <div role="alert" className="flex items-start gap-2 p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm">
                  <AlertCircle className="w-5 h-5 shrink-0" />
                  <span>{submitError}</span>
                </div>
              )}

              <Field label={isPartsOrAccessories ? 'اسم المنتج' : 'اسم الدراجة'} error={errors.title}>
                <input value={form.title} onChange={(event) => update('title', event.target.value)} placeholder={isPartsOrAccessories ? 'مثال: فرامل أمامية' : 'مثال: هوندا CBR600'} className={inputClass(errors.title)} />
              </Field>

              <Field label="الشركة المصنّعة (اختياري)">
                <input value={form.brand} onChange={(event) => update('brand', event.target.value)} placeholder="مثال: هوندا أو ياماها" className={inputClass()} />
              </Field>

              <Field
                label={isPartsOrAccessories ? 'الموديل أو التوافق مع الدراجة (اختياري)' : 'الموديل (سنة الصنع)'}
                error={errors.model}
              >
                {isPartsOrAccessories ? (
                  <input value={form.model} onChange={(event) => update('model', event.target.value)} placeholder="مثال: ياماها R1 موديل 2023" className={inputClass(errors.model)} />
                ) : (
                  <input type="number" inputMode="numeric" value={form.model} onChange={(event) => update('model', event.target.value)} placeholder="مثال: 2022" className={inputClass(errors.model)} />
                )}
              </Field>

              <Field label="السعر بالدينار العراقي" error={errors.price}>
                <input type="number" inputMode="numeric" value={form.price} onChange={(event) => update('price', event.target.value)} placeholder="مثال: 5500000" className={inputClass(errors.price)} />
              </Field>

              <div>
                <span className="block text-sm font-bold text-[#0D2545] mb-1.5">صورة واحدة للدراجة أو المنتج</span>
                <input ref={galleryRef} type="file" accept="image/jpeg,image/png,image/webp" onChange={handleImage} className="hidden" />
                <input ref={cameraRef} type="file" accept="image/jpeg,image/png,image/webp" capture="environment" onChange={handleImage} className="hidden" />

                {form.images.length === 1 ? (
                  <div className="relative rounded-2xl overflow-hidden border border-slate-200 bg-slate-50">
                    <img src={form.images[0].url} alt={submittedTitle || form.title || 'معاينة الصورة'} className="w-full h-56 object-contain bg-white" />
                    <div className="absolute inset-x-2 bottom-2 flex gap-2">
                      <button type="button" disabled={isUploading} onClick={() => galleryRef.current?.click()} className="flex-1 h-10 rounded-xl bg-black/70 text-white text-sm font-bold flex items-center justify-center gap-2">
                        <RefreshCw className="w-4 h-4" /> استبدال
                      </button>
                      <button type="button" onClick={removeImage} className="h-10 w-10 rounded-xl bg-red-600 text-white flex items-center justify-center">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-2">
                    <button type="button" disabled={isUploading} onClick={() => galleryRef.current?.click()} className="h-24 rounded-2xl border-2 border-dashed border-slate-300 bg-slate-50 text-[#0D2545] text-sm font-bold flex flex-col items-center justify-center gap-2">
                      {isUploading ? <Loader2 className="w-6 h-6 animate-spin text-[#F96B11]" /> : <ImagePlus className="w-6 h-6 text-slate-500" />}
                      من المعرض
                    </button>
                    <button type="button" disabled={isUploading} onClick={() => cameraRef.current?.click()} className="h-24 rounded-2xl border-2 border-dashed border-slate-300 bg-slate-50 text-[#0D2545] text-sm font-bold flex flex-col items-center justify-center gap-2">
                      {isUploading ? <Loader2 className="w-6 h-6 animate-spin text-[#F96B11]" /> : <ImagePlus className="w-6 h-6 text-slate-500" />}
                      من الكاميرا
                    </button>
                  </div>
                )}
                {errors.images && <p className="mt-1 text-xs text-red-600">{errors.images}</p>}
              </div>
            </div>

            <div className="p-4 border-t border-slate-100 bg-white pb-safe">
              {!isOnline && <p className="mb-2 text-xs text-center font-bold text-amber-800">الإضافة تحتاج اتصالًا بالإنترنت.</p>}
              <button type="submit" disabled={!isOnline || isSubmitting || isUploading} className="w-full h-12 rounded-xl bg-[#F96B11] text-white font-extrabold flex items-center justify-center gap-2 disabled:opacity-60">
                {isSubmitting ? <><Loader2 className="w-5 h-5 animate-spin" /> جاري الإرسال...</> : 'إرسال للمراجعة'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

function Field({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-sm font-bold text-[#0D2545] mb-1.5">{label}</label>
      {children}
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  );
}

function inputClass(error?: string) {
  return `w-full h-11 px-3.5 rounded-xl border bg-white text-sm text-[#0D2545] placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#F96B11] ${error ? 'border-red-400' : 'border-slate-200'}`;
}
