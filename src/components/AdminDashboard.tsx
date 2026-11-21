import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  BarChart3,
  Bell,
  BookOpen,
  Check,
  CheckCheck,
  Clock,
  Edit3,
  ExternalLink,
  Eye,
  FileText,
  Folder,
  HelpCircle,
  Home,
  Image as ImageIcon,
  ImagePlus,
  KeyRound,
  Layers,
  Link2,
  Loader2,
  LogOut,
  Menu,
  Plus,
  PlusCircle,
  RefreshCw,
  Search,
  Settings,
  ShieldCheck,
  Trash2,
  User,
  X,
  XCircle,
} from 'lucide-react';
import {
  AdminAuditLog,
  AdminNotification,
  AdminOverview,
  Category,
  formatArabicDate,
  formatPriceIQD,
  IRAQI_GOVERNORATES,
  Listing,
  ReportItem,
  SearchSynonym,
  SliderItem,
} from '../types';
import {
  clearAdminCsrfToken,
  createAdminListingApi,
  createAdminSynonym,
  createCategoryApi,
  createSliderApi,
  deleteAllDemoListingsApi,
  deleteAdminSynonym,
  deleteCategoryApi,
  deleteListingApi,
  deleteSliderApi,
  fetchAdminAuditLogs,
  fetchAdminAuthStatus,
  fetchAdminListings,
  fetchAdminNotifications,
  fetchAdminOverview,
  fetchAdminReports,
  fetchAdminSettings,
  fetchAdminSliders,
  fetchAdminSynonyms,
  fetchCategories,
  logoutAdminApi,
  markAllNotificationsReadApi,
  markNotificationReadApi,
  searchAdminApi,
  updateAdminPinApi,
  updateAdminSettings,
  updateAdminSynonym,
  updateCategoryApi,
  updateListingFields,
  updateListingStatus,
  updateReportStatusApi,
  updateSliderApi,
  uploadImagesApi,
  uploadVideoApi,
} from '../utils/api';
import { ProgressiveImage } from './BrandLogo';

type AdminSection =
  | 'overview'
  | 'listings'
  | 'pending'
  | 'rejected'
  | 'sliders'
  | 'categories'
  | 'synonyms'
  | 'reports'
  | 'notifications'
  | 'settings';

export function AdminDashboard({
  onBackToApp,
  onDataChanged,
  onInspectListing,
}: {
  onBackToApp: () => void;
  onDataChanged: () => void;
  onInspectListing: (listing: Listing) => void;
}) {
  const [authChecking, setAuthChecking] = useState(true);
  const [adminUser, setAdminUser] = useState<string | null>(null);

  // Navigation & Drawer
  const [activeSection, setActiveSection] = useState<AdminSection>('overview');
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Global Admin Search
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<{
    listings: Listing[];
    categories: Category[];
  } | null>(null);
  const [searching, setSearching] = useState(false);

  // Data States
  const [activityDays, setActivityDays] = useState<7 | 30>(7);
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [listings, setListings] = useState<Listing[]>([]);
  const [listingStatusFilter, setListingStatusFilter] = useState<string>('all');
  const [categories, setCategories] = useState<Category[]>([]);
  const [sliders, setSliders] = useState<SliderItem[]>([]);
  const [reports, setReports] = useState<ReportItem[]>([]);
  const [notifications, setNotifications] = useState<AdminNotification[]>([]);
  const [auditLogs, setAuditLogs] = useState<AdminAuditLog[]>([]);
  const [settings, setSettings] = useState<Record<string, string>>({});

  const [loadingData, setLoadingData] = useState(false);
  const [dataError, setDataError] = useState<string | null>(null);
  const [actionMsg, setActionMsg] = useState<string | null>(null);

  // Category Form State
  const [catName, setCatName] = useState('');
  const [catImage, setCatImage] = useState('');
  const [catIsParts, setCatIsParts] = useState(false);
  const [catSort, setCatSort] = useState('10');
  const [editingCatId, setEditingCatId] = useState<number | null>(null);
  const [catSaving, setCatSaving] = useState(false);

  // Slider Form State
  const [slideTitle, setSlideTitle] = useState('');
  const [slideSubtitle, setSlideSubtitle] = useState('');
  const [slideImage, setSlideImage] = useState('');
  const [slideLinkCatId, setSlideLinkCatId] = useState('');
  const [slideSort, setSlideSort] = useState('1');
  const [slideActive, setSlideActive] = useState(true);
  const [editingSlideId, setEditingSlideId] = useState<number | null>(null);
  const [slideSaving, setSlideSaving] = useState(false);

  // Settings Form State
  const [currentPinInput, setCurrentPinInput] = useState('');
  const [newPinInput, setNewPinInput] = useState('');
  const [savingSettings, setSavingSettings] = useState(false);
  const [savingPin, setSavingPin] = useState(false);

  // Synonym Dictionary State
  const [synonyms, setSynonyms] = useState<SearchSynonym[]>([]);
  const [knownBrands, setKnownBrands] = useState<string[]>([]);
  const [synSearchFilter, setSynSearchFilter] = useState('');
  const [editingSynId, setEditingSynId] = useState<number | null>(null);
  const [synTerm, setSynTerm] = useState('');
  const [synTargetType, setSynTargetType] = useState<
    'brand' | 'category' | 'keyword' | 'ambiguous'
  >('brand');
  const [synCanonicalValue, setSynCanonicalValue] = useState('');
  const [synCategoryId, setSynCategoryId] = useState('');
  const [synNotes, setSynNotes] = useState('');
  const [synIsActive, setSynIsActive] = useState(true);
  const [synOptions, setSynOptions] = useState<
    Array<{ label: string; categorySlug?: string; brand?: string; query?: string }>
  >([]);
  const [synSaving, setSynSaving] = useState(false);

  const notify = (msg: string) => {
    setActionMsg(msg);
    window.setTimeout(() => setActionMsg(null), 3000);
  };

  // Browsing Management / Listings Management State
  const [listingsTab, setListingsTab] = useState<'published' | 'hidden'>('published');
  const [listingsSearch, setListingsSearch] = useState('');
  const [listingsCatFilter, setListingsCatFilter] = useState('all');
  const [listingsGovFilter, setListingsGovFilter] = useState('all');

  const [addListingModalOpen, setAddListingModalOpen] = useState(false);
  const [editListingObj, setEditListingObj] = useState<Listing | null>(null);
  const [deleteListingTarget, setDeleteListingTarget] = useState<Listing | null>(null);

  // Listing Form Fields
  const [formTitle, setFormTitle] = useState('');
  const [formBrand, setFormBrand] = useState('');
  const [formCatId, setFormCatId] = useState('');
  const [formGov, setFormGov] = useState('بغداد');
  const [formArea, setFormArea] = useState('');
  const [formModelYear, setFormModelYear] = useState('2024');
  const [formEngineCc, setFormEngineCc] = useState('');
  const [formMotorWatts, setFormMotorWatts] = useState('');
  const [formCondition, setFormCondition] = useState<'new' | 'used'>('used');
  const [formPrice, setFormPrice] = useState('');
  const [formNegotiable, setFormNegotiable] = useState(false);
  const [formPhone, setFormPhone] = useState('');
  const [formDesc, setFormDesc] = useState('');
  const [formKeywords, setFormKeywords] = useState('');
  const [formImages, setFormImages] = useState<Array<{ url: string; isCover: boolean }>>([]);
  const [formVideoUrl, setFormVideoUrl] = useState<string | null>(null);
  const [formSaving, setFormSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [uploadingImg, setUploadingImg] = useState(false);
  const [uploadingVid, setUploadingVid] = useState(false);

  const handleOpenAddListing = () => {
    setFormTitle('');
    setFormBrand('');
    setFormCatId(categories[0] ? String(categories[0].id) : '');
    setFormGov('بغداد');
    setFormArea('');
    setFormModelYear('2024');
    setFormEngineCc('');
    setFormMotorWatts('');
    setFormCondition('used');
    setFormPrice('');
    setFormNegotiable(false);
    setFormPhone('');
    setFormDesc('');
    setFormKeywords('');
    setFormImages([]);
    setFormVideoUrl(null);
    setFormError(null);
    setEditListingObj(null);
    setAddListingModalOpen(true);
  };

  const handleOpenEditListing = (item: Listing) => {
    setEditListingObj(item);
    setFormTitle(item.title);
    setFormBrand(item.brand || '');
    setFormCatId(String(item.category_id));
    setFormGov(item.governorate);
    setFormArea(item.area || '');
    setFormModelYear(item.model_year ? String(item.model_year) : '');
    setFormEngineCc(item.engine_cc ? String(item.engine_cc) : '');
    setFormMotorWatts(item.motor_watts ? String(item.motor_watts) : '');
    setFormCondition(item.condition);
    setFormPrice(String(item.price_iqd));
    setFormNegotiable(item.negotiable);
    setFormPhone(item.phone);
    setFormDesc(item.description);
    setFormKeywords(item.keywords || '');
    setFormImages(item.images.map((i) => ({ url: i.url, isCover: i.isCover })));
    setFormVideoUrl(item.video_url);
    setFormError(null);
    setAddListingModalOpen(true);
  };

  const handleSaveListingSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (formSaving) return;
    setFormSaving(true);
    setFormError(null);
    try {
      const payload = {
        title: formTitle.trim(),
        brand: formBrand.trim(),
        category_id: Number(formCatId),
        governorate: formGov,
        area: formArea.trim(),
        model_year: formModelYear ? Number(formModelYear) : null,
        engine_cc: formEngineCc ? Number(formEngineCc) : null,
        motor_watts: formMotorWatts ? Number(formMotorWatts) : null,
        condition: formCondition,
        price_iqd: Number(formPrice),
        negotiable: formNegotiable,
        phone: formPhone.trim(),
        description: formDesc.trim(),
        keywords: formKeywords.trim(),
        images: formImages,
        video_url: formVideoUrl,
        status: editListingObj ? editListingObj.status : 'approved',
      };

      if (editListingObj) {
        await updateListingFields(editListingObj.id, payload);
        notify('تم تحديث المنشور بنجاح.');
      } else {
        await createAdminListingApi(payload);
        notify('تم إضافة ونشر المنشور الجديد بنجاح.');
      }
      setAddListingModalOpen(false);
      setEditListingObj(null);
      await loadAllAdminData(activityDays, listingStatusFilter);
      onDataChanged();
    } catch (err: any) {
      setFormError(err?.message || 'تعذر حفظ المنشور.');
    } finally {
      setFormSaving(false);
    }
  };

  // Verify server-side HttpOnly admin session on mount
  useEffect(() => {
    const verify = async () => {
      try {
        const status = await fetchAdminAuthStatus();
        if (status.authenticated && status.username) {
          setAdminUser(status.username);
        } else {
          clearAdminCsrfToken();
          onBackToApp();
        }
      } catch {
        clearAdminCsrfToken();
        onBackToApp();
      } finally {
        setAuthChecking(false);
      }
    };
    verify();
  }, [onBackToApp]);

  const loadAllAdminData = useCallback(
    async (days = activityDays, listFilter = listingStatusFilter) => {
      setLoadingData(true);
      setDataError(null);
      try {
        const [ov, l, c, s, r, n, st, synRes, logs] = await Promise.all([
          fetchAdminOverview(days),
          fetchAdminListings(listFilter),
          fetchCategories(),
          fetchAdminSliders(),
          fetchAdminReports(),
          fetchAdminNotifications(),
          fetchAdminSettings(),
          fetchAdminSynonyms(),
          fetchAdminAuditLogs(),
        ]);
        setOverview(ov);
        setListings(l);
        setCategories(c);
        setSliders(s);
        setReports(r);
        setNotifications(n);
        setSettings(st);
        setSynonyms(synRes.synonyms || []);
        setKnownBrands(synRes.knownBrands || []);
        setAuditLogs(logs || []);
      } catch (err: any) {
        if (err?.status === 401 || err?.status === 403 || err?.isOffline) {
          clearAdminCsrfToken();
          setAdminUser(null);
          onBackToApp();
          return;
        }
        setDataError(err?.message || 'تعذر تحميل البيانات.');
      } finally {
        setLoadingData(false);
      }
    },
    [activityDays, listingStatusFilter, onBackToApp]
  );

  useEffect(() => {
    if (adminUser) {
      loadAllAdminData(activityDays, listingStatusFilter);
    }
  }, [adminUser, activityDays, listingStatusFilter, loadAllAdminData]);

  // Auto-refresh overview & pending badge every 25s without resetting server idle timeout
  useEffect(() => {
    if (!adminUser) return;
    const interval = window.setInterval(async () => {
      try {
        const ov = await fetchAdminOverview(activityDays, true);
        setOverview(ov);
      } catch (err: any) {
        if (err?.status === 401 || err?.status === 403 || err?.isOffline) {
          clearAdminCsrfToken();
          setAdminUser(null);
          onBackToApp();
        }
      }
    }, 25000);
    return () => window.clearInterval(interval);
  }, [adminUser, activityDays, onBackToApp]);

  // Global search inside Admin (listings + categories)
  useEffect(() => {
    const q = searchQuery.trim();
    if (!q || !adminUser) {
      setSearchResults(null);
      return;
    }
    const timer = window.setTimeout(async () => {
      setSearching(true);
      try {
        const res = await searchAdminApi(q);
        setSearchResults(res);
      } catch {
        setSearchResults(null);
      } finally {
        setSearching(false);
      }
    }, 250);
    return () => window.clearTimeout(timer);
  }, [searchQuery, adminUser]);

  const handleLogout = async () => {
    try {
      await logoutAdminApi();
    } catch {
      // ignore
    }
    clearAdminCsrfToken();
    setAdminUser(null);
    onBackToApp();
  };

  const handleUploadSingleImage = async (
    file: File | undefined,
    onDone: (url: string) => void
  ) => {
    if (!file) return;
    try {
      const urls = await uploadImagesApi([file]);
      if (urls[0]) onDone(urls[0]);
    } catch (err: any) {
      notify(err?.message || 'فشل رفع الصورة.');
    }
  };

  const handleChangeListingStatus = async (
    id: number,
    status: 'approved' | 'rejected' | 'sold' | 'pending' | 'hidden'
  ) => {
    try {
      await updateListingStatus(id, status);
      notify(
        status === 'approved'
          ? 'تم اعتماد ونشر المنشور.'
          : status === 'rejected'
            ? 'تم رفض المنشور.'
            : status === 'sold'
              ? 'تم تحديث الحالة إلى تم البيع.'
              : status === 'hidden'
                ? 'تم إخفاء المنشور من التصفح.'
                : 'تمت إعادة المنشور للمراجعة.'
      );
      await loadAllAdminData(activityDays, listingStatusFilter);
      onDataChanged();
    } catch (err: any) {
      notify(err?.message || 'تعذر تحديث الحالة.');
    }
  };

  const handleDeleteListing = async (id: number) => {
    try {
      await deleteListingApi(id);
      notify('تم حذف المنشور نهائياً.');
      await loadAllAdminData(activityDays, listingStatusFilter);
      onDataChanged();
    } catch (err: any) {
      notify(err?.message || 'تعذر حذف المنشور.');
    }
  };

  const handleClearDemoData = async () => {
    try {
      const res = await deleteAllDemoListingsApi();
      notify(`تم حذف ${res.deleted} منشور تجريبي.`);
      await loadAllAdminData(activityDays, listingStatusFilter);
      onDataChanged();
    } catch (err: any) {
      notify(err?.message || 'تعذر حذف البيانات التجريبية.');
    }
  };

  const handleSaveCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!catName.trim() || !catImage.trim()) {
      notify('يرجى إدخال اسم القسم ورفع صورته.');
      return;
    }
    setCatSaving(true);
    try {
      if (editingCatId) {
        await updateCategoryApi(editingCatId, {
          name_ar: catName.trim(),
          image_url: catImage.trim(),
          is_parts_or_accessories: catIsParts,
          sort_order: Number(catSort) || 1,
        });
        notify('تم تحديث القسم.');
      } else {
        await createCategoryApi({
          name_ar: catName.trim(),
          image_url: catImage.trim(),
          is_parts_or_accessories: catIsParts,
          sort_order: Number(catSort) || 10,
        });
        notify('تمت إضافة القسم.');
      }
      setCatName('');
      setCatImage('');
      setCatIsParts(false);
      setCatSort('10');
      setEditingCatId(null);
      await loadAllAdminData(activityDays, listingStatusFilter);
      onDataChanged();
    } catch (err: any) {
      notify(err?.message || 'تعذر حفظ القسم.');
    } finally {
      setCatSaving(false);
    }
  };

  const handleDeleteCategory = async (id: number) => {
    try {
      await deleteCategoryApi(id);
      notify('تم حذف القسم.');
      await loadAllAdminData(activityDays, listingStatusFilter);
      onDataChanged();
    } catch (err: any) {
      notify(err?.message || 'تعذر حذف القسم.');
    }
  };

  const handleSaveSlider = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!slideTitle.trim() || !slideImage.trim()) {
      notify('يرجى إدخال عنوان الشريحة ورفع صورتها.');
      return;
    }
    setSlideSaving(true);
    try {
      const payload = {
        title: slideTitle.trim(),
        subtitle: slideSubtitle.trim(),
        image_url: slideImage.trim(),
        link_category_id: slideLinkCatId ? Number(slideLinkCatId) : null,
        sort_order: Number(slideSort) || 1,
        is_active: slideActive,
      };
      if (editingSlideId) {
        await updateSliderApi(editingSlideId, payload);
        notify('تم تحديث الشريحة.');
      } else {
        await createSliderApi(payload);
        notify('تمت إضافة الشريحة.');
      }
      setSlideTitle('');
      setSlideSubtitle('');
      setSlideImage('');
      setSlideLinkCatId('');
      setSlideSort('1');
      setSlideActive(true);
      setEditingSlideId(null);
      await loadAllAdminData(activityDays, listingStatusFilter);
      onDataChanged();
    } catch (err: any) {
      notify(err?.message || 'تعذر حفظ الشريحة.');
    } finally {
      setSlideSaving(false);
    }
  };

  const handleDeleteSlider = async (id: number) => {
    try {
      await deleteSliderApi(id);
      notify('تم حذف الشريحة.');
      await loadAllAdminData(activityDays, listingStatusFilter);
      onDataChanged();
    } catch (err: any) {
      notify(err?.message || 'تعذر حذف الشريحة.');
    }
  };

  const handleReportStatus = async (id: number, status: 'reviewed' | 'dismissed') => {
    try {
      await updateReportStatusApi(id, status);
      notify('تم تحديث حالة البلاغ.');
      await loadAllAdminData(activityDays, listingStatusFilter);
    } catch (err: any) {
      notify(err?.message || 'تعذر تحديث البلاغ.');
    }
  };

  const handleMarkNotificationRead = async (n: AdminNotification) => {
    try {
      if (!n.is_read) {
        await markNotificationReadApi(n.id);
      }
      if (n.target_section === 'pending') {
        setActiveSection('pending');
      } else if (n.target_section === 'reports') {
        setActiveSection('reports');
      }
      await loadAllAdminData(activityDays, listingStatusFilter);
    } catch {
      // ignore
    }
  };

  const handleMarkAllRead = async () => {
    try {
      await markAllNotificationsReadApi();
      notify('تم تحديد جميع الإشعارات كمقروءة.');
      await loadAllAdminData(activityDays, listingStatusFilter);
    } catch {
      notify('تعذر تحديث الإشعارات.');
    }
  };

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingSettings(true);
    try {
      await updateAdminSettings({
        platform_name: settings.platform_name || '',
        support_phone: settings.support_phone || '',
        moderation_note: settings.moderation_note || '',
      });
      notify('تم حفظ إعدادات المنصة.');
      await loadAllAdminData(activityDays, listingStatusFilter);
    } catch (err: any) {
      notify(err?.message || 'تعذر حفظ الإعدادات.');
    } finally {
      setSavingSettings(false);
    }
  };

  const handleSaveNewPin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentPinInput.trim()) {
      notify('يرجى إدخال الرمز الحالي للتحقق.');
      return;
    }
    if (newPinInput.trim().length < 6 || newPinInput.trim().length > 128) {
      notify('يجب أن يتكون الرمز الجديد من 6 إلى 128 خانة.');
      return;
    }
    setSavingPin(true);
    try {
      await updateAdminPinApi(currentPinInput.trim(), newPinInput.trim());
      setCurrentPinInput('');
      setNewPinInput('');
      notify('تم تحديث الرمز السري وإبطال الجلسات السابقة بنجاح.');
      await loadAllAdminData(activityDays, listingStatusFilter);
    } catch (err: any) {
      notify(err?.message || 'تعذر تحديث الرمز.');
    } finally {
      setSavingPin(false);
    }
  };

  const resetSynonymForm = () => {
    setEditingSynId(null);
    setSynTerm('');
    setSynTargetType('brand');
    setSynCanonicalValue('');
    setSynCategoryId('');
    setSynNotes('');
    setSynIsActive(true);
    setSynOptions([]);
  };

  const startEditingSynonym = (s: SearchSynonym, forceActivate = false) => {
    setEditingSynId(s.id);
    setSynTerm(s.term);
    setSynTargetType(
      forceActivate && s.target_type === 'ambiguous' && !s.is_active
        ? 'brand'
        : s.target_type
    );
    setSynCanonicalValue(s.canonical_value || '');
    setSynCategoryId(s.category_id ? String(s.category_id) : '');
    setSynNotes(s.notes || '');
    setSynIsActive(forceActivate ? true : s.is_active);
    setSynOptions(s.disambiguation_options || []);
  };

  const handleSaveSynonym = async (e: React.FormEvent) => {
    e.preventDefault();
    const termTrim = synTerm.trim();
    if (!termTrim) {
      notify('يرجى إدخال المصطلح أو الكلمة.');
      return;
    }
    if (synTargetType === 'category' && !synCategoryId) {
      notify('يرجى اختيار القسم المقصود بدقة دون تخمين.');
      return;
    }
    if (
      (synTargetType === 'brand' || synTargetType === 'keyword') &&
      !synCanonicalValue.trim()
    ) {
      notify(
        synTargetType === 'brand'
          ? 'يرجى تحديد الماركة المعتمدة لهذا المصطلح.'
          : 'يرجى كتابة الكلمة أو الدلالة المعتمدة.'
      );
      return;
    }
    if (synTargetType === 'ambiguous' && synOptions.length === 0 && synIsActive) {
      notify('يرجى إضافة خيار توضيحي واحد على الأقل للمصطلح متعدد المعاني.');
      return;
    }

    setSynSaving(true);
    try {
      const catIdNum = synTargetType === 'category' && synCategoryId ? Number(synCategoryId) : null;
      const selectedCat = catIdNum ? categories.find((c) => c.id === catIdNum) : null;
      const payload = {
        term: termTrim,
        target_type: synTargetType,
        canonical_value:
          synTargetType === 'category'
            ? selectedCat?.slug || synCanonicalValue.trim()
            : synCanonicalValue.trim(),
        category_id: catIdNum,
        disambiguation_options: synTargetType === 'ambiguous' ? synOptions : [],
        is_active: synIsActive,
        notes: synNotes.trim(),
      };

      if (editingSynId) {
        await updateAdminSynonym(editingSynId, payload);
        notify('تم تحديث ربط المصطلح في قاموس المرادفات.');
      } else {
        await createAdminSynonym(payload);
        notify('تمت إضافة المرادف الجديد وتحديث البحث.');
      }
      resetSynonymForm();
      await loadAllAdminData(activityDays, listingStatusFilter);
    } catch (err: any) {
      notify(err?.message || 'تعذر حفظ المصطلح.');
    } finally {
      setSynSaving(false);
    }
  };

  const handleToggleSynonymActive = async (s: SearchSynonym) => {
    if (!s.is_active && s.target_type === 'ambiguous' && (!s.disambiguation_options || s.disambiguation_options.length === 0)) {
      startEditingSynonym(s, true);
      notify('حدّد أولاً الماركة أو القسم المقصود لهذا المصطلح قبل التفعيل.');
      return;
    }
    try {
      await updateAdminSynonym(s.id, { is_active: !s.is_active });
      notify(s.is_active ? 'تم إيقاف المرادف مؤقتاً.' : 'تم تفعيل المرادف في البحث.');
      await loadAllAdminData(activityDays, listingStatusFilter);
    } catch (err: any) {
      notify(err?.message || 'تعذر تغيير حالة المرادف.');
    }
  };

  const handleDeleteSynonym = async (id: number) => {
    try {
      await deleteAdminSynonym(id);
      if (editingSynId === id) resetSynonymForm();
      notify('تم حذف المصطلح من القاموس.');
      await loadAllAdminData(activityDays, listingStatusFilter);
    } catch (err: any) {
      notify(err?.message || 'تعذر حذف المصطلح.');
    }
  };

  if (authChecking || !adminUser) {
    return null;
  }

  const pendingCount = overview?.pendingListings ?? 0;
  const unreadNotifsCount = overview?.unreadNotifications ?? 0;

  const pendingListingsList = listings.filter((l) => l.status === 'pending');
  const rejectedListingsList = listings.filter((l) => l.status === 'rejected');
  const displayedListings =
    listingStatusFilter === 'all'
      ? listings
      : listings.filter((l) => l.status === listingStatusFilter);

  const navItems: Array<{
    id: AdminSection;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
    badge?: number;
  }> = [
    { id: 'overview', label: 'الرئيسية', icon: Home },
    { id: 'listings', label: 'إدارة التصفح', icon: Layers },
    {
      id: 'pending',
      label: 'الخدمات المضافة حديثًا',
      icon: PlusCircle,
      badge: pendingCount,
    },
    { id: 'rejected', label: 'المنشورات المرفوضة', icon: XCircle },
    { id: 'sliders', label: 'إدارة السلايدر', icon: ImageIcon },
    { id: 'categories', label: 'إدارة الأقسام', icon: Folder },
    { id: 'synonyms', label: 'قاموس المرادفات', icon: BookOpen },
    { id: 'reports', label: 'البلاغات والشكاوى', icon: AlertTriangle },
    { id: 'notifications', label: 'الإشعارات', icon: Bell },
    { id: 'settings', label: 'الإعدادات', icon: Settings },
  ];

  const selectSection = (sec: AdminSection) => {
    setActiveSection(sec);
    setSidebarOpen(false);
    setSearchQuery('');
    setSearchResults(null);
  };

  // Helper for SVG Line Chart
  const renderActivityChart = () => {
    const series = overview?.activitySeries || [];
    const maxVal = Math.max(4, ...series.map((p) => p.count));
    const width = 560;
    const height = 210;
    const padLeft = 18;
    const padRight = 32;
    const padTop = 18;
    const padBottom = 34;
    const plotW = width - padLeft - padRight;
    const plotH = height - padTop - padBottom;

    const points = series.map((pt, i) => {
      const x =
        series.length <= 1
          ? padLeft + plotW / 2
          : padLeft + (i / (series.length - 1)) * plotW;
      const y = padTop + plotH - (pt.count / maxVal) * plotH;
      return { ...pt, x, y };
    });

    const linePath =
      points.length > 0
        ? points
            .map((p, idx) => `${idx === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
            .join(' ')
        : '';

    const areaPath =
      points.length > 0
        ? `${linePath} L ${points[points.length - 1].x.toFixed(1)} ${(
            padTop + plotH
          ).toFixed(1)} L ${points[0].x.toFixed(1)} ${(padTop + plotH).toFixed(1)} Z`
        : '';

    const yTicks = [0, Math.round(maxVal * 0.33), Math.round(maxVal * 0.66), maxVal];

    return (
      <div className="rounded-2xl bg-[#071636]/90 border border-sky-400/30 p-4 sm:p-5 shadow-[0_0_24px_rgba(14,165,233,0.08)]">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
          <div className="flex items-center gap-2">
            <BarChart3 className="w-5 h-5 text-amber-400" />
            <h3 className="text-sm sm:text-base font-extrabold text-white">
              نشاط المنشورات
            </h3>
          </div>

          <div className="inline-flex items-center gap-1 p-1 rounded-xl bg-[#040E24] border border-sky-400/20">
            <button
              type="button"
              onClick={() => setActivityDays(7)}
              className={`h-8 px-3 rounded-lg text-xs font-bold transition-colors cursor-pointer ${
                activityDays === 7
                  ? 'bg-sky-500 text-white'
                  : 'text-slate-300 hover:text-white'
              }`}
            >
              آخر 7 أيام
            </button>
            <button
              type="button"
              onClick={() => setActivityDays(30)}
              className={`h-8 px-3 rounded-lg text-xs font-bold transition-colors cursor-pointer ${
                activityDays === 30
                  ? 'bg-sky-500 text-white'
                  : 'text-slate-300 hover:text-white'
              }`}
            >
              آخر 30 يومًا
            </button>
          </div>
        </div>

        {series.length === 0 ? (
          <div className="py-12 text-center text-xs text-slate-400">
            لا توجد بيانات منشورات مسجلة ضمن هذه الفترة.
          </div>
        ) : (
          <div className="w-full overflow-hidden">
            <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-48 sm:h-56">
              <defs>
                <linearGradient id="adminChartArea" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#38BDF8" stopOpacity="0.4" />
                  <stop offset="100%" stopColor="#0EA5E9" stopOpacity="0.02" />
                </linearGradient>
              </defs>

              {yTicks.map((tick, idx) => {
                const y = padTop + plotH - (tick / maxVal) * plotH;
                return (
                  <g key={`${tick}-${idx}`}>
                    <line
                      x1={padLeft}
                      y1={y}
                      x2={width - padRight}
                      y2={y}
                      stroke="rgba(56, 189, 248, 0.14)"
                      strokeDasharray="3 3"
                    />
                    <text
                      x={width - padRight + 8}
                      y={y + 4}
                      fill="#94A3B8"
                      fontSize="10"
                      textAnchor="start"
                    >
                      {tick}
                    </text>
                  </g>
                );
              })}

              {areaPath && <path d={areaPath} fill="url(#adminChartArea)" />}
              {linePath && (
                <path
                  d={linePath}
                  fill="none"
                  stroke="#38BDF8"
                  strokeWidth="2.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              )}

              {points.map((p, i) => {
                const showLabel =
                  activityDays === 7 || i % 5 === 0 || i === points.length - 1;
                return (
                  <g key={p.date}>
                    <circle
                      cx={p.x}
                      cy={p.y}
                      r={activityDays === 7 ? 4.5 : 3}
                      fill="#E0F2FE"
                      stroke="#0EA5E9"
                      strokeWidth="2"
                    >
                      <title>{`${p.date}: ${p.count} منشور`}</title>
                    </circle>
                    {showLabel && (
                      <text
                        x={p.x}
                        y={height - 10}
                        fill="#CBD5E1"
                        fontSize="10"
                        textAnchor="middle"
                      >
                        {p.label}
                      </text>
                    )}
                  </g>
                );
              })}
            </svg>
          </div>
        )}
      </div>
    );
  };

  // Helper for Category Distribution Chart
  const renderCategoryDistribution = () => {
    const dist = overview?.categoryDistribution || [];
    const total = dist.reduce((sum, item) => sum + item.count, 0);

    return (
      <div className="rounded-2xl bg-[#071636]/90 border border-amber-400/30 p-4 sm:p-5 shadow-[0_0_24px_rgba(245,158,11,0.06)]">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Folder className="w-5 h-5 text-amber-400" />
            <h3 className="text-sm sm:text-base font-extrabold text-white">
              توزيع المنشورات على الأقسام
            </h3>
          </div>
          <span className="text-xs text-slate-400 tabular-nums">
            الإجمالي: {total}
          </span>
        </div>

        {dist.length === 0 || total === 0 ? (
          <div className="py-8 text-center text-xs text-slate-400">
            لا توجد منشورات موزعة على الأقسام بعد.
          </div>
        ) : (
          <div className="space-y-3">
            {dist.map((item) => {
              const pct = total > 0 ? Math.round((item.count / total) * 100) : 0;
              return (
                <div key={item.id} className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-bold text-slate-100">{item.name_ar}</span>
                    <span className="text-amber-300 font-bold tabular-nums">
                      {item.count} ({pct}%)
                    </span>
                  </div>
                  <div className="h-2.5 rounded-full bg-[#040E24] overflow-hidden border border-white/5">
                    <div
                      className="h-full rounded-full bg-gradient-to-l from-amber-400 to-sky-400 transition-all duration-300"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  return (
    <div
      dir="rtl"
      className="min-h-screen bg-gradient-to-b from-[#040C20] via-[#06132E] to-[#040C20] text-white flex"
    >
      {/* Mobile Sidebar Backdrop */}
      {sidebarOpen && (
        <div
          onClick={() => setSidebarOpen(false)}
          className="fixed inset-0 z-40 bg-black/65 backdrop-blur-xs lg:hidden"
        />
      )}

      {/* Main Content Area (First in RTL flex so Sidebar sits on the LEFT edge on desktop too!) */}
      <div className="flex-1 min-w-0 flex flex-col">
        {/* Admin Top Header */}
        <header className="sticky top-0 z-30 bg-[#051029]/95 backdrop-blur-md border-b border-sky-400/15">
          <div className="max-w-5xl mx-auto px-4 h-16 flex items-center justify-between gap-3">
            {/* Right in RTL: Avatar + Bell + Greeting */}
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-gradient-to-br from-amber-300 to-amber-500 text-[#051029] flex items-center justify-center shadow-[0_0_12px_rgba(245,158,11,0.35)] shrink-0">
                <User className="w-5 h-5" strokeWidth={2.4} />
              </div>

              <button
                type="button"
                onClick={() => selectSection('notifications')}
                aria-label="الإشعارات"
                className="relative w-10 h-10 rounded-xl bg-[#0A1A3C] border border-amber-400/30 hover:border-amber-400/70 flex items-center justify-center text-amber-400 transition-colors cursor-pointer shrink-0"
              >
                <Bell className="w-5 h-5" />
                {unreadNotifsCount > 0 && (
                  <span className="absolute -top-1.5 -right-1.5 min-w-[20px] h-5 px-1 rounded-full bg-[#F96B11] text-white text-[11px] font-extrabold flex items-center justify-center tabular-nums shadow">
                    {unreadNotifsCount}
                  </span>
                )}
              </button>

              <div className="leading-tight">
                <p className="text-xs text-slate-300">مرحبًا بك</p>
                <p className="text-sm sm:text-base font-extrabold text-white">
                  مدير النظام
                </p>
              </div>
            </div>

            {/* Left in RTL: Refresh + Sidebar Toggle */}
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() =>
                  loadAllAdminData(activityDays, listingStatusFilter)
                }
                aria-label="تحديث البيانات"
                className="w-10 h-10 rounded-xl bg-[#0A1A3C] border border-sky-400/25 hover:border-sky-400/60 text-sky-300 flex items-center justify-center transition-colors cursor-pointer"
              >
                <RefreshCw
                  className={`w-4 h-4 ${loadingData ? 'animate-spin' : ''}`}
                />
              </button>
              <button
                type="button"
                onClick={() => setSidebarOpen(true)}
                aria-label="فتح القائمة الجانبية"
                className="lg:hidden w-10 h-10 rounded-xl bg-[#0A1A3C] border border-sky-400/30 text-white flex items-center justify-center cursor-pointer"
              >
                <Menu className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* Search Input below Header */}
          <div className="max-w-5xl mx-auto px-4 pb-3.5">
            <div className="relative">
              <Search className="w-4 h-4 text-sky-300 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="البحث في الإدارة"
                className="w-full h-11 pr-4 pl-10 rounded-xl bg-[#081635] border border-sky-400/40 focus:border-amber-400/80 text-white placeholder:text-slate-300/80 text-sm focus:outline-none focus:ring-2 focus:ring-sky-400/25"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => {
                    setSearchQuery('');
                    setSearchResults(null);
                  }}
                  aria-label="مسح البحث"
                  className="w-8 h-8 rounded-lg text-slate-400 hover:text-white flex items-center justify-center absolute right-1.5 top-1/2 -translate-y-1/2 cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>
        </header>

        {/* Action Toast */}
        {actionMsg && (
          <div className="fixed top-20 inset-x-0 z-50 flex justify-center px-4 pointer-events-none">
            <div className="bg-amber-400 text-[#051029] text-xs sm:text-sm font-extrabold px-4 py-2.5 rounded-xl shadow-xl">
              {actionMsg}
            </div>
          </div>
        )}

        {/* Main Workspace */}
        <main className="flex-1 w-full max-w-5xl mx-auto px-4 py-5 space-y-5">
          {dataError && (
            <div className="p-4 rounded-2xl bg-red-950/60 border border-red-400/40 text-red-200 text-sm font-bold flex items-center justify-between gap-3">
              <span>{dataError}</span>
              <button
                type="button"
                onClick={() =>
                  loadAllAdminData(activityDays, listingStatusFilter)
                }
                className="px-3 py-1.5 rounded-lg bg-red-500 text-white text-xs font-bold cursor-pointer"
              >
                إعادة المحاولة
              </button>
            </div>
          )}

          {/* Global Admin Search Results Overlay Block */}
          {searchQuery.trim() && (
            <section className="rounded-2xl bg-[#071636] border border-sky-400/40 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-extrabold text-amber-300">
                  نتائج البحث في الإدارة
                </h2>
                {searching && (
                  <Loader2 className="w-4 h-4 animate-spin text-sky-400" />
                )}
              </div>

              {searchResults &&
              searchResults.listings.length === 0 &&
              searchResults.categories.length === 0 ? (
                <p className="text-xs text-slate-400 py-3">
                  لا توجد منشورات أو أقسام مطابقة لـ «{searchQuery}».
                </p>
              ) : (
                <div className="space-y-3">
                  {searchResults?.categories &&
                    searchResults.categories.length > 0 && (
                      <div className="space-y-1.5">
                        <p className="text-xs font-bold text-slate-400">الأقسام</p>
                        <div className="flex flex-wrap gap-2">
                          {searchResults.categories.map((c) => (
                            <button
                              key={c.id}
                              type="button"
                              onClick={() => selectSection('categories')}
                              className="px-3 py-1.5 rounded-xl bg-[#0B204A] border border-amber-400/35 text-xs font-bold text-amber-200 cursor-pointer"
                            >
                              {c.name_ar} ({c.listings_count ?? 0})
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                  {searchResults?.listings &&
                    searchResults.listings.length > 0 && (
                      <div className="space-y-2">
                        <p className="text-xs font-bold text-slate-400">المنشورات</p>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                          {searchResults.listings.map((item) => (
                            <div
                              key={item.id}
                              className="rounded-xl bg-[#0A1C42] border border-sky-400/20 p-3 flex items-center justify-between gap-3"
                            >
                              <div className="min-w-0">
                                <p className="text-sm font-bold text-white truncate">
                                  {item.title}
                                </p>
                                <p className="text-xs text-slate-400 truncate">
                                  {item.category_name} · {item.governorate} ·{' '}
                                  <span className="tabular-nums">
                                    {formatPriceIQD(item.price_iqd)} د.ع
                                  </span>
                                </p>
                              </div>
                              <button
                                type="button"
                                onClick={() => onInspectListing(item)}
                                className="h-8 px-3 rounded-lg bg-sky-500/20 border border-sky-400/40 text-sky-200 text-xs font-bold shrink-0 cursor-pointer"
                              >
                                عرض
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                </div>
              )}
            </section>
          )}

          {/* Welcome Banner */}
          <section className="relative overflow-hidden rounded-2xl border border-amber-400/45 bg-gradient-to-l from-[#0B1C42] via-[#13264E] to-[#08132B] shadow-[0_0_28px_rgba(245,158,11,0.12)]">
            <div
              aria-hidden="true"
              className="absolute inset-0 bg-[radial-gradient(circle_at_25%_50%,rgba(245,158,11,0.22),transparent_55%),radial-gradient(circle_at_80%_20%,rgba(56,189,248,0.2),transparent_50%)] pointer-events-none"
            />
            <div className="relative flex items-center justify-between gap-4 p-4 sm:p-6 min-h-[130px] sm:min-h-[160px]">
              <div className="z-10 max-w-[58%] sm:max-w-md space-y-1">
                <p className="text-base sm:text-xl font-bold text-white leading-snug">
                  مرحبًا بك في لوحة إدارة
                </p>
                <p className="text-2xl sm:text-3xl font-extrabold text-amber-300 tracking-tight">
                  دراجتي
                </p>
                <svg
                  viewBox="0 0 160 12"
                  className="w-28 sm:w-36 h-2.5"
                  fill="none"
                  aria-hidden="true"
                >
                  <path
                    d="M2 8C48 2 112 2 158 7"
                    stroke="#F59E0B"
                    strokeWidth="4"
                    strokeLinecap="round"
                  />
                </svg>
              </div>

              <div className="w-36 sm:w-56 h-24 sm:h-32 rounded-xl overflow-hidden border border-amber-400/35 shrink-0 shadow-lg">
                <ProgressiveImage
                  src="/src/assets/images/cat_motorcycle_1795186795635.jpg"
                  alt="لوحة إدارة دراجتي"
                  eager
                  containerClassName="w-full h-full"
                  className="object-cover"
                />
              </div>
            </div>
          </section>

          {/* SECTION 1: OVERVIEW (الرئيسية والإحصائيات) */}
          {activeSection === 'overview' && (
            <div className="space-y-4">
              {/* 4 Large Stat Cards stacked single-column on mobile in exact order */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                {/* 1. إجمالي الزيارات — Blue */}
                <div className="rounded-2xl bg-[#071A3C]/90 border border-sky-400/45 p-4 sm:p-5 shadow-[0_0_20px_rgba(14,165,233,0.12)] flex items-center justify-between gap-4">
                  <div className="space-y-1">
                    <p className="text-sm font-bold text-slate-200">
                      إجمالي الزيارات
                    </p>
                    <p className="text-3xl font-extrabold text-white tabular-nums">
                      {overview?.totalVisits ?? 0}
                    </p>
                  </div>
                  <div className="w-13 h-13 rounded-2xl bg-sky-500/20 border border-sky-400/40 text-sky-300 flex items-center justify-center shrink-0">
                    <BarChart3 className="w-6 h-6" />
                  </div>
                </div>

                {/* 2. إجمالي المنشورات المنشورة — Teal/Blue-Green */}
                <div className="rounded-2xl bg-[#072136]/90 border border-teal-400/45 p-4 sm:p-5 shadow-[0_0_20px_rgba(20,184,166,0.12)] flex items-center justify-between gap-4">
                  <div className="space-y-1">
                    <p className="text-sm font-bold text-slate-200">
                      إجمالي المنشورات المنشورة
                    </p>
                    <p className="text-3xl font-extrabold text-white tabular-nums">
                      {overview?.publishedListings ?? 0}
                    </p>
                  </div>
                  <div className="w-13 h-13 rounded-2xl bg-teal-500/20 border border-teal-400/40 text-teal-300 flex items-center justify-center shrink-0">
                    <FileText className="w-6 h-6" />
                  </div>
                </div>

                {/* 3. قيد المراجعة — Purple */}
                <button
                  type="button"
                  onClick={() => selectSection('pending')}
                  className="text-right rounded-2xl bg-[#13163D]/90 border border-violet-400/45 hover:border-violet-300/75 p-4 sm:p-5 shadow-[0_0_20px_rgba(139,92,246,0.12)] flex items-center justify-between gap-4 transition-colors cursor-pointer"
                >
                  <div className="space-y-1">
                    <p className="text-sm font-bold text-slate-200">
                      قيد المراجعة
                    </p>
                    <p className="text-3xl font-extrabold text-white tabular-nums">
                      {overview?.pendingListings ?? 0}
                    </p>
                  </div>
                  <div className="w-13 h-13 rounded-2xl bg-violet-500/20 border border-violet-400/40 text-violet-300 flex items-center justify-center shrink-0">
                    <Clock className="w-6 h-6" />
                  </div>
                </button>

                {/* 4. إجمالي الأقسام — Gold */}
                <button
                  type="button"
                  onClick={() => selectSection('categories')}
                  className="text-right rounded-2xl bg-[#191B33]/90 border border-amber-400/45 hover:border-amber-300/75 p-4 sm:p-5 shadow-[0_0_20px_rgba(245,158,11,0.12)] flex items-center justify-between gap-4 transition-colors cursor-pointer"
                >
                  <div className="space-y-1">
                    <p className="text-sm font-bold text-slate-200">
                      إجمالي الأقسام
                    </p>
                    <p className="text-3xl font-extrabold text-white tabular-nums">
                      {overview?.totalCategories ?? 0}
                    </p>
                  </div>
                  <div className="w-13 h-13 rounded-2xl bg-amber-500/20 border border-amber-400/40 text-amber-300 flex items-center justify-center shrink-0">
                    <Layers className="w-6 h-6" />
                  </div>
                </button>
              </div>

              {/* Charts */}
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
                <div className="lg:col-span-7">{renderActivityChart()}</div>
                <div className="lg:col-span-5">{renderCategoryDistribution()}</div>
              </div>
            </div>
          )}

          {/* SECTION 2: BROWSING MANAGEMENT (إدارة التصفح) */}
          {activeSection === 'listings' && (() => {
            const filteredBrowseListings = listings.filter((item) => {
              if (listingsTab === 'published') {
                if (item.status !== 'approved' && item.status !== 'sold') return false;
              } else {
                if (item.status !== 'hidden') return false;
              }

              const q = listingsSearch.trim().toLowerCase();
              if (q) {
                const matchTitle = item.title.toLowerCase().includes(q);
                const matchBrand = (item.brand || '').toLowerCase().includes(q);
                const matchDesc = item.description.toLowerCase().includes(q);
                if (!matchTitle && !matchBrand && !matchDesc) return false;
              }

              if (listingsCatFilter !== 'all' && String(item.category_id) !== listingsCatFilter) {
                return false;
              }

              if (listingsGovFilter !== 'all' && item.governorate !== listingsGovFilter) {
                return false;
              }

              return true;
            });

            return (
              <section className="space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2 p-1 rounded-xl bg-[#071636] border border-sky-400/25">
                    <button
                      type="button"
                      onClick={() => setListingsTab('published')}
                      className={`h-9 px-4 rounded-lg text-xs font-bold transition-colors cursor-pointer ${
                        listingsTab === 'published'
                          ? 'bg-amber-400 text-[#051029]'
                          : 'text-slate-300 hover:text-white'
                      }`}
                    >
                      المنشورة ({(listings.filter(l => l.status === 'approved' || l.status === 'sold')).length})
                    </button>
                    <button
                      type="button"
                      onClick={() => setListingsTab('hidden')}
                      className={`h-9 px-4 rounded-lg text-xs font-bold transition-colors cursor-pointer ${
                        listingsTab === 'hidden'
                          ? 'bg-amber-400 text-[#051029]'
                          : 'text-slate-300 hover:text-white'
                      }`}
                    >
                      المخفية ({(listings.filter(l => l.status === 'hidden')).length})
                    </button>
                  </div>

                  <button
                    type="button"
                    onClick={handleOpenAddListing}
                    className="h-10 px-4 rounded-xl bg-amber-400 hover:bg-amber-300 text-[#051029] text-xs font-extrabold inline-flex items-center gap-1.5 shadow-md cursor-pointer"
                  >
                    <Plus className="w-4 h-4" />
                    <span>إضافة منشور</span>
                  </button>
                </div>

                {/* Filters & Search Row */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 bg-[#071636] border border-sky-400/25 p-3 rounded-2xl">
                  <div className="relative">
                    <Search className="w-4 h-4 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <input
                      type="search"
                      value={listingsSearch}
                      onChange={(e) => setListingsSearch(e.target.value)}
                      placeholder="بحث بالعنوان أو الماركة..."
                      className="w-full h-10 pr-9 pl-3 rounded-xl bg-[#040E24] border border-sky-400/30 text-white placeholder:text-slate-400 text-xs"
                    />
                  </div>

                  <select
                    value={listingsCatFilter}
                    onChange={(e) => setListingsCatFilter(e.target.value)}
                    className="h-10 px-3 rounded-xl bg-[#040E24] border border-sky-400/30 text-white text-xs"
                  >
                    <option value="all">جميع الأقسام</option>
                    {categories.map((c) => (
                      <option key={c.id} value={String(c.id)}>
                        {c.name_ar}
                      </option>
                    ))}
                  </select>

                  <select
                    value={listingsGovFilter}
                    onChange={(e) => setListingsGovFilter(e.target.value)}
                    className="h-10 px-3 rounded-xl bg-[#040E24] border border-sky-400/30 text-white text-xs"
                  >
                    <option value="all">جميع المحافظات</option>
                    {IRAQI_GOVERNORATES.map((g) => (
                      <option key={g} value={g}>
                        {g}
                      </option>
                    ))}
                  </select>
                </div>

                {filteredBrowseListings.length === 0 ? (
                  <div className="rounded-2xl bg-[#071636] border border-sky-400/20 p-12 text-center text-sm text-slate-400">
                    لا توجد منشورات مطابقة لمعايير التصفح والبحث الحالية.
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                    {filteredBrowseListings.map((item) => (
                      <div
                        key={item.id}
                        className="rounded-2xl bg-[#071636] border border-sky-400/25 p-4 flex gap-3.5 shadow-sm"
                      >
                        <div className="w-24 h-24 rounded-xl overflow-hidden shrink-0 bg-[#040E24] border border-white/10">
                          <ProgressiveImage
                            src={
                              item.images.find((i) => i.isCover)?.url ||
                              item.images[0]?.url
                            }
                            alt={item.title}
                            containerClassName="w-full h-full"
                          />
                        </div>
                        <div className="flex-1 min-w-0 flex flex-col justify-between">
                          <div>
                            <div className="flex items-start justify-between gap-2">
                              <h3 className="font-bold text-sm text-white truncate">
                                {item.title}
                              </h3>
                              <span
                                className={`text-[11px] font-bold shrink-0 ${
                                  item.status === 'approved'
                                    ? 'text-teal-300'
                                    : item.status === 'sold'
                                      ? 'text-sky-300'
                                      : 'text-slate-400'
                                }`}
                              >
                                {item.status === 'approved'
                                  ? 'منشور'
                                  : item.status === 'sold'
                                    ? 'تم البيع'
                                    : 'مخفي'}
                              </span>
                            </div>
                            <p className="text-xs text-slate-300 mt-0.5 truncate">
                              {item.category_name} · {item.governorate} ·{' '}
                              <span className="tabular-nums text-amber-300 font-bold">
                                {formatPriceIQD(item.price_iqd)} د.ع
                              </span>
                            </p>
                            <p className="text-[11px] text-slate-400 mt-1">
                              نشر في: {formatArabicDate(item.created_at)}
                            </p>
                          </div>

                          <div className="flex flex-wrap items-center gap-1.5 mt-3">
                            <button
                              type="button"
                              onClick={() => handleOpenEditListing(item)}
                              className="h-8 px-2.5 rounded-lg bg-amber-400/20 border border-amber-400/40 text-amber-200 text-xs font-bold inline-flex items-center gap-1 cursor-pointer"
                            >
                              <Edit3 className="w-3.5 h-3.5" />
                              تعديل
                            </button>
                            <button
                              type="button"
                              onClick={() => onInspectListing(item)}
                              className="h-8 px-2.5 rounded-lg bg-sky-500/20 border border-sky-400/40 text-sky-200 text-xs font-bold inline-flex items-center gap-1 cursor-pointer"
                            >
                              <Eye className="w-3.5 h-3.5" />
                              عرض
                            </button>

                            {item.status === 'approved' && (
                              <button
                                type="button"
                                onClick={() => handleChangeListingStatus(item.id, 'sold')}
                                className="h-8 px-2.5 rounded-lg bg-sky-600/20 border border-sky-400/30 text-sky-300 text-xs font-bold cursor-pointer"
                              >
                                تم البيع
                              </button>
                            )}

                            {item.status === 'hidden' ? (
                              <button
                                type="button"
                                onClick={() => handleChangeListingStatus(item.id, 'approved')}
                                className="h-8 px-2.5 rounded-lg bg-teal-500/20 border border-teal-400/40 text-teal-200 text-xs font-bold cursor-pointer"
                              >
                                إعادة النشر
                              </button>
                            ) : (
                              <button
                                type="button"
                                onClick={() => handleChangeListingStatus(item.id, 'hidden')}
                                className="h-8 px-2.5 rounded-lg bg-white/10 text-slate-200 text-xs font-bold cursor-pointer"
                              >
                                إخفاء
                              </button>
                            )}

                            <button
                              type="button"
                              onClick={() => setDeleteListingTarget(item)}
                              className="h-8 px-2.5 rounded-lg bg-red-500/20 border border-red-400/40 text-red-200 text-xs font-bold inline-flex items-center gap-1 cursor-pointer"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                              حذف
                            </button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            );
          })()}

          {/* SECTION 3: RECENTLY ADDED / PENDING APPROVAL (الخدمات المضافة حديثًا) */}
          {activeSection === 'pending' && (
            <section className="space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-base sm:text-lg font-extrabold text-white">
                  الخدمات المضافة حديثًا (بانتظار الموافقة)
                </h2>
                <span className="text-xs font-bold text-[#F96B11] tabular-nums">
                  {pendingListingsList.length} بانتظار المراجعة
                </span>
              </div>

              {pendingListingsList.length === 0 ? (
                <div className="rounded-2xl bg-[#071636] border border-sky-400/20 p-10 text-center text-sm text-slate-400">
                  لا توجد منشورات جديدة بانتظار الموافقة حالياً.
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                  {pendingListingsList.map((item) => (
                    <div
                      key={item.id}
                      className="rounded-2xl bg-[#13163D]/85 border border-violet-400/40 p-4 flex gap-3.5"
                    >
                      <div className="w-24 h-24 rounded-xl overflow-hidden shrink-0 bg-[#040E24]">
                        <ProgressiveImage
                          src={
                            item.images.find((i) => i.isCover)?.url ||
                            item.images[0]?.url
                          }
                          alt={item.title}
                          containerClassName="w-full h-full"
                        />
                      </div>
                      <div className="flex-1 min-w-0 flex flex-col justify-between">
                        <div>
                          <h3 className="font-bold text-sm text-white truncate">
                            {item.title}
                          </h3>
                          <p className="text-xs text-slate-300 mt-0.5 truncate">
                            {item.category_name} · {item.governorate} ·{' '}
                            <span className="tabular-nums text-amber-300">
                              {formatPriceIQD(item.price_iqd)} د.ع
                            </span>
                          </p>
                          <p className="text-[11px] text-slate-400 mt-1">
                            هاتف: {item.phone} · {formatArabicDate(item.created_at)}
                          </p>
                        </div>

                        <div className="flex flex-wrap items-center gap-2 mt-3">
                          <button
                            type="button"
                            onClick={() =>
                              handleChangeListingStatus(item.id, 'approved')
                            }
                            className="h-9 px-3 rounded-lg bg-teal-500 hover:bg-teal-400 text-[#051029] text-xs font-extrabold inline-flex items-center gap-1 cursor-pointer"
                          >
                            <Check className="w-3.5 h-3.5" />
                            موافقة ونشر
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              handleChangeListingStatus(item.id, 'rejected')
                            }
                            className="h-9 px-3 rounded-lg bg-red-500/20 border border-red-400/40 text-red-200 text-xs font-bold cursor-pointer"
                          >
                            رفض
                          </button>
                          <button
                            type="button"
                            onClick={() => onInspectListing(item)}
                            className="h-9 px-3 rounded-lg bg-white/10 text-white text-xs font-bold cursor-pointer"
                          >
                            التفاصيل
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          )}

          {/* SECTION 4: REJECTED LISTINGS (المنشورات المرفوضة) */}
          {activeSection === 'rejected' && (
            <section className="space-y-4">
              <h2 className="text-base sm:text-lg font-extrabold text-white">
                المنشورات المرفوضة ({rejectedListingsList.length})
              </h2>

              {rejectedListingsList.length === 0 ? (
                <div className="rounded-2xl bg-[#071636] border border-sky-400/20 p-10 text-center text-sm text-slate-400">
                  لا توجد منشورات مرفوضة حالياً.
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                  {rejectedListingsList.map((item) => (
                    <div
                      key={item.id}
                      className="rounded-2xl bg-[#071636] border border-red-400/30 p-4 flex gap-3.5"
                    >
                      <div className="w-20 h-20 rounded-xl overflow-hidden shrink-0 bg-[#040E24]">
                        <ProgressiveImage
                          src={
                            item.images.find((i) => i.isCover)?.url ||
                            item.images[0]?.url
                          }
                          alt={item.title}
                          containerClassName="w-full h-full"
                        />
                      </div>
                      <div className="flex-1 min-w-0 flex flex-col justify-between">
                        <div>
                          <h3 className="font-bold text-sm text-white truncate">
                            {item.title}
                          </h3>
                          <p className="text-xs text-slate-400 truncate">
                            {item.category_name} · {item.governorate}
                          </p>
                        </div>
                        <div className="flex flex-wrap gap-2 mt-2">
                          <button
                            type="button"
                            onClick={() =>
                              handleChangeListingStatus(item.id, 'approved')
                            }
                            className="h-8 px-3 rounded-lg bg-teal-500/20 border border-teal-400/40 text-teal-200 text-xs font-bold cursor-pointer"
                          >
                            إعادة اعتماد
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteListing(item.id)}
                            className="h-8 px-3 rounded-lg bg-red-500/20 border border-red-400/40 text-red-200 text-xs font-bold cursor-pointer"
                          >
                            حذف نهائي
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          )}

          {/* SECTION 5: SLIDERS (إدارة السلايدر) */}
          {activeSection === 'sliders' && (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
              <form
                onSubmit={handleSaveSlider}
                className="lg:col-span-5 rounded-2xl bg-[#071636] border border-amber-400/30 p-5 space-y-3"
              >
                <h2 className="text-base font-extrabold text-amber-300">
                  {editingSlideId ? 'تعديل شريحة السلايدر' : 'إضافة شريحة جديدة'}
                </h2>
                <input
                  type="text"
                  value={slideTitle}
                  onChange={(e) => setSlideTitle(e.target.value)}
                  placeholder="العنوان الرئيسي"
                  className="w-full h-10 px-3 rounded-xl bg-[#040E24] border border-sky-400/30 text-white placeholder:text-slate-400 text-sm"
                />
                <input
                  type="text"
                  value={slideSubtitle}
                  onChange={(e) => setSlideSubtitle(e.target.value)}
                  placeholder="النص الفرعي"
                  className="w-full h-10 px-3 rounded-xl bg-[#040E24] border border-sky-400/30 text-white placeholder:text-slate-400 text-sm"
                />
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={slideImage}
                    onChange={(e) => setSlideImage(e.target.value)}
                    placeholder="رابط الصورة أو ارفع"
                    className="flex-1 h-10 px-3 rounded-xl bg-[#040E24] border border-sky-400/30 text-white placeholder:text-slate-400 text-xs"
                  />
                  <label className="h-10 px-3 rounded-xl bg-sky-500/20 border border-sky-400/40 text-sky-200 text-xs font-bold inline-flex items-center gap-1 cursor-pointer shrink-0">
                    <ImagePlus className="w-4 h-4" />
                    <span>رفع</span>
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) =>
                        handleUploadSingleImage(
                          e.target.files?.[0],
                          setSlideImage
                        )
                      }
                    />
                  </label>
                </div>
                <select
                  value={slideLinkCatId}
                  onChange={(e) => setSlideLinkCatId(e.target.value)}
                  className="w-full h-10 px-3 rounded-xl bg-[#040E24] border border-sky-400/30 text-white text-sm"
                >
                  <option value="">بدون ربط بقسم محدد</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      ربط بقسم: {c.name_ar}
                    </option>
                  ))}
                </select>
                <div className="flex items-center gap-3">
                  <input
                    type="number"
                    value={slideSort}
                    onChange={(e) => setSlideSort(e.target.value)}
                    placeholder="الترتيب"
                    className="w-24 h-10 px-3 rounded-xl bg-[#040E24] border border-sky-400/30 text-white text-sm tabular-nums"
                  />
                  <label className="flex items-center gap-2 text-xs font-bold text-slate-200">
                    <input
                      type="checkbox"
                      checked={slideActive}
                      onChange={(e) => setSlideActive(e.target.checked)}
                      className="accent-amber-400"
                    />
                    مفعّلة في الرئيسية
                  </label>
                </div>
                <div className="flex items-center gap-2 pt-1">
                  <button
                    type="submit"
                    disabled={slideSaving}
                    className="flex-1 h-10 rounded-xl bg-amber-400 hover:bg-amber-300 text-[#051029] text-sm font-extrabold cursor-pointer"
                  >
                    {editingSlideId ? 'حفظ التعديل' : 'إضافة الشريحة'}
                  </button>
                  {editingSlideId && (
                    <button
                      type="button"
                      onClick={() => {
                        setEditingSlideId(null);
                        setSlideTitle('');
                        setSlideSubtitle('');
                        setSlideImage('');
                        setSlideLinkCatId('');
                      }}
                      className="h-10 px-3 rounded-xl bg-white/10 text-xs font-bold cursor-pointer"
                    >
                      إلغاء
                    </button>
                  )}
                </div>
              </form>

              <div className="lg:col-span-7 space-y-3">
                {sliders.map((s) => (
                  <div
                    key={s.id}
                    className="rounded-2xl bg-[#071636] border border-sky-400/25 p-3.5 flex items-center gap-4"
                  >
                    <div className="w-28 h-18 rounded-xl overflow-hidden shrink-0">
                      <ProgressiveImage
                        src={s.image_url}
                        alt={s.title}
                        containerClassName="w-full h-full"
                      />
                    </div>
                    <div className="flex-1 min-w-0">
                      <h3 className="font-bold text-sm text-white truncate">
                        {s.title}
                      </h3>
                      <p className="text-xs text-slate-400 truncate">
                        {s.subtitle}
                      </p>
                      <p className="text-[11px] font-bold mt-1 text-amber-300">
                        {s.is_active ? 'مفعّلة' : 'مخفية'} · ترتيب {s.sort_order}
                      </p>
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => {
                          setEditingSlideId(s.id);
                          setSlideTitle(s.title);
                          setSlideSubtitle(s.subtitle);
                          setSlideImage(s.image_url);
                          setSlideLinkCatId(
                            s.link_category_id ? String(s.link_category_id) : ''
                          );
                          setSlideSort(String(s.sort_order));
                          setSlideActive(s.is_active);
                        }}
                        className="w-9 h-9 rounded-lg hover:bg-white/10 flex items-center justify-center text-sky-300 cursor-pointer"
                      >
                        <Edit3 className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteSlider(s.id)}
                        className="w-9 h-9 rounded-lg hover:bg-red-500/20 flex items-center justify-center text-red-400 cursor-pointer"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* SECTION 6: CATEGORIES (إدارة الأقسام) */}
          {activeSection === 'categories' && (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
              <form
                onSubmit={handleSaveCategory}
                className="lg:col-span-5 rounded-2xl bg-[#071636] border border-amber-400/30 p-5 space-y-3"
              >
                <h2 className="text-base font-extrabold text-amber-300">
                  {editingCatId ? 'تعديل قسم' : 'إضافة قسم جديد'}
                </h2>
                <input
                  type="text"
                  value={catName}
                  onChange={(e) => setCatName(e.target.value)}
                  placeholder="اسم القسم"
                  className="w-full h-10 px-3 rounded-xl bg-[#040E24] border border-sky-400/30 text-white placeholder:text-slate-400 text-sm"
                />
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={catImage}
                    onChange={(e) => setCatImage(e.target.value)}
                    placeholder="رابط الصورة أو ارفع"
                    className="flex-1 h-10 px-3 rounded-xl bg-[#040E24] border border-sky-400/30 text-white placeholder:text-slate-400 text-xs"
                  />
                  <label className="h-10 px-3 rounded-xl bg-sky-500/20 border border-sky-400/40 text-sky-200 text-xs font-bold inline-flex items-center gap-1 cursor-pointer shrink-0">
                    <ImagePlus className="w-4 h-4" />
                    <span>رفع</span>
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) =>
                        handleUploadSingleImage(e.target.files?.[0], setCatImage)
                      }
                    />
                  </label>
                </div>
                <input
                  type="number"
                  value={catSort}
                  onChange={(e) => setCatSort(e.target.value)}
                  placeholder="الترتيب"
                  className="w-full h-10 px-3 rounded-xl bg-[#040E24] border border-sky-400/30 text-white text-sm tabular-nums"
                />
                <label className="flex items-center gap-2 text-xs font-bold text-slate-200">
                  <input
                    type="checkbox"
                    checked={catIsParts}
                    onChange={(e) => setCatIsParts(e.target.checked)}
                    className="accent-amber-400"
                  />
                  قسم قطع غيار / إكسسوارات (سنة الصنع اختيارية)
                </label>
                <div className="flex items-center gap-2 pt-1">
                  <button
                    type="submit"
                    disabled={catSaving}
                    className="flex-1 h-10 rounded-xl bg-amber-400 hover:bg-amber-300 text-[#051029] text-sm font-extrabold inline-flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <Plus className="w-4 h-4" />
                    {editingCatId ? 'حفظ التعديل' : 'إضافة القسم'}
                  </button>
                  {editingCatId && (
                    <button
                      type="button"
                      onClick={() => {
                        setEditingCatId(null);
                        setCatName('');
                        setCatImage('');
                        setCatIsParts(false);
                      }}
                      className="h-10 px-3 rounded-xl bg-white/10 text-xs font-bold cursor-pointer"
                    >
                      إلغاء
                    </button>
                  )}
                </div>
              </form>

              <div className="lg:col-span-7 grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                {categories.map((cat) => (
                  <div
                    key={cat.id}
                    className="rounded-2xl bg-[#071636] border border-sky-400/25 p-3.5 flex items-center gap-3"
                  >
                    <div className="w-20 h-16 rounded-xl overflow-hidden shrink-0">
                      <ProgressiveImage
                        src={cat.image_url}
                        alt={cat.name_ar}
                        containerClassName="w-full h-full"
                      />
                    </div>
                    <div className="flex-1 min-w-0">
                      <h3 className="font-bold text-sm text-white truncate">
                        {cat.name_ar}
                      </h3>
                      <p className="text-xs text-slate-400 tabular-nums">
                        {cat.listings_count ?? 0} منشور · ترتيب {cat.sort_order}
                      </p>
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => {
                          setEditingCatId(cat.id);
                          setCatName(cat.name_ar);
                          setCatImage(cat.image_url);
                          setCatIsParts(cat.is_parts_or_accessories);
                          setCatSort(String(cat.sort_order));
                        }}
                        className="w-9 h-9 rounded-lg hover:bg-white/10 flex items-center justify-center text-sky-300 cursor-pointer"
                      >
                        <Edit3 className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteCategory(cat.id)}
                        className="w-9 h-9 rounded-lg hover:bg-red-500/20 flex items-center justify-center text-red-400 cursor-pointer"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* SECTION 6B: SYNONYM DICTIONARY (قاموس المرادفات) */}
          {activeSection === 'synonyms' && (() => {
            const pendingTerms = synonyms.filter(
              (s) => !s.is_active && s.target_type === 'ambiguous'
            );
            const filteredSynonyms = synonyms.filter((s) => {
              const q = synSearchFilter.trim().toLowerCase();
              if (!q) return true;
              return (
                s.term.toLowerCase().includes(q) ||
                s.canonical_value.toLowerCase().includes(q) ||
                (s.category_name || '').toLowerCase().includes(q) ||
                (s.notes || '').toLowerCase().includes(q)
              );
            });

            return (
              <section className="space-y-5">
                {/* Pending Ambiguous Local Terms Banner (e.g. دايوان، بطح) */}
                {pendingTerms.length > 0 && (
                  <div className="rounded-2xl bg-amber-500/10 border border-amber-400/50 p-4 sm:p-5 space-y-3">
                    <div className="flex items-start gap-2.5">
                      <HelpCircle className="w-5 h-5 text-amber-300 shrink-0 mt-0.5" />
                      <div>
                        <h2 className="text-sm sm:text-base font-extrabold text-amber-300">
                          مصطلحات محلية بانتظار التحديد والربط ({pendingTerms.length})
                        </h2>
                        <p className="text-xs text-slate-300 mt-0.5 leading-relaxed">
                          لا يقوم النظام بتخمين معنى المصطلحات المحلية الغامضة أو ربطها بنوع خاطئ. حدّد الماركة أو القسم المقصود لكل مصطلح لتفعيله في البحث الذكي.
                        </p>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {pendingTerms.map((pt) => (
                        <div
                          key={pt.id}
                          className="rounded-xl bg-[#040E24]/90 border border-amber-400/35 p-3.5 flex items-center justify-between gap-3"
                        >
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-extrabold text-white">
                                «{pt.term}»
                              </span>
                              <span className="text-[11px] font-bold text-amber-300">
                                بانتظار التحديد
                              </span>
                            </div>
                            {pt.notes && (
                              <p className="text-[11px] text-slate-400 mt-1 leading-relaxed">
                                {pt.notes}
                              </p>
                            )}
                          </div>
                          <button
                            type="button"
                            onClick={() => startEditingSynonym(pt, true)}
                            className="h-9 px-3 rounded-xl bg-amber-400 hover:bg-amber-300 text-[#051029] text-xs font-extrabold inline-flex items-center gap-1.5 shrink-0 cursor-pointer"
                          >
                            <Link2 className="w-3.5 h-3.5" />
                            <span>تحديد وربط</span>
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
                  {/* Add / Edit Synonym Form */}
                  <form
                    onSubmit={handleSaveSynonym}
                    className="lg:col-span-5 rounded-2xl bg-[#071636] border border-amber-400/30 p-5 space-y-3.5"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <h2 className="text-base font-extrabold text-amber-300">
                        {editingSynId ? `تعديل وربط: ${synTerm}` : 'إضافة مرادف أو مصطلح محلي'}
                      </h2>
                      {editingSynId && (
                        <button
                          type="button"
                          onClick={resetSynonymForm}
                          className="text-xs font-bold text-slate-300 hover:text-white cursor-pointer"
                        >
                          إلغاء التعديل
                        </button>
                      )}
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-slate-300 mb-1">
                        الكلمة / المصطلح (عربي، لهجة، أو إنجليزي)
                      </label>
                      <input
                        type="text"
                        value={synTerm}
                        onChange={(e) => setSynTerm(e.target.value)}
                        placeholder="مثلاً: دايوان، بطح، honda، مكنة"
                        className="w-full h-10 px-3 rounded-xl bg-[#040E24] border border-sky-400/30 text-white placeholder:text-slate-400 text-sm"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-slate-300 mb-1">
                        نوع الربط المقصود
                      </label>
                      <select
                        value={synTargetType}
                        onChange={(e) => {
                          const next = e.target.value as
                            | 'brand'
                            | 'category'
                            | 'keyword'
                            | 'ambiguous';
                          setSynTargetType(next);
                        }}
                        className="w-full h-10 px-3 rounded-xl bg-[#040E24] border border-sky-400/30 text-white text-sm"
                      >
                        <option value="brand">ربط بماركة محددة</option>
                        <option value="category">ربط بقسم محدد</option>
                        <option value="keyword">كلمة بديلة في الوصف والعنوان</option>
                        <option value="ambiguous">مصطلح يحتمل أكثر من معنى (توضيح للمستخدم)</option>
                      </select>
                    </div>

                    {synTargetType === 'brand' && (
                      <div>
                        <label className="block text-xs font-bold text-slate-300 mb-1">
                          الماركة المعتمدة
                        </label>
                        <input
                          type="text"
                          list="known-brands-list"
                          value={synCanonicalValue}
                          onChange={(e) => setSynCanonicalValue(e.target.value)}
                          placeholder="مثلاً: هوندا، ياماها، دايون"
                          className="w-full h-10 px-3 rounded-xl bg-[#040E24] border border-sky-400/30 text-white placeholder:text-slate-400 text-sm"
                        />
                        <datalist id="known-brands-list">
                          {knownBrands.map((b) => (
                            <option key={b} value={b} />
                          ))}
                        </datalist>
                      </div>
                    )}

                    {synTargetType === 'category' && (
                      <div>
                        <label className="block text-xs font-bold text-slate-300 mb-1">
                          القسم المقصود
                        </label>
                        <select
                          value={synCategoryId}
                          onChange={(e) => setSynCategoryId(e.target.value)}
                          className="w-full h-10 px-3 rounded-xl bg-[#040E24] border border-sky-400/30 text-white text-sm"
                        >
                          <option value="">اختر القسم بدقة...</option>
                          {categories.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.name_ar}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}

                    {synTargetType === 'keyword' && (
                      <div>
                        <label className="block text-xs font-bold text-slate-300 mb-1">
                          الكلمة أو الدلالة المعتمدة للبحث
                        </label>
                        <input
                          type="text"
                          value={synCanonicalValue}
                          onChange={(e) => setSynCanonicalValue(e.target.value)}
                          placeholder="مثلاً: بطح رياضي / كهربائي"
                          className="w-full h-10 px-3 rounded-xl bg-[#040E24] border border-sky-400/30 text-white placeholder:text-slate-400 text-sm"
                        />
                      </div>
                    )}

                    {synTargetType === 'ambiguous' && (
                      <div className="space-y-2 rounded-xl bg-[#040E24]/80 border border-sky-400/20 p-3">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-bold text-slate-200">
                            خيارات التوضيح القصيرة للمستخدم
                          </span>
                          <button
                            type="button"
                            onClick={() =>
                              setSynOptions((prev) => [
                                ...prev,
                                { label: '', categorySlug: '' },
                              ])
                            }
                            className="text-xs font-bold text-amber-300 hover:text-amber-200 cursor-pointer"
                          >
                            + إضافة خيار
                          </button>
                        </div>

                        {synOptions.length === 0 ? (
                          <p className="text-[11px] text-slate-400">
                            أضف خيارين أو أكثر ليختار المستخدم المقصود عند كتابة هذا المصطلح.
                          </p>
                        ) : (
                          synOptions.map((opt, idx) => (
                            <div
                              key={idx}
                              className="p-2 rounded-lg bg-[#071636] border border-sky-400/20 space-y-2"
                            >
                              <div className="flex items-center gap-2">
                                <input
                                  type="text"
                                  value={opt.label}
                                  onChange={(e) =>
                                    setSynOptions((prev) =>
                                      prev.map((o, i) =>
                                        i === idx ? { ...o, label: e.target.value } : o
                                      )
                                    )
                                  }
                                  placeholder="نص الزر (مثلاً: دراجات نارية)"
                                  className="flex-1 h-8 px-2.5 rounded-lg bg-[#040E24] border border-sky-400/25 text-white text-xs"
                                />
                                <button
                                  type="button"
                                  onClick={() =>
                                    setSynOptions((prev) => prev.filter((_, i) => i !== idx))
                                  }
                                  className="w-8 h-8 rounded-lg text-red-400 hover:bg-red-500/20 flex items-center justify-center cursor-pointer"
                                >
                                  <X className="w-3.5 h-3.5" />
                                </button>
                              </div>
                              <div className="grid grid-cols-2 gap-2">
                                <select
                                  value={opt.categorySlug || ''}
                                  onChange={(e) =>
                                    setSynOptions((prev) =>
                                      prev.map((o, i) =>
                                        i === idx
                                          ? { ...o, categorySlug: e.target.value || undefined }
                                          : o
                                      )
                                    )
                                  }
                                  className="h-8 px-2 rounded-lg bg-[#040E24] border border-sky-400/25 text-white text-xs"
                                >
                                  <option value="">القسم (اختياري)</option>
                                  {categories.map((c) => (
                                    <option key={c.id} value={c.slug}>
                                      {c.name_ar}
                                    </option>
                                  ))}
                                </select>
                                <input
                                  type="text"
                                  value={opt.brand || ''}
                                  onChange={(e) =>
                                    setSynOptions((prev) =>
                                      prev.map((o, i) =>
                                        i === idx
                                          ? { ...o, brand: e.target.value || undefined }
                                          : o
                                      )
                                    )
                                  }
                                  placeholder="الماركة (اختياري)"
                                  className="h-8 px-2.5 rounded-lg bg-[#040E24] border border-sky-400/25 text-white text-xs"
                                />
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                    )}

                    <div>
                      <label className="block text-xs font-bold text-slate-300 mb-1">
                        ملاحظة إدارية (اختياري)
                      </label>
                      <input
                        type="text"
                        value={synNotes}
                        onChange={(e) => setSynNotes(e.target.value)}
                        placeholder="توضيح استخدام المصطلح محلياً"
                        className="w-full h-10 px-3 rounded-xl bg-[#040E24] border border-sky-400/30 text-white placeholder:text-slate-400 text-xs"
                      />
                    </div>

                    <label className="flex items-center gap-2 text-xs font-bold text-slate-200 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={synIsActive}
                        onChange={(e) => setSynIsActive(e.target.checked)}
                        className="accent-amber-400"
                      />
                      <span>تفعيل المرادف مباشرة في البحث الذكي</span>
                    </label>

                    <button
                      type="submit"
                      disabled={synSaving}
                      className="w-full h-10 rounded-xl bg-amber-400 hover:bg-amber-300 text-[#051029] text-sm font-extrabold inline-flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-60"
                    >
                      <Plus className="w-4 h-4" />
                      <span>
                        {synSaving
                          ? 'جاري الحفظ...'
                          : editingSynId
                            ? 'حفظ الربط والتحديث'
                            : 'إضافة إلى القاموس'}
                      </span>
                    </button>
                  </form>

                  {/* Existing Synonyms List */}
                  <div className="lg:col-span-7 space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h3 className="text-sm sm:text-base font-extrabold text-white">
                        المرادفات المسجلة ({filteredSynonyms.length})
                      </h3>
                      <div className="relative w-full sm:w-64">
                        <Search className="w-4 h-4 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                        <input
                          type="search"
                          value={synSearchFilter}
                          onChange={(e) => setSynSearchFilter(e.target.value)}
                          placeholder="ابحث داخل القاموس..."
                          className="w-full h-9 pr-9 pl-3 rounded-xl bg-[#071636] border border-sky-400/30 text-white placeholder:text-slate-400 text-xs"
                        />
                      </div>
                    </div>

                    <div className="space-y-2.5">
                      {filteredSynonyms.map((s) => {
                        const typeLabel =
                          s.target_type === 'brand'
                            ? 'ماركة'
                            : s.target_type === 'category'
                              ? 'قسم'
                              : s.target_type === 'keyword'
                                ? 'كلمة بديلة'
                                : 'متعدد المعاني';
                        const targetSummary =
                          s.target_type === 'category'
                            ? s.category_name || s.canonical_value || 'غير محدد'
                            : s.target_type === 'ambiguous'
                              ? s.disambiguation_options?.length
                                ? s.disambiguation_options.map((o) => o.label).join(' · ')
                                : 'بانتظار تحديد الإدارة'
                              : s.canonical_value || 'غير محدد';

                        return (
                          <div
                            key={s.id}
                            className={`rounded-2xl p-3.5 border flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
                              s.is_active
                                ? 'bg-[#071636] border-sky-400/25'
                                : 'bg-[#071636]/55 border-amber-400/35'
                            }`}
                          >
                            <div className="min-w-0 space-y-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="font-extrabold text-sm text-white">
                                  {s.term}
                                </span>
                                <span className="text-[11px] font-bold px-2 py-0.5 rounded-lg bg-sky-500/20 text-sky-200 border border-sky-400/30">
                                  {typeLabel}
                                </span>
                                <span
                                  className={`text-[11px] font-bold ${
                                    s.is_active ? 'text-teal-300' : 'text-amber-300'
                                  }`}
                                >
                                  {s.is_active ? 'مفعّل' : 'موقوف / بانتظار التحديد'}
                                </span>
                              </div>
                              <p className="text-xs text-slate-300 truncate">
                                المقصود: <span className="text-amber-200 font-bold">{targetSummary}</span>
                              </p>
                              {s.notes && (
                                <p className="text-[11px] text-slate-400">{s.notes}</p>
                              )}
                            </div>

                            <div className="flex items-center gap-1.5 shrink-0">
                              <button
                                type="button"
                                onClick={() => handleToggleSynonymActive(s)}
                                className={`h-8 px-2.5 rounded-lg text-[11px] font-bold cursor-pointer ${
                                  s.is_active
                                    ? 'bg-white/10 text-slate-200 hover:bg-white/15'
                                    : 'bg-teal-500/20 border border-teal-400/40 text-teal-200'
                                }`}
                              >
                                {s.is_active ? 'إيقاف' : 'تفعيل'}
                              </button>
                              <button
                                type="button"
                                onClick={() => startEditingSynonym(s)}
                                aria-label="تعديل المرادف"
                                className="w-8 h-8 rounded-lg hover:bg-white/10 flex items-center justify-center text-sky-300 cursor-pointer"
                              >
                                <Edit3 className="w-4 h-4" />
                              </button>
                              <button
                                type="button"
                                onClick={() => handleDeleteSynonym(s.id)}
                                aria-label="حذف المرادف"
                                className="w-8 h-8 rounded-lg hover:bg-red-500/20 flex items-center justify-center text-red-400 cursor-pointer"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </section>
            );
          })()}

          {/* SECTION 7: REPORTS (البلاغات والشكاوى) */}
          {activeSection === 'reports' && (
            <section className="space-y-3">
              <h2 className="text-base sm:text-lg font-extrabold text-white">
                البلاغات والشكاوى ({reports.length})
              </h2>
              {reports.length === 0 ? (
                <div className="rounded-2xl bg-[#071636] border border-sky-400/20 p-10 text-center text-sm text-slate-400">
                  لا توجد بلاغات حالياً.
                </div>
              ) : (
                reports.map((rep) => (
                  <div
                    key={rep.id}
                    className="rounded-2xl bg-[#071636] border border-sky-400/25 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-sm text-white">
                          {rep.listing_title}
                        </span>
                        <span
                          className={`text-xs font-bold ${
                            rep.status === 'open'
                              ? 'text-[#F96B11]'
                              : rep.status === 'reviewed'
                                ? 'text-teal-300'
                                : 'text-slate-400'
                          }`}
                        >
                          {rep.status === 'open'
                            ? 'بلاغ مفتوح'
                            : rep.status === 'reviewed'
                              ? 'تمت المعالجة'
                              : 'مُتجاهل'}
                        </span>
                      </div>
                      <p className="text-xs font-bold text-amber-300 mt-1">
                        السبب: {rep.reason}
                      </p>
                      {rep.details && (
                        <p className="text-xs text-slate-300 mt-1">
                          {rep.details}
                        </p>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => handleReportStatus(rep.id, 'reviewed')}
                        className="h-9 px-3 rounded-lg bg-teal-500/20 border border-teal-400/40 text-teal-200 text-xs font-bold cursor-pointer"
                      >
                        تمت المعالجة
                      </button>
                      <button
                        type="button"
                        onClick={() => handleReportStatus(rep.id, 'dismissed')}
                        className="h-9 px-3 rounded-lg bg-white/10 text-slate-200 text-xs font-bold cursor-pointer"
                      >
                        تجاهل
                      </button>
                      <button
                        type="button"
                        onClick={async () => {
                          await handleChangeListingStatus(
                            rep.listing_id,
                            'rejected'
                          );
                          await handleReportStatus(rep.id, 'reviewed');
                        }}
                        className="h-9 px-3 rounded-lg bg-red-500/20 border border-red-400/40 text-red-200 text-xs font-bold inline-flex items-center gap-1 cursor-pointer"
                      >
                        <X className="w-3.5 h-3.5" />
                        إيقاف المنشور
                      </button>
                    </div>
                  </div>
                ))
              )}
            </section>
          )}

          {/* SECTION 8: NOTIFICATIONS (الإشعارات) */}
          {activeSection === 'notifications' && (
            <section className="space-y-4">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-base sm:text-lg font-extrabold text-white">
                  الإشعارات ({unreadNotifsCount} غير مقروءة)
                </h2>
                {unreadNotifsCount > 0 && (
                  <button
                    type="button"
                    onClick={handleMarkAllRead}
                    className="h-9 px-3.5 rounded-xl bg-sky-500/20 border border-sky-400/40 text-sky-200 text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer"
                  >
                    <CheckCheck className="w-4 h-4" />
                    <span>تحديد الكل كمقروء</span>
                  </button>
                )}
              </div>

              {notifications.length === 0 ? (
                <div className="rounded-2xl bg-[#071636] border border-sky-400/20 p-10 text-center text-sm text-slate-400">
                  لا توجد إشعارات مسجلة حتى الآن.
                </div>
              ) : (
                <div className="space-y-2.5">
                  {notifications.map((n) => (
                    <button
                      key={n.id}
                      type="button"
                      onClick={() => handleMarkNotificationRead(n)}
                      className={`w-full text-right rounded-2xl p-4 border transition-colors flex items-start justify-between gap-3 cursor-pointer ${
                        n.is_read
                          ? 'bg-[#071636]/60 border-sky-400/15 text-slate-300'
                          : 'bg-[#0B204A] border-amber-400/45 text-white'
                      }`}
                    >
                      <div className="space-y-1">
                        <p className="text-sm font-bold">{n.title}</p>
                        {n.body && (
                          <p className="text-xs text-slate-300">{n.body}</p>
                        )}
                        <p className="text-[11px] text-slate-400">
                          {formatArabicDate(n.created_at)}
                        </p>
                      </div>
                      {!n.is_read && (
                        <span className="text-[11px] font-extrabold text-[#F96B11] shrink-0">
                          جديد
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </section>
          )}

          {/* SECTION 9: SETTINGS (الإعدادات) */}
          {activeSection === 'settings' && (
            <div className="space-y-5">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 items-start">
                <form
                  onSubmit={handleSaveSettings}
                  className="rounded-2xl bg-[#071636] border border-sky-400/30 p-5 space-y-4"
                >
                  <h2 className="text-base font-extrabold text-amber-300">
                    إعدادات المنصة والمراجعة
                  </h2>

                  <div>
                    <label className="block text-xs font-bold text-slate-300 mb-1.5">
                      اسم المنصة
                    </label>
                    <input
                      type="text"
                      value={settings.platform_name || ''}
                      onChange={(e) =>
                        setSettings((s) => ({ ...s, platform_name: e.target.value }))
                      }
                      className="w-full h-10 px-3 rounded-xl bg-[#040E24] border border-sky-400/30 text-white text-sm"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-300 mb-1.5">
                      سياسة / رسالة المراجعة
                    </label>
                    <textarea
                      rows={3}
                      value={settings.moderation_note || ''}
                      onChange={(e) =>
                        setSettings((s) => ({
                          ...s,
                          moderation_note: e.target.value,
                        }))
                      }
                      className="w-full p-3 rounded-xl bg-[#040E24] border border-sky-400/30 text-white text-sm"
                    />
                  </div>

                  <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-400/30 text-xs text-emerald-200 leading-relaxed flex items-start gap-2">
                    <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                    <span>
                      سياسة النشر الآمن مفعّلة إجبارياً على الخادم: جميع المنشورات
                      الجديدة تبدأ بحالة «قيد المراجعة» ولا تُنشر للعامة إلا بعد
                      موافقة الإدارة.
                    </span>
                  </div>

                  <button
                    type="submit"
                    disabled={savingSettings}
                    className="h-10 px-5 rounded-xl bg-amber-400 hover:bg-amber-300 text-[#051029] text-sm font-extrabold cursor-pointer"
                  >
                    {savingSettings ? 'جاري الحفظ...' : 'حفظ الإعدادات'}
                  </button>
                </form>

                <form
                  onSubmit={handleSaveNewPin}
                  className="rounded-2xl bg-[#071636] border border-amber-400/30 p-5 space-y-4"
                >
                  <div className="flex items-center gap-2 text-amber-300">
                    <KeyRound className="w-5 h-5" />
                    <h2 className="text-base font-extrabold">
                      تغيير الرمز السري للوحة الإدارة
                    </h2>
                  </div>
                  <p className="text-xs text-slate-300 leading-relaxed">
                    يُحفظ الرمز الجديد مشفّراً على الخادم فقط، وعند تغييره يتم إبطال
                    جميع جلسات الإدارة السابقة فوراً.
                  </p>

                  <div>
                    <label className="block text-xs font-bold text-slate-300 mb-1.5">
                      الرمز الحالي
                    </label>
                    <input
                      type="password"
                      inputMode="text"
                      autoComplete="current-password"
                      value={currentPinInput}
                      onChange={(e) => setCurrentPinInput(e.target.value)}
                      placeholder="أدخل الرمز الحالي للتحقق"
                      className="w-full h-10 px-3 rounded-xl bg-[#040E24] border border-sky-400/30 text-white placeholder:text-slate-400 text-sm text-center tracking-widest"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-300 mb-1.5">
                      الرمز الجديد أو عبارة المرور (6 إلى 128 خانة)
                    </label>
                    <input
                      type="password"
                      inputMode="text"
                      autoComplete="new-password"
                      value={newPinInput}
                      onChange={(e) => setNewPinInput(e.target.value)}
                      placeholder="أدخل الرمز الجديد أو عبارة المرور"
                      className="w-full h-10 px-3 rounded-xl bg-[#040E24] border border-sky-400/30 text-white placeholder:text-slate-400 text-sm text-center tracking-widest"
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={savingPin || !currentPinInput.trim() || newPinInput.trim().length < 6}
                    className="h-10 px-5 rounded-xl bg-sky-500 hover:bg-sky-400 text-white text-sm font-extrabold cursor-pointer disabled:opacity-50"
                  >
                    {savingPin ? 'جاري التحديث...' : 'تحديث الرمز السري'}
                  </button>
                </form>
              </div>

              {/* Security Audit Log Table */}
              <div className="rounded-2xl bg-[#071636] border border-sky-400/25 p-5 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-amber-300">
                    <ShieldCheck className="w-5 h-5" />
                    <h2 className="text-base font-extrabold">
                      سجل الأمان والإدارة (آخر 50 حدثًا)
                    </h2>
                  </div>
                  <span className="text-[11px] text-slate-400">للقراءة فقط</span>
                </div>

                {auditLogs.length === 0 ? (
                  <p className="text-xs text-slate-400 py-4 text-center">
                    لا توجد أحداث مسجلة حتى الآن.
                  </p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-right text-xs">
                      <thead>
                        <tr className="border-b border-sky-400/20 text-slate-400">
                          <th className="py-2 px-2 font-bold">الحدث</th>
                          <th className="py-2 px-2 font-bold">الفاعل</th>
                          <th className="py-2 px-2 font-bold">العنوان</th>
                          <th className="py-2 px-2 font-bold">الهدف / التفاصيل</th>
                          <th className="py-2 px-2 font-bold">التوقيت</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-sky-400/10">
                        {auditLogs.map((log) => (
                          <tr key={log.id} className="text-slate-200 hover:bg-white/5">
                            <td className="py-2 px-2 font-bold text-amber-200 whitespace-nowrap">
                              {log.event_type}
                            </td>
                            <td className="py-2 px-2 whitespace-nowrap">{log.actor}</td>
                            <td className="py-2 px-2 font-mono text-[11px] text-slate-300 whitespace-nowrap">
                              {log.ip_address || '—'}
                            </td>
                            <td className="py-2 px-2 text-slate-300">
                              {log.target_type ? `${log.target_type}${log.target_id ? ` #${log.target_id}` : ''}` : ''}
                              {log.details ? ` — ${log.details}` : ''}
                            </td>
                            <td className="py-2 px-2 text-slate-400 whitespace-nowrap">
                              {formatArabicDate(log.created_at)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}
        </main>
      </div>

      {/* LEFT SIDEBAR DRAWER (Second in RTL flex => sits on LEFT edge on desktop, slides from LEFT on mobile!) */}
      <aside
        aria-label="قائمة لوحة الإدارة"
        className={`fixed inset-y-0 left-0 z-50 w-72 bg-[#06112B] border-r border-sky-400/20 flex flex-col transition-transform duration-200 ease-out lg:static lg:translate-x-0 lg:shrink-0 ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        {/* Top Darajati Gold Brand Logo */}
        <div className="px-5 pt-5 pb-4 border-b border-sky-400/15 flex items-center justify-between">
          <div className="flex items-center gap-2.5 mx-auto lg:mx-0">
            <svg viewBox="0 0 64 42" className="w-10 h-10" fill="none" aria-hidden="true">
              <circle cx="15" cy="29" r="9" stroke="#FBBF24" strokeWidth="3.2" />
              <circle cx="15" cy="29" r="3" fill="#F59E0B" />
              <circle cx="50" cy="29" r="9" stroke="#FBBF24" strokeWidth="3.2" />
              <circle cx="50" cy="29" r="3" fill="#F59E0B" />
              <path
                d="M15 29L24 18H36L45 12L52 20L50 29"
                stroke="#FDE68A"
                strokeWidth="2.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <path
                d="M20 17C24 13 33 12 40 14L47 19C44 22 36 24 28 24L20 17Z"
                fill="#F59E0B"
              />
            </svg>
            <span className="text-2xl font-extrabold text-amber-300 tracking-tight">
              دراجتي
            </span>
          </div>

          <button
            type="button"
            onClick={() => setSidebarOpen(false)}
            aria-label="إغلاق القائمة"
            className="lg:hidden w-9 h-9 rounded-lg text-slate-400 hover:text-white flex items-center justify-center cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Scrollable Navigation Links */}
        <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-1.5">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeSection === item.id;
            const hasBadge = typeof item.badge === 'number' && item.badge > 0;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => selectSection(item.id)}
                className={`relative w-full px-3.5 rounded-xl flex items-center justify-between gap-2 text-sm font-bold transition-all cursor-pointer ${
                  hasBadge ? 'pt-5 pb-2.5 mt-1' : 'h-12'
                } ${
                  isActive
                    ? 'border border-amber-400/80 bg-amber-400/10 text-amber-300 shadow-[0_0_16px_rgba(245,158,11,0.18)]'
                    : 'border border-transparent text-slate-200 hover:bg-white/5 hover:text-white'
                }`}
              >
                {/* Orange badge positioned cleanly above «الخدمات المضافة حديثًا» */}
                {hasBadge && (
                  <span
                    aria-label={`${item.badge} منشور بانتظار الموافقة`}
                    className="absolute top-0.5 left-1/2 -translate-x-1/2 min-w-[22px] h-5 px-1.5 rounded-full bg-[#F96B11] text-white text-[11px] font-extrabold flex items-center justify-center tabular-nums shadow-md"
                  >
                    {item.badge}
                  </span>
                )}

                <span className="flex items-center gap-3 min-w-0">
                  <Icon
                    className={`w-5 h-5 shrink-0 ${
                      isActive ? 'text-amber-300' : 'text-slate-300'
                    }`}
                  />
                  <span className="truncate">{item.label}</span>
                </span>
              </button>
            );
          })}
        </nav>

        {/* Bottom Actions: Return to App + Logout */}
        <div className="p-4 border-t border-sky-400/15 space-y-2.5 shrink-0">
          <button
            type="button"
            onClick={onBackToApp}
            className="w-full h-11 rounded-xl border border-amber-400/75 bg-amber-400/10 hover:bg-amber-400/20 text-amber-200 text-sm font-bold flex items-center justify-center gap-2 transition-colors cursor-pointer"
          >
            <ExternalLink className="w-4 h-4" />
            <span>العودة للتطبيق</span>
          </button>

          <button
            type="button"
            onClick={handleLogout}
            className="w-full h-10 rounded-xl text-slate-300 hover:text-red-300 hover:bg-red-500/10 text-sm font-bold flex items-center justify-center gap-2 transition-colors cursor-pointer"
          >
            <LogOut className="w-4 h-4" />
            <span>خروج من الإدارة</span>
          </button>
        </div>
      </aside>

      {/* ADD / EDIT LISTING MODAL */}
      {addListingModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
          <div className="w-full max-w-2xl bg-[#071636] border border-amber-400/50 rounded-2xl p-5 sm:p-6 shadow-2xl space-y-4 my-8 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-sky-400/20">
              <h3 className="text-base sm:text-lg font-extrabold text-amber-300">
                {editListingObj ? 'تعديل المنشور' : 'إضافة منشور جديد (منشور فوري)'}
              </h3>
              <button
                type="button"
                onClick={() => setAddListingModalOpen(false)}
                className="w-8 h-8 rounded-lg text-slate-400 hover:text-white flex items-center justify-center cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {formError && (
              <div className="p-3 rounded-xl bg-red-950/70 border border-red-400/40 text-red-200 text-xs font-bold">
                {formError}
              </div>
            )}

            <form onSubmit={handleSaveListingSubmit} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                <div>
                  <label className="block text-xs font-bold text-slate-300 mb-1">اسم الدراجة أو العنوان *</label>
                  <input
                    type="text"
                    required
                    value={formTitle}
                    onChange={(e) => setFormTitle(e.target.value)}
                    placeholder="مثلاً: هوندا سبيس 2023 نظيفة جداً"
                    className="w-full h-10 px-3 rounded-xl bg-[#040E24] border border-sky-400/30 text-white text-xs"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-300 mb-1">الماركة (اختياري)</label>
                  <input
                    type="text"
                    value={formBrand}
                    onChange={(e) => setFormBrand(e.target.value)}
                    placeholder="مثلاً: هوندا، ياماها"
                    className="w-full h-10 px-3 rounded-xl bg-[#040E24] border border-sky-400/30 text-white text-xs"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
                <div>
                  <label className="block text-xs font-bold text-slate-300 mb-1">القسم *</label>
                  <select
                    value={formCatId}
                    onChange={(e) => setFormCatId(e.target.value)}
                    className="w-full h-10 px-3 rounded-xl bg-[#040E24] border border-sky-400/30 text-white text-xs"
                  >
                    {categories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name_ar}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-300 mb-1">المحافظة *</label>
                  <select
                    value={formGov}
                    onChange={(e) => setFormGov(e.target.value)}
                    className="w-full h-10 px-3 rounded-xl bg-[#040E24] border border-sky-400/30 text-white text-xs"
                  >
                    {IRAQI_GOVERNORATES.map((g) => (
                      <option key={g} value={g}>
                        {g}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-300 mb-1">المنطقة / الحي</label>
                  <input
                    type="text"
                    value={formArea}
                    onChange={(e) => setFormArea(e.target.value)}
                    placeholder="مثلاً: المنصور"
                    className="w-full h-10 px-3 rounded-xl bg-[#040E24] border border-sky-400/30 text-white text-xs"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3.5">
                <div>
                  <label className="block text-xs font-bold text-slate-300 mb-1">سنة الصنع</label>
                  <input
                    type="number"
                    value={formModelYear}
                    onChange={(e) => setFormModelYear(e.target.value)}
                    placeholder="2024"
                    className="w-full h-10 px-3 rounded-xl bg-[#040E24] border border-sky-400/30 text-white text-xs tabular-nums"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-300 mb-1">سعة المحرك (CC)</label>
                  <input
                    type="number"
                    value={formEngineCc}
                    onChange={(e) => setFormEngineCc(e.target.value)}
                    placeholder="150"
                    className="w-full h-10 px-3 rounded-xl bg-[#040E24] border border-sky-400/30 text-white text-xs tabular-nums"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-300 mb-1">استطاعة المحرك (Watts)</label>
                  <input
                    type="number"
                    value={formMotorWatts}
                    onChange={(e) => setFormMotorWatts(e.target.value)}
                    placeholder="2000"
                    className="w-full h-10 px-3 rounded-xl bg-[#040E24] border border-sky-400/30 text-white text-xs tabular-nums"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-300 mb-1">الحالة</label>
                  <select
                    value={formCondition}
                    onChange={(e) => setFormCondition(e.target.value as 'new' | 'used')}
                    className="w-full h-10 px-3 rounded-xl bg-[#040E24] border border-sky-400/30 text-white text-xs"
                  >
                    <option value="used">مستعمل</option>
                    <option value="new">جديد (زيرو)</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                <div>
                  <label className="block text-xs font-bold text-slate-300 mb-1">السعر بالعراقي (د.ع) *</label>
                  <input
                    type="number"
                    required
                    value={formPrice}
                    onChange={(e) => setFormPrice(e.target.value)}
                    placeholder="5500000"
                    className="w-full h-10 px-3 rounded-xl bg-[#040E24] border border-sky-400/30 text-white text-xs tabular-nums"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-300 mb-1">رقم الهاتف *</label>
                  <input
                    type="text"
                    required
                    value={formPhone}
                    onChange={(e) => setFormPhone(e.target.value)}
                    placeholder="077xxxxxxxx"
                    className="w-full h-10 px-3 rounded-xl bg-[#040E24] border border-sky-400/30 text-white text-xs tabular-nums"
                  />
                </div>
              </div>

              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="formNegotiable"
                  checked={formNegotiable}
                  onChange={(e) => setFormNegotiable(e.target.checked)}
                  className="accent-amber-400"
                />
                <label htmlFor="formNegotiable" className="text-xs font-bold text-slate-200 cursor-pointer">
                  السعر قابل للتفاوض
                </label>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-300 mb-1">الوصف التفصيلي *</label>
                <textarea
                  rows={3}
                  required
                  value={formDesc}
                  onChange={(e) => setFormDesc(e.target.value)}
                  placeholder="اكتب تفاصيل الدراجة، الحالة، المواصفات والملحقات..."
                  className="w-full p-3 rounded-xl bg-[#040E24] border border-sky-400/30 text-white text-xs"
                />
              </div>

              {/* Images Uploader */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold text-slate-300">صور المنشور (حتى 10 صور)</label>
                  <label className="h-8 px-3 rounded-lg bg-sky-500/20 border border-sky-400/40 text-sky-200 text-xs font-bold inline-flex items-center gap-1 cursor-pointer">
                    <ImagePlus className="w-3.5 h-3.5" />
                    <span>إضافة صور</span>
                    <input
                      type="file"
                      multiple
                      accept="image/*"
                      className="hidden"
                      onChange={async (e) => {
                        const files = Array.from(e.target.files || []);
                        if (files.length === 0) return;
                        setUploadingImg(true);
                        try {
                          const urls = await uploadImagesApi(files);
                          setFormImages((prev) => [
                            ...prev,
                            ...urls.map((u, idx) => ({
                              url: u,
                              isCover: prev.length === 0 && idx === 0,
                            })),
                          ]);
                        } catch (err: any) {
                          notify(err?.message || 'فشل رفع الصور.');
                        } finally {
                          setUploadingImg(false);
                        }
                      }}
                    />
                  </label>
                </div>

                {formImages.length > 0 && (
                  <div className="grid grid-cols-3 sm:grid-cols-5 gap-2 pt-1">
                    {formImages.map((img, idx) => (
                      <div
                        key={idx}
                        className={`relative rounded-xl overflow-hidden aspect-square border-2 bg-[#040E24] ${
                          img.isCover ? 'border-amber-400' : 'border-sky-400/30'
                        }`}
                      >
                        <ProgressiveImage src={img.url} alt={`صورة ${idx + 1}`} containerClassName="w-full h-full" />
                        <div className="absolute inset-x-0 bottom-0 bg-black/70 p-1 flex items-center justify-between">
                          <button
                            type="button"
                            onClick={() =>
                              setFormImages((prev) =>
                                prev.map((im, i) => ({ ...im, isCover: i === idx }))
                              )
                            }
                            className={`text-[10px] font-bold px-1 rounded ${
                              img.isCover ? 'bg-amber-400 text-[#051029]' : 'text-white'
                            }`}
                          >
                            {img.isCover ? 'الغلاف' : 'اجعله غلافاً'}
                          </button>
                          <button
                            type="button"
                            onClick={() => setFormImages((prev) => prev.filter((_, i) => i !== idx))}
                            className="text-red-400 hover:text-red-300 p-0.5"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-sky-400/20">
                <button
                  type="button"
                  onClick={() => setAddListingModalOpen(false)}
                  className="h-10 px-4 rounded-xl bg-white/10 text-slate-200 text-xs font-bold cursor-pointer"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  disabled={formSaving || uploadingImg}
                  className="h-10 px-6 rounded-xl bg-amber-400 hover:bg-amber-300 text-[#051029] text-xs font-extrabold cursor-pointer disabled:opacity-50"
                >
                  {formSaving ? 'جاري الحفظ...' : editListingObj ? 'حفظ التعديلات' : 'نشر المنشور فوراً'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* DELETE CONFIRMATION MODAL */}
      {deleteListingTarget && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-[#071636] border border-red-400/50 rounded-2xl p-5 sm:p-6 shadow-2xl space-y-4">
            <div className="flex items-center gap-3 text-red-400">
              <AlertTriangle className="w-6 h-6 shrink-0" />
              <h3 className="text-base font-extrabold text-white">تأكيد حذف المنشور</h3>
            </div>
            <p className="text-xs sm:text-sm text-slate-300 leading-relaxed">
              هل أنت متأكد من حذف المنشور <span className="text-amber-300 font-bold">«{deleteListingTarget.title}»</span> نهائياً من قاعدة البيانات وتطبيق دراجتي؟
            </p>
            <div className="flex items-center justify-end gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => setDeleteListingTarget(null)}
                className="h-10 px-4 rounded-xl bg-white/10 text-slate-200 text-xs font-bold cursor-pointer"
              >
                إلغاء
              </button>
              <button
                type="button"
                onClick={async () => {
                  const id = deleteListingTarget.id;
                  setDeleteListingTarget(null);
                  await handleDeleteListing(id);
                }}
                className="h-10 px-5 rounded-xl bg-red-500 hover:bg-red-600 text-white text-xs font-extrabold cursor-pointer"
              >
                حذف نهائي
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default AdminDashboard;
