import React, { useEffect, useRef, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import {
  AlertTriangle,
  ArrowRight,
  Calendar,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Edit3,
  Film,
  Flag,
  Heart,
  KeyRound,
  Layers,
  Loader2,
  MapPin,
  MessageCircle,
  Phone,
  Share2,
  ShieldAlert,
  Tag,
  Trash2,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import {
  formatArabicDate,
  formatPriceIQD,
  IRAQI_GOVERNORATES,
  Listing,
  toWhatsAppInternational,
} from '../types';
import {
  deleteListingApi,
  getListingContactUrl,
  resolveListingContactTarget,
  getLastKnownServerOnline,
  getOwnerTokenForListing,
  saveOwnership,
  submitReportApi,
  subscribeServerConnectivity,
  updateListingFields,
  updateListingStatus,
  verifyListingOwnerCode,
} from '../utils/api';
import { ProgressiveImage } from './BrandLogo';

export function ListingDetailsView({
  listing: initialListing,
  initialIsOwner,
  isFavorite,
  onToggleFavorite,
  onBack,
  onUpdated,
  onDeleted,
}: {
  listing: Listing;
  initialIsOwner: boolean;
  isFavorite: boolean;
  onToggleFavorite: (id: number) => void;
  onBack: () => void;
  onUpdated: (updated: Listing) => void;
  onDeleted: (id: number) => void;
}) {
  const [listing, setListing] = useState<Listing>(initialListing);
  const [isOwner, setIsOwner] = useState<boolean>(initialIsOwner);
  const [activeMediaIdx, setActiveMediaIdx] = useState(0);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [zoomed, setZoomed] = useState(false);
  const [shareToast, setShareToast] = useState<string | null>(null);

  // Swipe gallery state
  const [dragOffset, setDragOffset] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const startXRef = useRef<number | null>(null);
  const didDragRef = useRef(false);

  // Owner code unlock
  const [showOwnerCodeBox, setShowOwnerCodeBox] = useState(false);
  const [ownerCodeInput, setOwnerCodeInput] = useState('');
  const [ownerCodeError, setOwnerCodeError] = useState<string | null>(null);
  const [verifyingOwner, setVerifyingOwner] = useState(false);

  // Owner edit / status / delete
  const [statusLoading, setStatusLoading] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(listing.title);
  const [editBrand, setEditBrand] = useState(listing.brand || '');
  const [editEngineCc, setEditEngineCc] = useState(
    listing.engine_cc ? String(listing.engine_cc) : ''
  );
  const [editMotorWatts, setEditMotorWatts] = useState(
    listing.motor_watts ? String(listing.motor_watts) : ''
  );
  const [editPrice, setEditPrice] = useState(String(listing.price_iqd));
  const [editNegotiable, setEditNegotiable] = useState(listing.negotiable);
  const [editGov, setEditGov] = useState(listing.governorate);
  const [editArea, setEditArea] = useState(listing.area);
  const [editPhone, setEditPhone] = useState(listing.phone || '');
  const [editDesc, setEditDesc] = useState(listing.description);
  const [editKeywords, setEditKeywords] = useState(listing.keywords || '');
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Report modal
  const [reportOpen, setReportOpen] = useState(false);
  const [reportReason, setReportReason] = useState('إعلان وهمي أو مضلل');
  const [reportDetails, setReportDetails] = useState('');
  const [reportSubmitting, setReportSubmitting] = useState(false);
  const [reportResult, setReportResult] = useState<string | null>(null);
  const [reportError, setReportError] = useState<string | null>(null);

  const [isOnline, setIsOnline] = useState(() => getLastKnownServerOnline());
  const [videoErrored, setVideoErrored] = useState(false);

  useEffect(() => {
    return subscribeServerConnectivity((on) => {
      setIsOnline(on);
      if (on) setVideoErrored(false);
    });
  }, []);

  useEffect(() => {
    setListing(initialListing);
    setIsOwner(initialIsOwner);
    setActiveMediaIdx(0);
    setVideoErrored(false);
  }, [initialListing, initialIsOwner]);

  const orderedImages = React.useMemo(() => {
    const imgs = [...listing.images];
    imgs.sort((a, b) => Number(b.isCover) - Number(a.isCover));
    return imgs;
  }, [listing.images]);

  const mediaItems = React.useMemo(() => {
    const items: Array<{ type: 'image' | 'video'; url: string }> = orderedImages.map(
      (img) => ({ type: 'image', url: img.url })
    );
    if (listing.video_url) {
      items.push({ type: 'video', url: listing.video_url });
    }
    return items;
  }, [orderedImages, listing.video_url]);

  const totalMedia = mediaItems.length;

  const getAuth = () => ({
    ownerToken: getOwnerTokenForListing(listing.id),
  });

  const handleShare = async () => {
    const url = `${window.location.origin}/?listing=${listing.id}`;
    if (navigator.share) {
      try {
        await navigator.share({
          title: `${listing.title} — دراجتي`,
          text: `${listing.title} في ${listing.governorate} بسعر ${formatPriceIQD(
            listing.price_iqd
          )} دينار عراقي`,
          url,
        });
        return;
      } catch {
        // Fallback to clipboard
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      setShareToast('تم نسخ رابط المنشور');
    } catch {
      setShareToast('رابط المنشور جاهز في شريط العنوان');
    }
    window.setTimeout(() => setShareToast(null), 2500);
  };

  const handleVerifyOwnerCode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ownerCodeInput.trim()) return;
    setVerifyingOwner(true);
    setOwnerCodeError(null);
    try {
      const { ownerToken } = await verifyListingOwnerCode(
        listing.id,
        ownerCodeInput.trim()
      );
      saveOwnership({
        listingId: listing.id,
        ownerToken,
        ownerCode: ownerCodeInput.trim().toUpperCase(),
        title: listing.title,
        createdAt: listing.created_at,
      });
      setIsOwner(true);
      setShowOwnerCodeBox(false);
    } catch (err: any) {
      setOwnerCodeError(err?.message || 'كود المالك غير صحيح.');
    } finally {
      setVerifyingOwner(false);
    }
  };

  const handleToggleSold = async () => {
    if (statusLoading) return;
    setStatusLoading(true);
    try {
      const nextStatus = listing.status === 'sold' ? 'approved' : 'sold';
      const res = await updateListingStatus(listing.id, nextStatus, getAuth());
      setListing(res.listing);
      onUpdated(res.listing);
    } catch (err: any) {
      setShareToast(err?.message || 'تعذر تحديث الحالة.');
      window.setTimeout(() => setShareToast(null), 3000);
    } finally {
      setStatusLoading(false);
    }
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    setEditSaving(true);
    setEditError(null);
    try {
      const res = await updateListingFields(
        listing.id,
        {
          title: editTitle.trim(),
          brand: editBrand.trim(),
          engine_cc: editEngineCc.trim() ? Number(editEngineCc.trim()) : null,
          motor_watts: editMotorWatts.trim() ? Number(editMotorWatts.trim()) : null,
          price_iqd: Number(editPrice),
          negotiable: editNegotiable,
          governorate: editGov,
          area: editArea.trim(),
          phone: editPhone.trim(),
          description: editDesc.trim(),
          keywords: editKeywords.trim(),
        },
        getAuth()
      );
      setListing(res.listing);
      onUpdated(res.listing);
      setEditing(false);
    } catch (err: any) {
      setEditError(err?.message || 'تعذر حفظ التعديلات.');
    } finally {
      setEditSaving(false);
    }
  };

  const handleDeleteListing = async () => {
    setDeleting(true);
    try {
      await deleteListingApi(listing.id, getAuth());
      onDeleted(listing.id);
    } catch (err: any) {
      setShareToast(err?.message || 'تعذر حذف المنشور.');
      setDeleting(false);
    }
  };

  const handleSubmitReport = async (e: React.FormEvent) => {
    e.preventDefault();
    setReportSubmitting(true);
    setReportError(null);
    try {
      await submitReportApi(listing.id, reportReason, reportDetails.trim());
      setReportResult('تم استلام البلاغ بنجاح، ستقوم الإدارة بمراجعته.');
      setReportDetails('');
    } catch (err: any) {
      setReportError(err?.message || 'تعذر إرسال البلاغ.');
    } finally {
      setReportSubmitting(false);
    }
  };

  // Gallery drag handlers
  const onPointerDown = (e: React.PointerEvent) => {
    if (totalMedia <= 1) return;
    startXRef.current = e.clientX;
    didDragRef.current = false;
    setIsDragging(true);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (startXRef.current === null) return;
    const delta = e.clientX - startXRef.current;
    if (Math.abs(delta) > 6) didDragRef.current = true;
    setDragOffset(Math.max(-160, Math.min(160, delta)));
  };
  const onPointerEnd = () => {
    if (startXRef.current === null) return;
    if (dragOffset < -45) {
      setActiveMediaIdx((p) => (p + 1) % totalMedia);
    } else if (dragOffset > 45) {
      setActiveMediaIdx((p) => (p - 1 + totalMedia) % totalMedia);
    }
    startXRef.current = null;
    setIsDragging(false);
    setDragOffset(0);
  };

  const whatsappUrl = listing.phone
    ? `https://wa.me/${toWhatsAppInternational(
        listing.phone
      )}?text=${encodeURIComponent(
        `مرحباً، أستفسر عن إعلانك في دراجتي: ${listing.title} (${formatPriceIQD(
          listing.price_iqd
        )} دينار عراقي)`
      )}`
    : getListingContactUrl(listing.id, 'whatsapp');
  const callUrl = listing.phone
    ? `tel:${listing.phone}`
    : getListingContactUrl(listing.id, 'call');

  const handlePublicContact = async (
    event: React.MouseEvent<HTMLAnchorElement>,
    channel: 'call' | 'whatsapp'
  ) => {
    if (listing.phone) return;
    event.preventDefault();

    const isNative = Capacitor.isNativePlatform();
    const popup =
      channel === 'whatsapp' && !isNative
        ? window.open('', '_blank')
        : null;

    try {
      const target = await resolveListingContactTarget(listing.id, channel);
      if (popup) {
        popup.opener = null;
        popup.location.replace(target);
      } else {
        window.location.assign(target);
      }
    } catch (error) {
      popup?.close();
      setShareToast(
        error instanceof Error ? error.message : 'تعذر فتح وسيلة التواصل.'
      );
      window.setTimeout(() => setShareToast(null), 3000);
    }
  };

  return (
    <div className="min-h-screen bg-[#F4F6F9] pb-28">
      {/* Compact Top Bar */}
      <header className="sticky top-0 z-30 bg-[#0D2545] text-white shadow-sm">
        <div className="max-w-5xl mx-auto px-4 h-14 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={onBack}
            className="min-w-[44px] h-10 px-2 -mr-2 rounded-xl hover:bg-white/10 inline-flex items-center gap-1.5 text-sm font-bold cursor-pointer"
          >
            <ArrowRight className="w-5 h-5" />
            <span>رجوع</span>
          </button>

          <h1 className="text-sm sm:text-base font-bold truncate max-w-[55%]">
            {listing.title}
          </h1>

          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => onToggleFavorite(listing.id)}
              aria-label="المفضلة"
              className="w-10 h-10 rounded-xl hover:bg-white/10 flex items-center justify-center cursor-pointer"
            >
              <Heart
                className={`w-5 h-5 ${
                  isFavorite ? 'fill-[#F96B11] text-[#F96B11]' : 'text-white'
                }`}
              />
            </button>
            <button
              type="button"
              onClick={handleShare}
              aria-label="مشاركة الرابط"
              className="w-10 h-10 rounded-xl hover:bg-white/10 flex items-center justify-center cursor-pointer"
            >
              <Share2 className="w-5 h-5" />
            </button>
          </div>
        </div>
      </header>

      {shareToast && (
        <div className="fixed top-16 inset-x-0 z-50 flex justify-center px-4 pointer-events-none">
          <div className="bg-[#0D2545] text-white text-xs sm:text-sm font-bold px-4 py-2.5 rounded-xl shadow-lg">
            {shareToast}
          </div>
        </div>
      )}

      <main className="max-w-5xl mx-auto px-4 py-4 sm:py-6 space-y-5">
        {/* Status Banners */}
        {listing.status === 'pending' && (
          <div className="p-4 rounded-2xl bg-amber-50 border border-amber-200 text-amber-900 flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
            <div className="text-sm">
              <p className="font-bold">هذا المنشور قيد المراجعة من الإدارة</p>
              <p className="text-amber-800/90 mt-0.5">
                لن يظهر للزوار في الصفحة الرئيسية أو الأقسام إلا بعد اعتماده من الإدارة.
              </p>
            </div>
          </div>
        )}

        {listing.status === 'sold' && (
          <div className="p-4 rounded-2xl bg-[#0D2545] text-white flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <CheckCircle2 className="w-6 h-6 text-[#F96B11] shrink-0" />
              <div>
                <p className="font-extrabold text-base">تم البيع</p>
                <p className="text-xs text-slate-300">
                  أعلن صاحب المنشور أو الإدارة عن بيع هذه الدراجة.
                </p>
              </div>
            </div>
          </div>
        )}

        {listing.is_demo && (
          <div className="px-4 py-2.5 rounded-xl bg-slate-200/70 text-slate-700 text-xs sm:text-sm font-medium flex items-center justify-between">
            <span>ملاحظة: هذا الإعلان ضمن البيانات التجريبية التوضيحية.</span>
          </div>
        )}

        {/* Two-column responsive layout on desktop */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Gallery Column */}
          <div className="lg:col-span-7 space-y-3">
            <div
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerEnd}
              onPointerCancel={onPointerEnd}
              className="relative w-full aspect-[4/3] rounded-2xl overflow-hidden bg-slate-900 shadow-sm select-none touch-pan-y"
            >
              <div
                dir="ltr"
                className="flex h-full will-change-transform"
                style={{
                  transform: `translate3d(calc(-${activeMediaIdx * 100}% + ${dragOffset}px), 0, 0)`,
                  transition: isDragging
                    ? 'none'
                    : 'transform 280ms cubic-bezier(0.16, 1, 0.3, 1)',
                }}
              >
                {mediaItems.map((media, idx) => (
                  <div
                    key={`${media.url}-${idx}`}
                    dir="rtl"
                    className="w-full h-full shrink-0 relative flex items-center justify-center bg-slate-950"
                  >
                    {media.type === 'image' ? (
                      <button
                        type="button"
                        onClick={() => {
                          if (!didDragRef.current) {
                            setZoomed(false);
                            setLightboxOpen(true);
                          }
                        }}
                        aria-label="تكبير الصورة"
                        className="w-full h-full cursor-zoom-in block"
                      >
                        <ProgressiveImage
                          src={media.url}
                          alt={`${listing.title} - صورة ${idx + 1}`}
                          eager={idx === 0}
                          containerClassName="w-full h-full"
                          className="object-cover"
                        />
                      </button>
                    ) : videoErrored && !isOnline ? (
                      <div className="w-full h-full flex flex-col items-center justify-center bg-slate-900 text-slate-300 p-4 text-center gap-2">
                        <Film className="w-8 h-8 text-slate-400" />
                        <p className="text-xs font-bold">هذا المحتوى يحتاج اتصالًا بالإنترنت</p>
                      </div>
                    ) : (
                      <video
                        src={media.url}
                        controls
                        onError={() => setVideoErrored(true)}
                        className="w-full h-full object-contain bg-black"
                      />
                    )}
                  </div>
                ))}
              </div>

              {mediaItems[activeMediaIdx]?.type === 'image' && (
                <button
                  type="button"
                  onClick={() => {
                    setZoomed(false);
                    setLightboxOpen(true);
                  }}
                  aria-label="تكبير الصورة"
                  className="absolute bottom-3 left-3 h-9 px-3 rounded-xl bg-black/55 hover:bg-black/75 text-white text-xs font-bold inline-flex items-center gap-1.5 backdrop-blur-xs cursor-pointer"
                >
                  <ZoomIn className="w-4 h-4" />
                  <span>تكبير</span>
                </button>
              )}

              {totalMedia > 1 && (
                <>
                  <button
                    type="button"
                    onClick={() =>
                      setActiveMediaIdx((p) => (p - 1 + totalMedia) % totalMedia)
                    }
                    aria-label="الصورة السابقة"
                    className="hidden sm:flex absolute right-3 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-black/45 hover:bg-black/65 text-white items-center justify-center cursor-pointer"
                  >
                    <ChevronRight className="w-5 h-5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveMediaIdx((p) => (p + 1) % totalMedia)}
                    aria-label="الصورة التالية"
                    className="hidden sm:flex absolute left-3 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-black/45 hover:bg-black/65 text-white items-center justify-center cursor-pointer"
                  >
                    <ChevronLeft className="w-5 h-5" />
                  </button>
                  <span className="absolute bottom-3 right-3 px-2.5 py-1 rounded-lg bg-black/55 text-white text-xs font-bold tabular-nums">
                    {activeMediaIdx + 1} / {totalMedia}
                  </span>
                </>
              )}
            </div>

            {/* Thumbnail Strip */}
            {totalMedia > 1 && (
              <div className="flex items-center gap-2 overflow-x-auto no-scrollbar py-1">
                {mediaItems.map((media, idx) => (
                  <button
                    key={`${media.url}-thumb-${idx}`}
                    type="button"
                    onClick={() => setActiveMediaIdx(idx)}
                    className={`w-16 h-16 rounded-xl overflow-hidden shrink-0 border-2 transition-all cursor-pointer ${
                      idx === activeMediaIdx
                        ? 'border-[#F96B11] ring-2 ring-[#F96B11]/25'
                        : 'border-transparent opacity-75 hover:opacity-100'
                    }`}
                  >
                    {media.type === 'image' ? (
                      <ProgressiveImage
                        src={media.url}
                        alt=""
                        containerClassName="w-full h-full"
                      />
                    ) : (
                      <div className="w-full h-full bg-[#0D2545] text-white flex flex-col items-center justify-center text-[10px] font-bold">
                        <Film className="w-5 h-5 mb-0.5 text-[#F96B11]" />
                        <span>فيديو</span>
                      </div>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Info & Contact Column */}
          <div className="lg:col-span-5 space-y-4">
            <div className="bg-white rounded-2xl p-5 shadow-sm border border-slate-200/70 space-y-4">
              <div>
                <h2 className="text-xl sm:text-2xl font-extrabold text-[#0D2545] leading-snug">
                  {listing.title}
                </h2>
                <div className="mt-2 flex items-baseline gap-2 flex-wrap">
                  <span className="text-2xl sm:text-3xl font-extrabold text-[#F96B11] tabular-nums">
                    {formatPriceIQD(listing.price_iqd)}
                  </span>
                  <span className="text-sm font-bold text-[#F96B11]">
                    دينار عراقي
                  </span>
                  {listing.negotiable && (
                    <span className="text-xs font-bold text-slate-600">
                      · قابل للتفاوض
                    </span>
                  )}
                </div>
              </div>

              {/* Clean Specs List */}
              <div className="grid grid-cols-2 gap-3 pt-3 border-t border-slate-100 text-sm">
                <div className="flex items-center gap-2 text-slate-700">
                  <MapPin className="w-4 h-4 text-slate-400 shrink-0" />
                  <div>
                    <span className="text-xs text-slate-400 block">المحافظة</span>
                    <span className="font-bold text-[#0D2545]">
                      {listing.governorate}
                    </span>
                  </div>
                </div>

                {listing.area && (
                  <div className="flex items-center gap-2 text-slate-700">
                    <MapPin className="w-4 h-4 text-slate-400 shrink-0" />
                    <div>
                      <span className="text-xs text-slate-400 block">المنطقة</span>
                      <span className="font-bold text-[#0D2545]">
                        {listing.area}
                      </span>
                    </div>
                  </div>
                )}

                <div className="flex items-center gap-2 text-slate-700">
                  <Layers className="w-4 h-4 text-slate-400 shrink-0" />
                  <div>
                    <span className="text-xs text-slate-400 block">القسم</span>
                    <span className="font-bold text-[#0D2545]">
                      {listing.category_name}
                    </span>
                  </div>
                </div>

                {listing.brand && (
                  <div className="flex items-center gap-2 text-slate-700">
                    <Tag className="w-4 h-4 text-slate-400 shrink-0" />
                    <div>
                      <span className="text-xs text-slate-400 block">الماركة</span>
                      <span className="font-bold text-[#0D2545]">
                        {listing.brand}
                      </span>
                    </div>
                  </div>
                )}

                {listing.model_year && (
                  <div className="flex items-center gap-2 text-slate-700">
                    <Calendar className="w-4 h-4 text-slate-400 shrink-0" />
                    <div>
                      <span className="text-xs text-slate-400 block">الموديل</span>
                      <span className="font-bold text-[#0D2545] tabular-nums">
                        {listing.model_year}
                      </span>
                    </div>
                  </div>
                )}

                {listing.engine_cc && (
                  <div className="flex items-center gap-2 text-slate-700">
                    <Layers className="w-4 h-4 text-slate-400 shrink-0" />
                    <div>
                      <span className="text-xs text-slate-400 block">سعة المحرك</span>
                      <span className="font-bold text-[#0D2545] tabular-nums">
                        {listing.engine_cc} سي سي
                      </span>
                    </div>
                  </div>
                )}

                {listing.motor_watts && (
                  <div className="flex items-center gap-2 text-slate-700">
                    <Layers className="w-4 h-4 text-slate-400 shrink-0" />
                    <div>
                      <span className="text-xs text-slate-400 block">قدرة المحرك الكهربائي</span>
                      <span className="font-bold text-[#0D2545] tabular-nums">
                        {listing.motor_watts} واط
                      </span>
                    </div>
                  </div>
                )}

                <div className="flex items-center gap-2 text-slate-700">
                  <Tag className="w-4 h-4 text-slate-400 shrink-0" />
                  <div>
                    <span className="text-xs text-slate-400 block">الحالة</span>
                    <span className="font-bold text-[#0D2545]">
                      {listing.condition === 'new' ? 'جديدة' : 'مستعملة'}
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-2 text-slate-700">
                  <Calendar className="w-4 h-4 text-slate-400 shrink-0" />
                  <div>
                    <span className="text-xs text-slate-400 block">
                      تاريخ النشر
                    </span>
                    <span className="font-bold text-[#0D2545]">
                      {formatArabicDate(listing.created_at)}
                    </span>
                  </div>
                </div>
              </div>

              {/* Description */}
              <div className="pt-3 border-t border-slate-100">
                <h3 className="text-sm font-extrabold text-[#0D2545] mb-1.5">
                  التفاصيل والوصف
                </h3>
                <p className="text-sm text-slate-700 leading-relaxed whitespace-pre-line">
                  {listing.description}
                </p>
              </div>

              {/* Direct Contact Actions */}
              <div className="pt-3 border-t border-slate-100 grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <a
                  href={callUrl}
                  onClick={(event) => void handlePublicContact(event, 'call')}
                  className="h-12 rounded-xl bg-[#0D2545] hover:bg-[#163661] text-white font-bold text-sm flex items-center justify-center gap-2 transition-colors"
                >
                  <Phone className="w-4 h-4" />
                  <span>{listing.phone ? `اتصال (${listing.phone})` : 'اتصال'}</span>
                </a>

                <a
                  href={whatsappUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(event) => void handlePublicContact(event, 'whatsapp')}
                  className="h-12 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-sm flex items-center justify-center gap-2 transition-colors"
                >
                  <MessageCircle className="w-4 h-4" />
                  <span>مراسلة واتساب</span>
                </a>
              </div>

              <div className="flex items-center justify-between pt-1">
                <button
                  type="button"
                  onClick={handleShare}
                  className="text-xs font-bold text-[#0D2545] hover:text-[#F96B11] inline-flex items-center gap-1.5 py-2 cursor-pointer"
                >
                  <Share2 className="w-4 h-4" />
                  <span>مشاركة رابط المنشور</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setReportResult(null);
                    setReportError(null);
                    setReportOpen(true);
                  }}
                  className="text-xs font-bold text-slate-500 hover:text-red-600 inline-flex items-center gap-1.5 py-2 cursor-pointer"
                >
                  <Flag className="w-4 h-4" />
                  <span>الإبلاغ عن منشور مخالف</span>
                </button>
              </div>
            </div>

            {/* Owner Management Panel */}
            <div className="bg-white rounded-2xl p-4 shadow-sm border border-slate-200/70">
              {isOwner ? (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-extrabold text-[#0D2545]">
                      إدارة المنشور
                    </h3>
                    <span className="text-xs text-slate-500">
                      {listing.status === 'pending'
                        ? 'قيد المراجعة'
                        : listing.status === 'sold'
                          ? 'تم البيع'
                          : 'منشور'}
                    </span>
                  </div>

                  {!editing ? (
                    <div className="flex flex-wrap gap-2">
                      {(listing.status === 'approved' ||
                        listing.status === 'sold') && (
                        <button
                          type="button"
                          disabled={statusLoading}
                          onClick={handleToggleSold}
                          className={`flex-1 min-w-[140px] h-10 px-3 rounded-xl font-bold text-xs inline-flex items-center justify-center gap-1.5 transition-colors cursor-pointer ${
                            listing.status === 'sold'
                              ? 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border border-emerald-200'
                              : 'bg-[#F96B11] text-white hover:bg-[#e55d09]'
                          }`}
                        >
                          {statusLoading ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            <Check className="w-4 h-4" />
                          )}
                          <span>
                            {listing.status === 'sold'
                              ? 'إعادة تفعيل الإعلان'
                              : 'تحديد كـ تم البيع'}
                          </span>
                        </button>
                      )}

                      <button
                        type="button"
                        onClick={() => {
                          setEditTitle(listing.title);
                          setEditBrand(listing.brand || '');
                          setEditEngineCc(listing.engine_cc ? String(listing.engine_cc) : '');
                          setEditMotorWatts(listing.motor_watts ? String(listing.motor_watts) : '');
                          setEditPrice(String(listing.price_iqd));
                          setEditNegotiable(listing.negotiable);
                          setEditGov(listing.governorate);
                          setEditArea(listing.area);
                          setEditPhone(listing.phone || '');
                          setEditDesc(listing.description);
                          setEditKeywords(listing.keywords || '');
                          setEditing(true);
                        }}
                        className="h-10 px-4 rounded-xl bg-slate-100 hover:bg-slate-200 text-[#0D2545] font-bold text-xs inline-flex items-center gap-1.5 cursor-pointer"
                      >
                        <Edit3 className="w-4 h-4" />
                        <span>تعديل</span>
                      </button>

                      {!confirmDelete ? (
                        <button
                          type="button"
                          onClick={() => setConfirmDelete(true)}
                          className="h-10 px-4 rounded-xl bg-red-50 hover:bg-red-100 text-red-700 font-bold text-xs inline-flex items-center gap-1.5 cursor-pointer"
                        >
                          <Trash2 className="w-4 h-4" />
                          <span>حذف</span>
                        </button>
                      ) : (
                        <div className="flex items-center gap-2 w-full pt-1">
                          <button
                            type="button"
                            disabled={deleting}
                            onClick={handleDeleteListing}
                            className="h-10 px-4 rounded-xl bg-red-600 text-white font-bold text-xs cursor-pointer"
                          >
                            {deleting ? 'جاري الحذف...' : 'تأكيد الحذف النهائي'}
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmDelete(false)}
                            className="h-10 px-3 rounded-xl bg-slate-100 text-slate-700 font-bold text-xs cursor-pointer"
                          >
                            إلغاء
                          </button>
                        </div>
                      )}
                    </div>
                  ) : (
                    <form onSubmit={handleSaveEdit} className="space-y-3 pt-1">
                      {editError && (
                        <p className="text-xs text-red-600 font-bold">{editError}</p>
                      )}
                      <input
                        type="text"
                        value={editTitle}
                        onChange={(e) => setEditTitle(e.target.value)}
                        placeholder="الاسم"
                        className="w-full h-10 px-3 rounded-xl border border-slate-200 text-sm"
                      />
                      <div className="grid grid-cols-2 gap-2">
                        <input
                          type="text"
                          value={editBrand}
                          onChange={(e) => setEditBrand(e.target.value)}
                          placeholder="الماركة (اختياري)"
                          className="w-full h-10 px-3 rounded-xl border border-slate-200 text-sm"
                        />
                        {listing.category_slug === 'ebikes' ? (
                          <input
                            type="number"
                            value={editMotorWatts}
                            onChange={(e) => setEditMotorWatts(e.target.value)}
                            placeholder="قدرة المحرك (واط)"
                            className="w-full h-10 px-3 rounded-xl border border-slate-200 text-sm tabular-nums"
                          />
                        ) : (
                          <input
                            type="number"
                            value={editEngineCc}
                            onChange={(e) => setEditEngineCc(e.target.value)}
                            placeholder="سعة المحرك (سي سي)"
                            className="w-full h-10 px-3 rounded-xl border border-slate-200 text-sm tabular-nums"
                          />
                        )}
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <input
                          type="number"
                          value={editPrice}
                          onChange={(e) => setEditPrice(e.target.value)}
                          placeholder="السعر"
                          className="w-full h-10 px-3 rounded-xl border border-slate-200 text-sm tabular-nums"
                        />
                        <select
                          value={editGov}
                          onChange={(e) => setEditGov(e.target.value)}
                          className="w-full h-10 px-3 rounded-xl border border-slate-200 text-sm bg-white"
                        >
                          {IRAQI_GOVERNORATES.map((g) => (
                            <option key={g} value={g}>
                              {g}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <input
                          type="text"
                          value={editArea}
                          onChange={(e) => setEditArea(e.target.value)}
                          placeholder="المنطقة"
                          className="w-full h-10 px-3 rounded-xl border border-slate-200 text-sm"
                        />
                        <input
                          type="tel"
                          dir="ltr"
                          value={editPhone}
                          onChange={(e) => setEditPhone(e.target.value)}
                          placeholder="رقم الهاتف"
                          className="w-full h-10 px-3 rounded-xl border border-slate-200 text-sm text-right"
                        />
                      </div>
                      <label className="inline-flex items-center gap-2 text-xs font-bold text-[#0D2545]">
                        <input
                          type="checkbox"
                          checked={editNegotiable}
                          onChange={(e) => setEditNegotiable(e.target.checked)}
                          className="accent-[#F96B11]"
                        />
                        قابل للتفاوض
                      </label>
                      <textarea
                        rows={3}
                        value={editDesc}
                        onChange={(e) => setEditDesc(e.target.value)}
                        className="w-full p-3 rounded-xl border border-slate-200 text-sm"
                      />
                      <input
                        type="text"
                        value={editKeywords}
                        onChange={(e) => setEditKeywords(e.target.value)}
                        placeholder="كلمات بديلة للبحث (اختياري)"
                        className="w-full h-10 px-3 rounded-xl border border-slate-200 text-sm"
                      />
                      <div className="flex items-center gap-2">
                        <button
                          type="submit"
                          disabled={editSaving}
                          className="h-10 px-4 rounded-xl bg-[#0D2545] text-white font-bold text-xs cursor-pointer"
                        >
                          {editSaving ? 'جاري الحفظ...' : 'حفظ التعديلات'}
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditing(false)}
                          className="h-10 px-4 rounded-xl bg-slate-100 text-slate-700 font-bold text-xs cursor-pointer"
                        >
                          إلغاء
                        </button>
                      </div>
                    </form>
                  )}
                </div>
              ) : (
                <div>
                  <button
                    type="button"
                    onClick={() => setShowOwnerCodeBox((v) => !v)}
                    className="w-full flex items-center justify-between text-xs font-bold text-slate-600 hover:text-[#0D2545] py-1 cursor-pointer"
                  >
                    <span className="inline-flex items-center gap-1.5">
                      <KeyRound className="w-4 h-4 text-slate-400" />
                      هل أنت صاحب المنشور؟ إدارة المنشور بكود المالك
                    </span>
                    <ChevronLeft
                      className={`w-4 h-4 transition-transform ${
                        showOwnerCodeBox ? '-rotate-90' : ''
                      }`}
                    />
                  </button>

                  {showOwnerCodeBox && (
                    <form
                      onSubmit={handleVerifyOwnerCode}
                      className="mt-3 flex flex-col sm:flex-row gap-2"
                    >
                      <input
                        type="text"
                        dir="ltr"
                        value={ownerCodeInput}
                        onChange={(e) => setOwnerCodeInput(e.target.value)}
                        placeholder="أدخل كود المالك (8 أحرف)"
                        className="flex-1 h-10 px-3 rounded-xl border border-slate-200 text-sm text-center uppercase tracking-widest"
                      />
                      <button
                        type="submit"
                        disabled={verifyingOwner}
                        className="h-10 px-4 rounded-xl bg-[#0D2545] text-white text-xs font-bold cursor-pointer"
                      >
                        {verifyingOwner ? 'تحقق...' : 'تفعيل إدارة المنشور'}
                      </button>
                    </form>
                  )}
                  {ownerCodeError && (
                    <p className="mt-1.5 text-xs text-red-600 font-semibold">
                      {ownerCodeError}
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </main>

      {/* Fullscreen Zoomable Image Lightbox */}
      {lightboxOpen && mediaItems[activeMediaIdx]?.type === 'image' && (
        <div
          className="fixed inset-0 z-50 bg-black/95 flex flex-col"
          role="dialog"
          aria-modal="true"
        >
          <div className="flex items-center justify-between px-4 h-14 text-white shrink-0">
            <span className="text-xs font-bold tabular-nums">
              {activeMediaIdx + 1} / {totalMedia}
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setZoomed((z) => !z)}
                className="h-10 px-3 rounded-xl bg-white/10 hover:bg-white/20 text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer"
              >
                {zoomed ? (
                  <>
                    <ZoomOut className="w-4 h-4" />
                    <span>تصغير</span>
                  </>
                ) : (
                  <>
                    <ZoomIn className="w-4 h-4" />
                    <span>تكبير</span>
                  </>
                )}
              </button>
              <button
                type="button"
                onClick={() => setLightboxOpen(false)}
                aria-label="إغلاق"
                className="w-10 h-10 rounded-xl bg-white/10 hover:bg-white/20 flex items-center justify-center cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>

          <div
            className="flex-1 overflow-auto flex items-center justify-center p-4"
            onClick={() => setZoomed((z) => !z)}
          >
            <img
              src={mediaItems[activeMediaIdx].url}
              alt={listing.title}
              className={`transition-transform duration-200 select-none ${
                zoomed
                  ? 'scale-150 sm:scale-175 cursor-zoom-out'
                  : 'max-h-full max-w-full object-contain cursor-zoom-in'
              }`}
            />
          </div>
        </div>
      )}

      {/* Report Modal */}
      {reportOpen && (
        <div
          className="fixed inset-0 z-50 bg-[#0D2545]/60 backdrop-blur-xs flex items-center justify-center p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) setReportOpen(false);
          }}
        >
          <div className="w-full max-w-md bg-white rounded-2xl p-5 shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-extrabold text-[#0D2545] inline-flex items-center gap-2">
                <ShieldAlert className="w-5 h-5 text-red-600" />
                الإبلاغ عن منشور مخالف
              </h3>
              <button
                type="button"
                onClick={() => setReportOpen(false)}
                className="w-9 h-9 rounded-full hover:bg-slate-100 flex items-center justify-center cursor-pointer"
              >
                <X className="w-5 h-5 text-slate-500" />
              </button>
            </div>

            {reportResult ? (
              <div className="py-4 text-center space-y-3">
                <CheckCircle2 className="w-10 h-10 text-emerald-600 mx-auto" />
                <p className="text-sm font-bold text-[#0D2545]">{reportResult}</p>
                <button
                  type="button"
                  onClick={() => setReportOpen(false)}
                  className="px-6 h-10 rounded-xl bg-[#0D2545] text-white text-sm font-bold cursor-pointer"
                >
                  إغلاق
                </button>
              </div>
            ) : (
              <form onSubmit={handleSubmitReport} className="space-y-3">
                {reportError && (
                  <p className="text-xs text-red-600 font-bold">{reportError}</p>
                )}
                <div>
                  <label className="block text-xs font-bold text-slate-600 mb-1">
                    سبب البلاغ
                  </label>
                  <select
                    value={reportReason}
                    onChange={(e) => setReportReason(e.target.value)}
                    className="w-full h-11 px-3 rounded-xl border border-slate-200 text-sm bg-white"
                  >
                    <option value="إعلان وهمي أو مضلل">إعلان وهمي أو مضلل</option>
                    <option value="صور غير مطابقة أو مخالفة">صور غير مطابقة أو مخالفة</option>
                    <option value="سعر غير حقيقي أو احتيال">سعر غير حقيقي أو احتيال</option>
                    <option value="دراجة مباعة مسبقاً">دراجة مباعة مسبقاً</option>
                    <option value="محتوى مسيء أو مكرر">محتوى مسيء أو مكرر</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-600 mb-1">
                    تفاصيل إضافية (اختياري)
                  </label>
                  <textarea
                    rows={3}
                    value={reportDetails}
                    onChange={(e) => setReportDetails(e.target.value)}
                    placeholder="اكتب أي تفاصيل تساعد الإدارة على مراجعة البلاغ..."
                    className="w-full p-3 rounded-xl border border-slate-200 text-sm"
                  />
                </div>

                <div className="flex items-center gap-2 pt-1">
                  <button
                    type="submit"
                    disabled={reportSubmitting}
                    className="flex-1 h-11 rounded-xl bg-red-600 hover:bg-red-700 text-white font-bold text-sm cursor-pointer"
                  >
                    {reportSubmitting ? 'جاري الإرسال...' : 'إرسال البلاغ'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setReportOpen(false)}
                    className="h-11 px-4 rounded-xl bg-slate-100 text-slate-700 font-bold text-sm cursor-pointer"
                  >
                    إلغاء
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
