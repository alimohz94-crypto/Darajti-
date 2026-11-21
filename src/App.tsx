import React, { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  ChevronDown,
  Layers,
  Loader2,
  MapPin,
  RefreshCw,
  Search,
  SlidersHorizontal,
  Sparkles,
  Tag,
  WifiOff,
  X,
} from 'lucide-react';
import {
  Category,
  formatPriceIQD,
  IRAQI_GOVERNORATES,
  Listing,
  NearListingResult,
  SearchSuggestionResponse,
  SliderItem,
  SmartSearchChip,
  SmartSearchClarification,
  SmartSearchConflict,
} from './types';
import {
  checkServerReachable,
  clearAdminCsrfToken,
  fetchAdminAuthStatus,
  fetchCategories,
  fetchListingById,
  fetchSearchSuggestions,
  fetchSliders,
  fetchSmartSearch,
  getFavorites,
  getLastKnownServerOnline,
  getOwnerTokenForListing,
  getSavedGovernorate,
  getSavedHideDemo,
  recordPublicVisitOncePerSession,
  setSavedGovernorate,
  setSavedHideDemo,
  subscribeServerConnectivity,
  toggleFavoriteLocal,
  verifyAdminPinApi,
} from './utils/api';
import { purgeAdminAndSensitiveOfflineCaches } from './utils/offlineStore';
import { BrandLogo, ProgressiveImage } from './components/BrandLogo';
import { HeroSlider } from './components/HeroSlider';
import { ListingCard } from './components/ListingCard';
import { BottomNav } from './components/BottomNav';
import { AddListingModal } from './components/AddListingModal';
import { ListingDetailsView } from './components/ListingDetailsView';
import { PWAInstallButton } from './components/PWAInstallButton';

const AdminDashboard = React.lazy(() => import('./components/AdminDashboard'));

type PrimaryTab = 'home' | 'categories';
type RouteMode =
  | { type: 'tab'; tab: PrimaryTab }
  | { type: 'category_detail'; category: Category }
  | { type: 'listing_detail'; listingId: number }
  | { type: 'admin' };

export default function App() {
  const [route, setRoute] = useState<RouteMode>(() => {
    const params = new URLSearchParams(window.location.search);
    const listingParam = params.get('listing');
    if (listingParam && !Number.isNaN(Number(listingParam))) {
      return { type: 'listing_detail', listingId: Number(listingParam) };
    }
    return { type: 'tab', tab: 'home' };
  });

  // Real server connectivity state
  const [isOnline, setIsOnline] = useState<boolean>(() =>
    getLastKnownServerOnline()
  );
  const [offlineActionNotice, setOfflineActionNotice] = useState<string | null>(
    null
  );
  const wasOnlineRef = useRef<boolean>(isOnline);
  const offlineNoticeTimerRef = useRef<number | null>(null);

  // Core data
  const [categories, setCategories] = useState<Category[]>([]);
  const [sliders, setSliders] = useState<SliderItem[]>([]);
  const [listings, setListings] = useState<Listing[]>([]);
  const [loadingListings, setLoadingListings] = useState(true);
  const [listingsError, setListingsError] = useState<string | null>(null);
  const [initialBootError, setInitialBootError] = useState<string | null>(null);

  // Selected listing detail state
  const [detailListing, setDetailListing] = useState<Listing | null>(null);
  const [detailIsOwner, setDetailIsOwner] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  // Filters & preferences
  const [governorate, setGovernorate] = useState<string>(() =>
    getSavedGovernorate()
  );
  const [searchInput, setSearchInput] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [filterCategoryId, setFilterCategoryId] = useState<number | null>(null);
  const [minPrice, setMinPrice] = useState('');
  const [maxPrice, setMaxPrice] = useState('');
  const [filterCondition, setFilterCondition] = useState<'new' | 'used' | ''>('');
  const [filterBrand, setFilterBrand] = useState('');
  const [ignoredChips, setIgnoredChips] = useState<string[]>([]);
  const [sortBy, setSortBy] = useState<'newest' | 'price_asc' | 'price_desc'>(
    'newest'
  );
  const [hideDemo, setHideDemo] = useState<boolean>(() => getSavedHideDemo());
  const [showFiltersPanel, setShowFiltersPanel] = useState(false);

  // Smart search feedback & live suggestions
  const [nearResults, setNearResults] = useState<NearListingResult[]>([]);
  const [smartChips, setSmartChips] = useState<SmartSearchChip[]>([]);
  const [smartConflicts, setSmartConflicts] = useState<SmartSearchConflict[]>([]);
  const [smartClarifications, setSmartClarifications] = useState<SmartSearchClarification[]>([]);
  const [suggestions, setSuggestions] = useState<SearchSuggestionResponse | null>(null);
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const searchBoxRef = useRef<HTMLDivElement>(null);

  // Favorites & Add Modal
  const [favorites, setFavorites] = useState<number[]>(() => getFavorites());
  const [addModalOpen, setAddModalOpen] = useState(false);

  // Triple-tap Admin PIN gate state
  const [adminPinOpen, setAdminPinOpen] = useState(false);
  const [adminPinValue, setAdminPinValue] = useState('');
  const [adminPinError, setAdminPinError] = useState<string | null>(null);
  const [verifyingPin, setVerifyingPin] = useState(false);
  const brandClicksRef = useRef<number[]>([]);
  const brandResetTimerRef = useRef<number | null>(null);
  const pinVerifyTimerRef = useRef<number | null>(null);
  const adminGateRef = useRef<HTMLDivElement>(null);
  const pinInputRef = useRef<HTMLInputElement>(null);

  // Record public storefront visit once per session (exclude admin)
  useEffect(() => {
    if (route.type !== 'admin') {
      recordPublicVisitOncePerSession();
    }
  }, [route.type]);

  const showTransientNotice = useCallback((msg: string) => {
    setOfflineActionNotice(msg);
    if (offlineNoticeTimerRef.current) {
      window.clearTimeout(offlineNoticeTimerRef.current);
    }
    offlineNoticeTimerRef.current = window.setTimeout(() => {
      setOfflineActionNotice(null);
      offlineNoticeTimerRef.current = null;
    }, 3500);
  }, []);

  // Verify initial /admin route silently without ever disclosing protected UI to unauthorized visitors
  useEffect(() => {
    if (window.location.pathname === '/admin') {
      fetchAdminAuthStatus().then((status) => {
        if (status.authenticated && status.username) {
          setRoute({ type: 'admin' });
        } else {
          clearAdminCsrfToken();
          window.history.replaceState({}, '', '/');
          setRoute({ type: 'tab', tab: 'home' });
        }
      });
    }
  }, []);

  // Real connectivity listener + periodic server reachability verification + popstate
  useEffect(() => {
    const unsubConnectivity = subscribeServerConnectivity((online) => {
      setIsOnline(online);
    });

    const verifyNow = () => {
      checkServerReachable();
    };
    verifyNow();

    const onOnlineEvent = () => {
      checkServerReachable();
    };
    const onOfflineEvent = () => {
      setIsOnline(false);
    };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        checkServerReachable();
      }
    };

    window.addEventListener('online', onOnlineEvent);
    window.addEventListener('offline', onOfflineEvent);
    window.addEventListener('focus', verifyNow);
    document.addEventListener('visibilitychange', onVisibility);

    const onPopState = async () => {
      const path = window.location.pathname;
      const params = new URLSearchParams(window.location.search);
      if (path === '/admin') {
        const status = await fetchAdminAuthStatus();
        if (status.authenticated && status.username) {
          setRoute({ type: 'admin' });
        } else {
          clearAdminCsrfToken();
          window.history.replaceState({}, '', '/');
          setRoute({ type: 'tab', tab: 'home' });
        }
        return;
      }
      const listingParam = params.get('listing');
      if (listingParam && !Number.isNaN(Number(listingParam))) {
        setRoute({ type: 'listing_detail', listingId: Number(listingParam) });
        return;
      }
      setRoute({ type: 'tab', tab: 'home' });
    };
    window.addEventListener('popstate', onPopState);

    return () => {
      unsubConnectivity();
      window.removeEventListener('online', onOnlineEvent);
      window.removeEventListener('offline', onOfflineEvent);
      window.removeEventListener('focus', verifyNow);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('popstate', onPopState);
    };
  }, []);

  // Periodic server reachability check (faster while offline or inside protected workspace)
  useEffect(() => {
    const intervalMs = !isOnline || route.type === 'admin' ? 10000 : 30000;
    const timer = window.setInterval(() => {
      checkServerReachable();
    }, intervalMs);
    return () => window.clearInterval(timer);
  }, [isOnline, route.type]);

  // Immediately close/hide any protected input or workspace if connection drops
  useEffect(() => {
    if (!isOnline) {
      purgeAdminAndSensitiveOfflineCaches();
      brandClicksRef.current = [];
      if (brandResetTimerRef.current) {
        window.clearTimeout(brandResetTimerRef.current);
        brandResetTimerRef.current = null;
      }
      if (pinVerifyTimerRef.current) {
        window.clearTimeout(pinVerifyTimerRef.current);
        pinVerifyTimerRef.current = null;
      }
      setAdminPinOpen(false);
      setAdminPinValue('');
      setAdminPinError(null);
      setVerifyingPin(false);

      if (route.type === 'admin') {
        clearAdminCsrfToken();
        if (window.location.pathname === '/admin') {
          window.history.replaceState({}, '', '/');
        }
        setRoute({ type: 'tab', tab: 'home' });
      }
    }
  }, [isOnline, route.type]);

  // Debounce search query & reset ignored chips when user modifies query text
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedSearch(searchInput.trim());
    }, 240);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => {
    setIgnoredChips([]);
  }, [searchInput]);

  // Live autocomplete suggestions while typing
  useEffect(() => {
    const trimmed = searchInput.trim();
    if (!trimmed) {
      setSuggestions(null);
      return;
    }
    const timer = window.setTimeout(async () => {
      try {
        const res = await fetchSearchSuggestions(trimmed);
        setSuggestions(res);
      } catch {
        setSuggestions(null);
      }
    }, 150);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  // Close suggestions popover when clicking outside
  useEffect(() => {
    if (!suggestionsOpen) return;
    const handleOutside = (e: MouseEvent | TouchEvent) => {
      if (searchBoxRef.current && !searchBoxRef.current.contains(e.target as Node)) {
        setSuggestionsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutside);
    document.addEventListener('touchstart', handleOutside);
    return () => {
      document.removeEventListener('mousedown', handleOutside);
      document.removeEventListener('touchstart', handleOutside);
    };
  }, [suggestionsOpen]);

  // Persist user preferences
  const handleGovernorateChange = (gov: string) => {
    setGovernorate(gov);
    setSavedGovernorate(gov);
  };

  const handleHideDemoToggle = (next: boolean) => {
    setHideDemo(next);
    setSavedHideDemo(next);
  };

  // Load categories & sliders
  const loadBootData = useCallback(async () => {
    setInitialBootError(null);
    try {
      const [cats, slds] = await Promise.all([
        fetchCategories(),
        fetchSliders(),
      ]);
      setCategories(cats);
      setSliders(slds);
    } catch (err: any) {
      setInitialBootError(err?.message || 'تعذر تحميل الأقسام والعروض.');
    }
  }, []);

  useEffect(() => {
    loadBootData();
  }, [loadBootData]);

  // Active category ID depends on route (home vs category detail)
  const effectiveCategoryId =
    route.type === 'category_detail' ? route.category.id : filterCategoryId;

  const loadListings = useCallback(async () => {
    if (route.type === 'admin' || route.type === 'listing_detail') return;
    setLoadingListings(true);
    setListingsError(null);
    try {
      const res = await fetchSmartSearch({
        q: debouncedSearch,
        governorate,
        categoryId: effectiveCategoryId,
        minPrice,
        maxPrice,
        sort: sortBy,
        hideDemo,
        ignoredChips,
        condition: filterCondition,
        brand: filterBrand,
      });
      setListings(res.items);
      setNearResults(res.nearResults || []);
      setSmartChips(res.chips || []);
      setSmartConflicts(res.conflicts || []);
      setSmartClarifications(res.clarifications || []);
    } catch (err: any) {
      setListingsError(err?.message || 'تعذر الاتصال بالخادم لتحميل الدراجات.');
    } finally {
      setLoadingListings(false);
    }
  }, [
    route.type,
    debouncedSearch,
    governorate,
    effectiveCategoryId,
    minPrice,
    maxPrice,
    sortBy,
    hideDemo,
    ignoredChips,
    filterCondition,
    filterBrand,
  ]);

  useEffect(() => {
    loadListings();
  }, [loadListings]);

  // Load detail listing when entering listing_detail route
  const openListingDetail = useCallback(async (listingId: number, pushUrl = true) => {
    if (pushUrl) {
      window.history.pushState({}, '', `/?listing=${listingId}`);
    }
    setRoute({ type: 'listing_detail', listingId });
    setDetailLoading(true);
    setDetailError(null);
    try {
      const ownerToken = getOwnerTokenForListing(listingId);
      const res = await fetchListingById(listingId, ownerToken);
      setDetailListing(res.listing);
      setDetailIsOwner(res.isOwner);
    } catch (err: any) {
      setDetailError(err?.message || 'تعذر تحميل تفاصيل المنشور.');
      setDetailListing(null);
    } finally {
      setDetailLoading(false);
    }
  }, []);

  useEffect(() => {
    if (route.type === 'listing_detail' && (!detailListing || detailListing.id !== route.listingId)) {
      openListingDetail(route.listingId, false);
    }
  }, [route, detailListing, openListingDetail]);

  // Automatically refresh data when connection comes back online
  useEffect(() => {
    const prev = wasOnlineRef.current;
    wasOnlineRef.current = isOnline;
    if (!prev && isOnline) {
      loadBootData();
      loadListings();
      if (route.type === 'listing_detail') {
        openListingDetail(route.listingId, false);
      }
    }
  }, [isOnline, loadBootData, loadListings, openListingDetail, route]);

  const handleRequestOpenAdd = useCallback(async () => {
    if (!isOnline || !(await checkServerReachable())) {
      showTransientNotice('إضافة دراجة تحتاج اتصالًا بالإنترنت');
      return;
    }
    setAddModalOpen(true);
  }, [isOnline, showTransientNotice]);

  const navigateHome = () => {
    if (window.location.pathname !== '/' || window.location.search) {
      window.history.pushState({}, '', '/');
    }
    setRoute({ type: 'tab', tab: 'home' });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const navigateCategories = () => {
    if (window.location.pathname !== '/' || window.location.search) {
      window.history.pushState({}, '', '/');
    }
    setRoute({ type: 'tab', tab: 'categories' });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const navigateAdmin = () => {
    window.history.pushState({}, '', '/admin');
    setRoute({ type: 'admin' });
    window.scrollTo({ top: 0 });
  };

  const openCategoryDetail = (cat: Category) => {
    setSearchInput('');
    setDebouncedSearch('');
    setMinPrice('');
    setMaxPrice('');
    setSortBy('newest');
    setRoute({ type: 'category_detail', category: cat });
    window.scrollTo({ top: 0 });
  };

  const handleToggleFavorite = (id: number) => {
    setFavorites(toggleFavoriteLocal(id));
  };

  const resetAllFilters = () => {
    setSearchInput('');
    setDebouncedSearch('');
    handleGovernorateChange('جميع المحافظات');
    setFilterCategoryId(null);
    setMinPrice('');
    setMaxPrice('');
    setFilterCondition('');
    setFilterBrand('');
    setIgnoredChips([]);
    setSortBy('newest');
    handleHideDemoToggle(false);
    setSuggestionsOpen(false);
  };

  const hasActiveFilters =
    Boolean(debouncedSearch) ||
    (governorate && governorate !== 'جميع المحافظات') ||
    (route.type !== 'category_detail' && filterCategoryId !== null) ||
    Boolean(minPrice) ||
    Boolean(maxPrice) ||
    Boolean(filterCondition) ||
    Boolean(filterBrand) ||
    sortBy !== 'newest' ||
    hideDemo;

  // Auto-focus PIN input when opened & dismiss on outside click
  useEffect(() => {
    if (!adminPinOpen) return;
    const focusTimer = window.setTimeout(() => {
      pinInputRef.current?.focus();
    }, 10);

    const handleOutside = (e: MouseEvent | TouchEvent) => {
      if (
        adminGateRef.current &&
        !adminGateRef.current.contains(e.target as Node)
      ) {
        setAdminPinOpen(false);
        setAdminPinValue('');
        setAdminPinError(null);
      }
    };

    document.addEventListener('mousedown', handleOutside);
    document.addEventListener('touchstart', handleOutside);
    return () => {
      window.clearTimeout(focusTimer);
      document.removeEventListener('mousedown', handleOutside);
      document.removeEventListener('touchstart', handleOutside);
    };
  }, [adminPinOpen]);

  const handleBrandTap = () => {
    // Completely ignore triple-tap action when offline (no field, no message)
    if (!isOnline || (typeof navigator !== 'undefined' && !navigator.onLine)) {
      brandClicksRef.current = [];
      if (brandResetTimerRef.current) {
        window.clearTimeout(brandResetTimerRef.current);
        brandResetTimerRef.current = null;
      }
      if (window.location.pathname !== '/' || window.location.search) {
        navigateHome();
      }
      return;
    }

    const now = Date.now();
    if (brandResetTimerRef.current) {
      window.clearTimeout(brandResetTimerRef.current);
      brandResetTimerRef.current = null;
    }

    const recent = [
      ...brandClicksRef.current.filter((t) => now - t <= 2000),
      now,
    ];
    brandClicksRef.current = recent;

    if (recent.length >= 3) {
      brandClicksRef.current = [];
      setAdminPinOpen(true);
      setAdminPinValue('');
      setAdminPinError(null);
      // Confirm real server reachability in background; if offline, silently close & clear
      checkServerReachable().then((reachable) => {
        if (!reachable) {
          setAdminPinOpen(false);
          setAdminPinValue('');
          setAdminPinError(null);
        }
      });
    } else {
      brandResetTimerRef.current = window.setTimeout(() => {
        brandClicksRef.current = [];
        brandResetTimerRef.current = null;
      }, 2000);
      if (window.location.pathname !== '/' || window.location.search) {
        navigateHome();
      }
    }
  };

  const submitPinForVerification = async (rawCandidate: string) => {
    const trimmed = rawCandidate.trim();
    if (verifyingPin || trimmed.length < 4) return;
    if (pinVerifyTimerRef.current) {
      window.clearTimeout(pinVerifyTimerRef.current);
      pinVerifyTimerRef.current = null;
    }
    if (!isOnline || !(await checkServerReachable())) {
      setAdminPinOpen(false);
      setAdminPinValue('');
      setAdminPinError(null);
      return;
    }
    setVerifyingPin(true);
    try {
      const res = await verifyAdminPinApi(trimmed);
      if (res.authenticated) {
        setAdminPinOpen(false);
        setAdminPinValue('');
        setAdminPinError(null);
        navigateAdmin();
      }
    } catch (err: any) {
      if (err?.isOffline || !(await checkServerReachable())) {
        setAdminPinOpen(false);
        setAdminPinValue('');
        setAdminPinError(null);
        return;
      }
      setAdminPinValue('');
      setAdminPinError('تعذّر المتابعة');
      window.setTimeout(() => {
        pinInputRef.current?.focus();
      }, 10);
    } finally {
      setVerifyingPin(false);
    }
  };

  const handlePinInputChange = (rawValue: string) => {
    if (verifyingPin) return;
    if (pinVerifyTimerRef.current) {
      window.clearTimeout(pinVerifyTimerRef.current);
      pinVerifyTimerRef.current = null;
    }

    const arabicDigits = '٠١٢٣٤٥٦٧٨٩';
    const persianDigits = '۰۱۲۳۴۵۶۷۸۹';
    let normalized = rawValue;
    for (let i = 0; i < 10; i++) {
      normalized = normalized
        .replaceAll(arabicDigits[i], String(i))
        .replaceAll(persianDigits[i], String(i));
    }
    normalized = normalized.slice(0, 128);
    setAdminPinValue(normalized);
    if (adminPinError) setAdminPinError(null);

    const candidate = normalized.trim();
    if (candidate.length >= 6) {
      pinVerifyTimerRef.current = window.setTimeout(() => {
        submitPinForVerification(candidate);
      }, 420);
    }
  };

  // Render Protected Workspace ONLY when verified online
  if (route.type === 'admin' && isOnline) {
    return (
      <Suspense fallback={null}>
        <AdminDashboard
          onBackToApp={navigateHome}
          onDataChanged={() => {
            loadBootData();
            loadListings();
          }}
          onInspectListing={(item) => {
            setDetailListing(item);
            setDetailIsOwner(true);
            openListingDetail(item.id, true);
          }}
        />
      </Suspense>
    );
  }

  // Render Listing Detail Route
  if (route.type === 'listing_detail') {
    if (detailLoading) {
      return (
        <div className="min-h-screen bg-[#F4F6F9] flex flex-col items-center justify-center p-6 gap-3">
          <div className="w-10 h-10 border-4 border-[#0D2545]/20 border-t-[#F96B11] rounded-full animate-spin" />
          <p className="text-sm font-bold text-[#0D2545]">جاري تحميل تفاصيل المنشور...</p>
        </div>
      );
    }

    if (detailError || !detailListing) {
      return (
        <div className="min-h-screen bg-[#F4F6F9] flex flex-col items-center justify-center p-6 text-center space-y-4">
          <AlertCircle className="w-12 h-12 text-red-500" />
          <p className="text-base font-bold text-[#0D2545]">
            {detailError || 'المنشور غير متوفر.'}
          </p>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => openListingDetail(route.listingId, false)}
              className="h-11 px-5 rounded-xl bg-[#F96B11] text-white text-sm font-bold cursor-pointer"
            >
              إعادة المحاولة
            </button>
            <button
              type="button"
              onClick={navigateHome}
              className="h-11 px-5 rounded-xl bg-white border border-slate-200 text-[#0D2545] text-sm font-bold cursor-pointer"
            >
              العودة للرئيسية
            </button>
          </div>
        </div>
      );
    }

    return (
      <>
        {!isOnline && (
          <div
            role="status"
            className="bg-amber-50 border-b border-amber-200 text-amber-900 text-xs font-bold py-2 px-4 flex items-center justify-center gap-2"
          >
            <WifiOff className="w-3.5 h-3.5 text-amber-700 shrink-0" />
            <span>أنت بدون إنترنت — تعرض بيانات محفوظة</span>
          </div>
        )}
        {offlineActionNotice && (
          <div className="fixed top-16 inset-x-0 z-50 flex justify-center px-4 pointer-events-none">
            <div className="bg-[#0D2545] text-white text-xs sm:text-sm font-bold px-4 py-2.5 rounded-xl shadow-lg flex items-center gap-2">
              <WifiOff className="w-4 h-4 text-[#F96B11] shrink-0" />
              <span>{offlineActionNotice}</span>
            </div>
          </div>
        )}
        <ListingDetailsView
          listing={detailListing}
          initialIsOwner={detailIsOwner}
          isFavorite={favorites.includes(detailListing.id)}
          onToggleFavorite={handleToggleFavorite}
          onBack={() => {
            setDetailListing(null);
            navigateHome();
          }}
          onUpdated={(updated) => {
            setDetailListing(updated);
            loadListings();
          }}
          onDeleted={() => {
            setDetailListing(null);
            navigateHome();
            loadListings();
          }}
        />
        <BottomNav
          activeTab="home"
          onSelectHome={navigateHome}
          onSelectCategories={navigateCategories}
          onOpenAdd={handleRequestOpenAdd}
        />
        <AddListingModal
          isOpen={addModalOpen}
          isOnline={isOnline}
          categories={categories}
          defaultGovernorate={governorate}
          onClose={() => setAddModalOpen(false)}
          onCreatedPreview={(created) => {
            setDetailListing(created);
            setDetailIsOwner(true);
            openListingDetail(created.id, true);
          }}
        />
      </>
    );
  }

  const activeNavTab: PrimaryTab =
    (route.type === 'tab' && route.tab === 'categories') ||
    route.type === 'category_detail'
      ? 'categories'
      : 'home';

  return (
    <div className="min-h-screen bg-[#F4F6F9] flex flex-col pb-28">
      {/* Compact Offline Browsing Banner */}
      {!isOnline && (
        <div
          role="status"
          className="bg-amber-50 border-b border-amber-200 text-amber-900 text-xs font-bold py-2 px-4 flex items-center justify-center gap-2"
        >
          <WifiOff className="w-3.5 h-3.5 text-amber-700 shrink-0" />
          <span>أنت بدون إنترنت — تعرض بيانات محفوظة</span>
        </div>
      )}

      {/* Transient Offline Action Toast (e.g. Add Bike requires Internet) */}
      {offlineActionNotice && (
        <div className="fixed top-16 inset-x-0 z-50 flex justify-center px-4 pointer-events-none">
          <div className="bg-[#0D2545] text-white text-xs sm:text-sm font-bold px-4 py-2.5 rounded-xl shadow-lg flex items-center gap-2">
            <WifiOff className="w-4 h-4 text-[#F96B11] shrink-0" />
            <span>{offlineActionNotice}</span>
          </div>
        </div>
      )}

      {/* TOP HEADER */}
      {route.type === 'tab' && route.tab === 'home' && (
        <header className="bg-[#0D2545] text-white shadow-sm">
          <div className="max-w-7xl mx-auto px-4 pt-3.5 pb-4 space-y-3.5">
            {/* Top row: Brand + Governorate Picker */}
            <div className="flex items-center justify-between gap-4">
              <div ref={adminGateRef} className="relative">
                <button
                  type="button"
                  onClick={handleBrandTap}
                  className="cursor-pointer focus-visible:outline-none select-none"
                >
                  <BrandLogo light size="md" />
                </button>

                {isOnline && adminPinOpen && (
                  <div className="absolute top-full right-0 mt-2 bg-white rounded-xl p-2 shadow-xl border border-slate-200 w-44 sm:w-48 z-50">
                    <div className="relative">
                      <input
                        ref={pinInputRef}
                        type="password"
                        inputMode="text"
                        autoFocus
                        autoComplete="off"
                        disabled={verifyingPin}
                        value={adminPinValue}
                        onChange={(e) => handlePinInputChange(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            submitPinForVerification(adminPinValue);
                          }
                        }}
                        placeholder="اهلا وسهلا بكم"
                        aria-label="اهلا وسهلا بكم"
                        className="w-full h-9 pl-8 pr-2.5 rounded-lg border border-slate-200 bg-slate-50 text-[#0D2545] placeholder:text-slate-400 placeholder:tracking-normal text-xs text-center tracking-widest focus:outline-none focus:ring-2 focus:ring-[#F96B11] focus:bg-white"
                      />
                      {verifyingPin && (
                        <div className="absolute left-2.5 top-1/2 -translate-y-1/2">
                          <Loader2 className="w-4 h-4 animate-spin text-[#F96B11]" />
                        </div>
                      )}
                    </div>
                    {adminPinError && (
                      <p className="mt-1 text-[11px] font-bold text-red-600 text-center">
                        {adminPinError}
                      </p>
                    )}
                  </div>
                )}
              </div>

              {/* Governorate Selector */}
              <div className="relative flex items-center">
                <MapPin className="w-4 h-4 text-[#F96B11] absolute right-2.5 pointer-events-none" />
                <select
                  aria-label="اختر المحافظة"
                  value={governorate}
                  onChange={(e) => handleGovernorateChange(e.target.value)}
                  className="appearance-none bg-white/10 hover:bg-white/15 text-white text-xs sm:text-sm font-bold pr-8 pl-7 h-10 rounded-xl border border-white/15 focus:outline-none focus:ring-2 focus:ring-[#F96B11] cursor-pointer"
                >
                  <option value="جميع المحافظات" className="text-[#0D2545]">
                    جميع المحافظات
                  </option>
                  {IRAQI_GOVERNORATES.map((gov) => (
                    <option key={gov} value={gov} className="text-[#0D2545]">
                      {gov}
                    </option>
                  ))}
                </select>
                <ChevronDown className="w-4 h-4 text-white/80 absolute left-2 pointer-events-none" />
              </div>
            </div>

            {/* Smart Search Bar directly inside Navy Header with live autocomplete */}
            <div ref={searchBoxRef} className="relative z-30">
              <Search className="w-5 h-5 text-slate-400 absolute right-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="search"
                value={searchInput}
                onFocus={() => setSuggestionsOpen(true)}
                onChange={(e) => {
                  setSearchInput(e.target.value);
                  setSuggestionsOpen(true);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Escape' || e.key === 'Enter') {
                    setSuggestionsOpen(false);
                  }
                }}
                placeholder="ابحث باللهجة أو النص: مثلاً اريد سكوتر كهربائي بكربلاء بأقل من مليون..."
                aria-label="ابحث عن دراجة"
                className="w-full h-11 sm:h-12 pr-11 pl-10 rounded-xl bg-white text-[#0D2545] placeholder:text-slate-400 text-sm font-medium shadow-xs focus:outline-none focus:ring-2 focus:ring-[#F96B11]"
              />
              {searchInput && (
                <button
                  type="button"
                  onClick={() => {
                    setSearchInput('');
                    setSuggestions(null);
                    setSuggestionsOpen(false);
                  }}
                  aria-label="مسح البحث"
                  className="w-8 h-8 rounded-full hover:bg-slate-100 text-slate-400 flex items-center justify-center absolute left-2 top-1/2 -translate-y-1/2 cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              )}

              {/* Live Suggestions Dropdown */}
              {suggestionsOpen &&
                searchInput.trim().length > 0 &&
                suggestions &&
                (suggestions.categories.length > 0 ||
                  suggestions.brands.length > 0 ||
                  suggestions.listings.length > 0 ||
                  suggestions.clarifications.length > 0) && (
                  <div className="absolute top-full inset-x-0 mt-1.5 bg-white text-[#0D2545] rounded-2xl shadow-xl border border-slate-200 overflow-hidden max-h-[65vh] overflow-y-auto z-50">
                    {suggestions.clarifications.length > 0 && (
                      <div className="p-3 bg-amber-50/70 border-b border-amber-100 space-y-1.5">
                        {suggestions.clarifications.map((cl) => (
                          <div key={cl.term} className="space-y-1">
                            <p className="text-[11px] font-bold text-amber-900">
                              {cl.message}
                            </p>
                            <div className="flex flex-wrap gap-1.5">
                              {cl.options.map((opt) => (
                                <button
                                  key={opt.label}
                                  type="button"
                                  onClick={() => {
                                    if (opt.categoryId) {
                                      setFilterCategoryId(opt.categoryId);
                                    }
                                    if (opt.brand) {
                                      setFilterBrand(opt.brand);
                                    }
                                    if (opt.applyQuery && !opt.categoryId && !opt.brand) {
                                      setSearchInput(opt.applyQuery);
                                    }
                                    setSuggestionsOpen(false);
                                  }}
                                  className="px-2.5 py-1 rounded-lg bg-white border border-amber-300 text-xs font-bold text-[#0D2545] hover:bg-amber-100 cursor-pointer"
                                >
                                  {opt.label}
                                </button>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    {suggestions.categories.length > 0 && (
                      <div className="p-2.5 border-b border-slate-100">
                        <p className="px-2 pb-1 text-[11px] font-bold text-slate-400">
                          الأقسام المطابقة
                        </p>
                        <div className="flex flex-wrap gap-1.5 px-1">
                          {suggestions.categories.map((cat) => (
                            <button
                              key={cat.id}
                              type="button"
                              onClick={() => {
                                setFilterCategoryId(cat.id);
                                setSearchInput('');
                                setSuggestionsOpen(false);
                              }}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-[#0D2545] hover:text-white text-xs font-bold transition-colors cursor-pointer"
                            >
                              <Layers className="w-3.5 h-3.5 text-[#F96B11]" />
                              <span>{cat.name_ar}</span>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    {suggestions.brands.length > 0 && (
                      <div className="p-2.5 border-b border-slate-100">
                        <p className="px-2 pb-1 text-[11px] font-bold text-slate-400">
                          الماركات
                        </p>
                        <div className="flex flex-wrap gap-1.5 px-1">
                          {suggestions.brands.map((brand) => (
                            <button
                              key={brand}
                              type="button"
                              onClick={() => {
                                setFilterBrand(brand);
                                setSearchInput('');
                                setSuggestionsOpen(false);
                              }}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-orange-50 hover:bg-[#F96B11] hover:text-white text-[#0D2545] text-xs font-bold transition-colors cursor-pointer"
                            >
                              <Tag className="w-3.5 h-3.5 text-[#F96B11]" />
                              <span>{brand}</span>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    {suggestions.listings.length > 0 && (
                      <div className="p-2">
                        <p className="px-2.5 py-1 text-[11px] font-bold text-slate-400">
                          منشورات متاحة الآن
                        </p>
                        {suggestions.listings.map((item) => (
                          <button
                            key={item.id}
                            type="button"
                            onClick={() => {
                              setSuggestionsOpen(false);
                              openListingDetail(item.id, true);
                            }}
                            className="w-full px-2.5 py-2 rounded-xl hover:bg-slate-50 flex items-center gap-3 text-right cursor-pointer"
                          >
                            <div className="w-11 h-11 rounded-lg bg-slate-100 overflow-hidden shrink-0">
                              {item.image_url && (
                                <img
                                  src={item.image_url}
                                  alt=""
                                  className="w-full h-full object-cover"
                                />
                              )}
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-xs sm:text-sm font-bold text-[#0D2545] truncate">
                                {item.title}
                              </p>
                              <p className="text-[11px] text-slate-500 truncate">
                                {item.category_name} · {item.governorate}
                                {item.engine_cc ? ` · ${item.engine_cc} سي سي` : ''}
                              </p>
                            </div>
                            <span className="text-xs font-extrabold text-[#F96B11] tabular-nums shrink-0">
                              {formatPriceIQD(item.price_iqd)} د.ع
                            </span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
            </div>
          </div>
        </header>
      )}

      {route.type === 'tab' && route.tab === 'categories' && (
        <header className="bg-[#0D2545] text-white shadow-sm">
          <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-center">
            <h1 className="text-xl font-extrabold tracking-tight">الأقسام</h1>
          </div>
        </header>
      )}

      {route.type === 'category_detail' && (
        <header className="bg-[#0D2545] text-white shadow-sm">
          <div className="max-w-7xl mx-auto px-4 pt-3 pb-4 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <button
                type="button"
                onClick={navigateCategories}
                className="h-10 px-2.5 -mr-2 rounded-xl hover:bg-white/10 inline-flex items-center gap-1.5 text-sm font-bold cursor-pointer"
              >
                <ArrowRight className="w-5 h-5" />
                <span>الأقسام</span>
              </button>
              <h1 className="text-base sm:text-lg font-extrabold truncate">
                {route.category.name_ar}
              </h1>
              <div className="relative flex items-center">
                <select
                  aria-label="تصفية بالمحافظة"
                  value={governorate}
                  onChange={(e) => handleGovernorateChange(e.target.value)}
                  className="appearance-none bg-white/10 text-white text-xs font-bold pr-3 pl-6 h-9 rounded-xl border border-white/15 cursor-pointer"
                >
                  <option value="جميع المحافظات" className="text-[#0D2545]">
                    كل المحافظات
                  </option>
                  {IRAQI_GOVERNORATES.map((gov) => (
                    <option key={gov} value={gov} className="text-[#0D2545]">
                      {gov}
                    </option>
                  ))}
                </select>
                <ChevronDown className="w-3.5 h-3.5 text-white/80 absolute left-2 pointer-events-none" />
              </div>
            </div>

            <div ref={searchBoxRef} className="relative z-30">
              <Search className="w-5 h-5 text-slate-400 absolute right-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="search"
                value={searchInput}
                onFocus={() => setSuggestionsOpen(true)}
                onChange={(e) => {
                  setSearchInput(e.target.value);
                  setSuggestionsOpen(true);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Escape' || e.key === 'Enter') {
                    setSuggestionsOpen(false);
                  }
                }}
                placeholder={`ابحث داخل ${route.category.name_ar}...`}
                className="w-full h-11 pr-11 pl-10 rounded-xl bg-white text-[#0D2545] placeholder:text-slate-400 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-[#F96B11]"
              />
              {searchInput && (
                <button
                  type="button"
                  onClick={() => {
                    setSearchInput('');
                    setSuggestions(null);
                    setSuggestionsOpen(false);
                  }}
                  aria-label="مسح البحث"
                  className="w-8 h-8 rounded-full hover:bg-slate-100 text-slate-400 flex items-center justify-center absolute left-2 top-1/2 -translate-y-1/2 cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              )}

              {suggestionsOpen &&
                searchInput.trim().length > 0 &&
                suggestions &&
                (suggestions.categories.length > 0 ||
                  suggestions.brands.length > 0 ||
                  suggestions.listings.length > 0 ||
                  suggestions.clarifications.length > 0) && (
                  <div className="absolute top-full inset-x-0 mt-1.5 bg-white text-[#0D2545] rounded-2xl shadow-xl border border-slate-200 overflow-hidden max-h-[65vh] overflow-y-auto z-50">
                    {suggestions.clarifications.length > 0 && (
                      <div className="p-3 bg-amber-50/70 border-b border-amber-100 space-y-1.5">
                        {suggestions.clarifications.map((cl) => (
                          <div key={cl.term} className="space-y-1">
                            <p className="text-[11px] font-bold text-amber-900">
                              {cl.message}
                            </p>
                            <div className="flex flex-wrap gap-1.5">
                              {cl.options.map((opt) => (
                                <button
                                  key={opt.label}
                                  type="button"
                                  onClick={() => {
                                    if (opt.categoryId) {
                                      const cat = categories.find(
                                        (c) => c.id === opt.categoryId
                                      );
                                      if (cat) openCategoryDetail(cat);
                                    }
                                    if (opt.brand) {
                                      setFilterBrand(opt.brand);
                                    }
                                    setSuggestionsOpen(false);
                                  }}
                                  className="px-2.5 py-1 rounded-lg bg-white border border-amber-300 text-xs font-bold text-[#0D2545] hover:bg-amber-100 cursor-pointer"
                                >
                                  {opt.label}
                                </button>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    {suggestions.brands.length > 0 && (
                      <div className="p-2.5 border-b border-slate-100">
                        <p className="px-2 pb-1 text-[11px] font-bold text-slate-400">
                          الماركات
                        </p>
                        <div className="flex flex-wrap gap-1.5 px-1">
                          {suggestions.brands.map((brand) => (
                            <button
                              key={brand}
                              type="button"
                              onClick={() => {
                                setFilterBrand(brand);
                                setSearchInput('');
                                setSuggestionsOpen(false);
                              }}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-orange-50 hover:bg-[#F96B11] hover:text-white text-[#0D2545] text-xs font-bold transition-colors cursor-pointer"
                            >
                              <Tag className="w-3.5 h-3.5 text-[#F96B11]" />
                              <span>{brand}</span>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    {suggestions.listings.length > 0 && (
                      <div className="p-2">
                        <p className="px-2.5 py-1 text-[11px] font-bold text-slate-400">
                          منشورات متاحة الآن
                        </p>
                        {suggestions.listings.map((item) => (
                          <button
                            key={item.id}
                            type="button"
                            onClick={() => {
                              setSuggestionsOpen(false);
                              openListingDetail(item.id, true);
                            }}
                            className="w-full px-2.5 py-2 rounded-xl hover:bg-slate-50 flex items-center gap-3 text-right cursor-pointer"
                          >
                            <div className="w-11 h-11 rounded-lg bg-slate-100 overflow-hidden shrink-0">
                              {item.image_url && (
                                <img
                                  src={item.image_url}
                                  alt=""
                                  className="w-full h-full object-cover"
                                />
                              )}
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-xs sm:text-sm font-bold text-[#0D2545] truncate">
                                {item.title}
                              </p>
                              <p className="text-[11px] text-slate-500 truncate">
                                {item.category_name} · {item.governorate}
                                {item.engine_cc ? ` · ${item.engine_cc} سي سي` : ''}
                              </p>
                            </div>
                            <span className="text-xs font-extrabold text-[#F96B11] tabular-nums shrink-0">
                              {formatPriceIQD(item.price_iqd)} د.ع
                            </span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
            </div>
          </div>
        </header>
      )}

      {/* MAIN CONTENT */}
      <main className="flex-1 w-full max-w-7xl mx-auto px-4 py-4 sm:py-6 space-y-5">
        {initialBootError && (
          <div className="p-4 rounded-2xl bg-red-50 border border-red-200 text-red-700 flex items-center justify-between gap-3">
            <span className="text-sm font-bold">{initialBootError}</span>
            <button
              type="button"
              onClick={loadBootData}
              className="h-9 px-3 rounded-xl bg-red-600 text-white text-xs font-bold shrink-0 cursor-pointer"
            >
              إعادة المحاولة
            </button>
          </div>
        )}

        {/* PAGE 2: CATEGORIES GRID */}
        {route.type === 'tab' && route.tab === 'categories' && (
          <section aria-label="أقسام دراجتي" className="space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3.5 sm:gap-5">
              {categories.map((cat) => (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => openCategoryDetail(cat)}
                  className="group bg-white rounded-2xl overflow-hidden shadow-sm hover:shadow-md border border-slate-200/70 transition-all duration-200 hover:-translate-y-0.5 text-center cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F96B11]"
                >
                  <div className="aspect-[4/3] w-full overflow-hidden bg-slate-100">
                    <ProgressiveImage
                      src={cat.image_url}
                      alt={cat.name_ar}
                      containerClassName="w-full h-full"
                      className="group-hover:scale-105 transition-transform duration-300"
                    />
                  </div>
                  <div className="py-3 px-2.5 sm:py-4">
                    <h2 className="text-sm sm:text-base font-extrabold text-[#0D2545]">
                      {cat.name_ar}
                    </h2>
                    {typeof cat.listings_count === 'number' && (
                      <p className="text-[11px] sm:text-xs text-slate-500 mt-0.5 tabular-nums">
                        {cat.listings_count} إعلان متاح
                      </p>
                    )}
                  </div>
                </button>
              ))}
            </div>
          </section>
        )}

        {/* PAGE 1: HOME OR CATEGORY DETAIL FEED */}
        {((route.type === 'tab' && route.tab === 'home') ||
          route.type === 'category_detail') && (
          <>
            {/* Wide Hero Slider on Home */}
            {route.type === 'tab' && route.tab === 'home' && sliders.length > 0 && (
              <HeroSlider
                slides={sliders}
                onSlideClick={(slide) => {
                  if (slide.link_category_id) {
                    const cat = categories.find(
                      (c) => c.id === slide.link_category_id
                    );
                    if (cat) openCategoryDetail(cat);
                  }
                }}
              />
            )}

            {/* Section Title + Filter/Sort Toolbar */}
            <section className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <span
                    aria-hidden="true"
                    className="w-1 h-5 rounded-full bg-[#F96B11] inline-block"
                  />
                  <h2 className="text-lg sm:text-xl font-extrabold text-[#0D2545]">
                    {route.type === 'category_detail'
                      ? `منشورات ${route.category.name_ar}`
                      : 'أحدث الدراجات'}
                  </h2>
                  {!loadingListings && (
                    <span className="text-xs text-slate-500 font-semibold tabular-nums">
                      ({listings.length})
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setShowFiltersPanel((v) => !v)}
                    className={`h-10 px-3.5 rounded-xl border text-xs sm:text-sm font-bold inline-flex items-center gap-1.5 transition-colors cursor-pointer ${
                      showFiltersPanel || hasActiveFilters
                        ? 'bg-[#0D2545] text-white border-[#0D2545]'
                        : 'bg-white text-[#0D2545] border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    <SlidersHorizontal className="w-4 h-4" />
                    <span>تصفية وترتيب</span>
                  </button>
                </div>
              </div>

              {/* Active Understood Chips & Page Filters (Removable) */}
              {(smartChips.length > 0 ||
                governorate !== 'جميع المحافظات' ||
                (route.type === 'tab' && filterCategoryId !== null) ||
                Boolean(filterCondition) ||
                Boolean(filterBrand) ||
                Boolean(minPrice) ||
                Boolean(maxPrice)) && (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="inline-flex items-center gap-1 text-xs font-bold text-slate-500">
                    <Sparkles className="w-3.5 h-3.5 text-[#F96B11]" />
                    <span>الشروط المطبقة:</span>
                  </span>

                  {smartChips.map((chip) => (
                    <button
                      key={`q-${chip.key}`}
                      type="button"
                      onClick={() =>
                        setIgnoredChips((prev) =>
                          prev.includes(chip.key) ? prev : [...prev, chip.key]
                        )
                      }
                      className="inline-flex items-center gap-1.5 h-8 px-3 rounded-xl bg-[#0D2545] text-white text-xs font-bold hover:bg-[#163661] cursor-pointer"
                    >
                      <span>{chip.label}</span>
                      <X className="w-3.5 h-3.5 text-amber-300" />
                    </button>
                  ))}

                  {route.type === 'tab' && filterCategoryId !== null && (
                    <button
                      type="button"
                      onClick={() => setFilterCategoryId(null)}
                      className="inline-flex items-center gap-1.5 h-8 px-3 rounded-xl bg-white border border-slate-300 text-[#0D2545] text-xs font-bold hover:bg-slate-50 cursor-pointer"
                    >
                      <span>
                        القسم:{' '}
                        {categories.find((c) => c.id === filterCategoryId)?.name_ar}
                      </span>
                      <X className="w-3.5 h-3.5 text-slate-500" />
                    </button>
                  )}

                  {governorate !== 'جميع المحافظات' && (
                    <button
                      type="button"
                      onClick={() => handleGovernorateChange('جميع المحافظات')}
                      className="inline-flex items-center gap-1.5 h-8 px-3 rounded-xl bg-white border border-slate-300 text-[#0D2545] text-xs font-bold hover:bg-slate-50 cursor-pointer"
                    >
                      <span>المحافظة: {governorate}</span>
                      <X className="w-3.5 h-3.5 text-slate-500" />
                    </button>
                  )}

                  {filterBrand && (
                    <button
                      type="button"
                      onClick={() => setFilterBrand('')}
                      className="inline-flex items-center gap-1.5 h-8 px-3 rounded-xl bg-white border border-slate-300 text-[#0D2545] text-xs font-bold hover:bg-slate-50 cursor-pointer"
                    >
                      <span>الماركة: {filterBrand}</span>
                      <X className="w-3.5 h-3.5 text-slate-500" />
                    </button>
                  )}

                  {filterCondition && (
                    <button
                      type="button"
                      onClick={() => setFilterCondition('')}
                      className="inline-flex items-center gap-1.5 h-8 px-3 rounded-xl bg-white border border-slate-300 text-[#0D2545] text-xs font-bold hover:bg-slate-50 cursor-pointer"
                    >
                      <span>
                        الحالة: {filterCondition === 'new' ? 'جديدة' : 'مستعملة'}
                      </span>
                      <X className="w-3.5 h-3.5 text-slate-500" />
                    </button>
                  )}

                  {(minPrice || maxPrice) && (
                    <button
                      type="button"
                      onClick={() => {
                        setMinPrice('');
                        setMaxPrice('');
                      }}
                      className="inline-flex items-center gap-1.5 h-8 px-3 rounded-xl bg-white border border-slate-300 text-[#0D2545] text-xs font-bold hover:bg-slate-50 cursor-pointer"
                    >
                      <span>
                        السعر:{' '}
                        {minPrice ? `من ${formatPriceIQD(Number(minPrice))}` : ''}{' '}
                        {maxPrice ? `إلى ${formatPriceIQD(Number(maxPrice))}` : ''} د.ع
                      </span>
                      <X className="w-3.5 h-3.5 text-slate-500" />
                    </button>
                  )}
                </div>
              )}

              {/* Disambiguation Suggestions for Ambiguous Words */}
              {smartClarifications.length > 0 && (
                <div className="bg-amber-50 border border-amber-200 rounded-2xl p-3.5 space-y-2">
                  {smartClarifications.map((cl) => (
                    <div key={cl.term} className="space-y-1.5">
                      <p className="text-xs font-bold text-amber-900">
                        {cl.message}
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {cl.options.map((opt) => (
                          <button
                            key={opt.label}
                            type="button"
                            onClick={() => {
                              if (opt.categoryId) {
                                if (route.type === 'category_detail') {
                                  const cat = categories.find(
                                    (c) => c.id === opt.categoryId
                                  );
                                  if (cat) openCategoryDetail(cat);
                                } else {
                                  setFilterCategoryId(opt.categoryId);
                                }
                              }
                              if (opt.brand) {
                                setFilterBrand(opt.brand);
                              }
                            }}
                            className="h-8 px-3 rounded-xl bg-white hover:bg-amber-100 border border-amber-300 text-xs font-bold text-[#0D2545] cursor-pointer"
                          >
                            {opt.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Filter Conflict Alert (Page Filter vs Search Query) */}
              {smartConflicts.length > 0 && (
                <div
                  role="alert"
                  className="bg-red-50 border border-red-200 rounded-2xl p-3.5 space-y-2"
                >
                  {smartConflicts.map((c, i) => (
                    <div
                      key={`${c.type}-${i}`}
                      className="flex flex-wrap items-center justify-between gap-2"
                    >
                      <div className="flex items-center gap-2 text-xs sm:text-sm font-bold text-red-800">
                        <AlertTriangle className="w-4 h-4 text-red-600 shrink-0" />
                        <span>{c.message}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        {c.type === 'governorate' && (
                          <>
                            <button
                              type="button"
                              onClick={() => handleGovernorateChange(c.queryValue)}
                              className="h-8 px-3 rounded-lg bg-[#0D2545] text-white text-xs font-bold cursor-pointer"
                            >
                              اعتماد {c.queryValue}
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                setIgnoredChips((p) =>
                                  p.includes('governorate') ? p : [...p, 'governorate']
                                )
                              }
                              className="h-8 px-3 rounded-lg bg-white border border-red-200 text-red-700 text-xs font-bold cursor-pointer"
                            >
                              الإبقاء على {c.pageValue}
                            </button>
                          </>
                        )}
                        {c.type === 'category' && (
                          <>
                            {c.suggestedCategoryId && (
                              <button
                                type="button"
                                onClick={() => {
                                  if (route.type === 'category_detail') {
                                    const targetCat = categories.find(
                                      (cat) => cat.id === c.suggestedCategoryId
                                    );
                                    if (targetCat) openCategoryDetail(targetCat);
                                  } else {
                                    setFilterCategoryId(c.suggestedCategoryId || null);
                                  }
                                }}
                                className="h-8 px-3 rounded-lg bg-[#0D2545] text-white text-xs font-bold cursor-pointer"
                              >
                                التحويل إلى {c.queryValue}
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() =>
                                setIgnoredChips((p) =>
                                  p.includes('category') ? p : [...p, 'category']
                                )
                              }
                              className="h-8 px-3 rounded-lg bg-white border border-red-200 text-red-700 text-xs font-bold cursor-pointer"
                            >
                              إلغاء قسم البحث
                            </button>
                          </>
                        )}
                        {c.type === 'price' && (
                          <button
                            type="button"
                            onClick={() => {
                              setMinPrice('');
                              setMaxPrice('');
                            }}
                            className="h-8 px-3 rounded-lg bg-[#0D2545] text-white text-xs font-bold cursor-pointer"
                          >
                            إزالة سعر الفلتر
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Expandable Filter & Sort Panel */}
              {showFiltersPanel && (
                <div className="bg-white rounded-2xl p-4 border border-slate-200/80 shadow-xs space-y-3">
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3">
                    {route.type === 'tab' && (
                      <div>
                        <label className="block text-xs font-bold text-slate-500 mb-1">
                          القسم
                        </label>
                        <select
                          value={filterCategoryId ?? ''}
                          onChange={(e) =>
                            setFilterCategoryId(
                              e.target.value ? Number(e.target.value) : null
                            )
                          }
                          className="w-full h-10 px-3 rounded-xl border border-slate-200 text-sm bg-white"
                        >
                          <option value="">كل الأقسام</option>
                          {categories.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.name_ar}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}

                    <div>
                      <label className="block text-xs font-bold text-slate-500 mb-1">
                        المحافظة
                      </label>
                      <select
                        value={governorate}
                        onChange={(e) => handleGovernorateChange(e.target.value)}
                        className="w-full h-10 px-3 rounded-xl border border-slate-200 text-sm bg-white"
                      >
                        <option value="جميع المحافظات">جميع المحافظات</option>
                        {IRAQI_GOVERNORATES.map((g) => (
                          <option key={g} value={g}>
                            {g}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-slate-500 mb-1">
                        الحالة
                      </label>
                      <select
                        value={filterCondition}
                        onChange={(e) =>
                          setFilterCondition(e.target.value as 'new' | 'used' | '')
                        }
                        className="w-full h-10 px-3 rounded-xl border border-slate-200 text-sm bg-white"
                      >
                        <option value="">جديدة ومستعملة</option>
                        <option value="new">جديدة فقط</option>
                        <option value="used">مستعملة فقط</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-slate-500 mb-1">
                        السعر من (د.ع)
                      </label>
                      <input
                        type="number"
                        inputMode="numeric"
                        value={minPrice}
                        onChange={(e) => setMinPrice(e.target.value)}
                        placeholder="مثال: 500000"
                        className="w-full h-10 px-3 rounded-xl border border-slate-200 text-sm tabular-nums"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-slate-500 mb-1">
                        السعر إلى (د.ع)
                      </label>
                      <input
                        type="number"
                        inputMode="numeric"
                        value={maxPrice}
                        onChange={(e) => setMaxPrice(e.target.value)}
                        placeholder="مثال: 10000000"
                        className="w-full h-10 px-3 rounded-xl border border-slate-200 text-sm tabular-nums"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-slate-500 mb-1">
                        الترتيب حسب
                      </label>
                      <select
                        value={sortBy}
                        onChange={(e) =>
                          setSortBy(
                            e.target.value as 'newest' | 'price_asc' | 'price_desc'
                          )
                        }
                        className="w-full h-10 px-3 rounded-xl border border-slate-200 text-sm bg-white"
                      >
                        <option value="newest">الأكثر تطابقاً / الأحدث</option>
                        <option value="price_asc">السعر: من الأقل للأعلى</option>
                        <option value="price_desc">السعر: من الأعلى للأقل</option>
                      </select>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-100">
                    <label className="inline-flex items-center gap-2 text-xs font-bold text-slate-600 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={hideDemo}
                        onChange={(e) => handleHideDemoToggle(e.target.checked)}
                        className="accent-[#F96B11] w-4 h-4"
                      />
                      <span>إخفاء البيانات التجريبية (عرض المنشورات الحقيقية فقط)</span>
                    </label>

                    {hasActiveFilters && (
                      <button
                        type="button"
                        onClick={resetAllFilters}
                        className="text-xs font-bold text-[#F96B11] hover:underline cursor-pointer"
                      >
                        إعادة ضبط التصفية
                      </button>
                    )}
                  </div>
                </div>
              )}

              {/* Loading Skeletons */}
              {loadingListings ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3.5 sm:gap-5">
                  {Array.from({ length: 6 }).map((_, idx) => (
                    <div
                      key={idx}
                      className="bg-white rounded-2xl p-3 border border-slate-200/70 animate-pulse flex sm:flex-col gap-3"
                    >
                      <div className="w-36 h-28 sm:w-full sm:h-44 rounded-xl bg-slate-200 shrink-0" />
                      <div className="flex-1 space-y-2.5 py-1">
                        <div className="h-4 bg-slate-200 rounded w-3/4" />
                        <div className="h-3 bg-slate-100 rounded w-1/2" />
                        <div className="h-4 bg-slate-200 rounded w-2/3" />
                      </div>
                    </div>
                  ))}
                </div>
              ) : listingsError ? (
                /* Connection Error State */
                <div className="bg-white rounded-2xl p-8 text-center border border-slate-200 space-y-3">
                  <AlertCircle className="w-10 h-10 text-red-500 mx-auto" />
                  <h3 className="text-base font-extrabold text-[#0D2545]">
                    تعذر تحميل المنشورات
                  </h3>
                  <p className="text-sm text-slate-600 max-w-md mx-auto">
                    {listingsError}
                  </p>
                  <button
                    type="button"
                    onClick={loadListings}
                    className="h-11 px-5 rounded-xl bg-[#F96B11] hover:bg-[#e55d09] text-white text-sm font-bold inline-flex items-center gap-2 cursor-pointer"
                  >
                    <RefreshCw className="w-4 h-4" />
                    <span>إعادة المحاولة</span>
                  </button>
                </div>
              ) : listings.length === 0 ? (
                /* Empty Results State */
                <div className="space-y-5">
                  <div className="bg-white rounded-2xl p-8 sm:p-10 text-center border border-slate-200 space-y-3">
                    <Search className="w-10 h-10 text-slate-300 mx-auto" />
                    <h3 className="text-base font-extrabold text-[#0D2545]">
                      ما لقينا نتيجة مطابقة، جرّب تغيير الكلمات أو الفلاتر
                    </h3>
                    <div className="flex flex-wrap items-center justify-center gap-2.5 pt-1">
                      {hasActiveFilters && (
                        <button
                          type="button"
                          onClick={resetAllFilters}
                          className="h-10 px-4 rounded-xl bg-slate-100 hover:bg-slate-200 text-[#0D2545] text-xs font-bold cursor-pointer"
                        >
                          مسح جميع الفلاتر
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={handleRequestOpenAdd}
                        className="h-10 px-4 rounded-xl bg-[#F96B11] text-white text-xs font-bold cursor-pointer"
                      >
                        إضافة دراجة الآن
                      </button>
                    </div>
                  </div>

                  {/* Transparent Near Results Section ("نتائج قريبة") */}
                  {nearResults.length > 0 && (
                    <div className="space-y-3">
                      <div className="flex items-center gap-2">
                        <span
                          aria-hidden="true"
                          className="w-1 h-5 rounded-full bg-amber-500 inline-block"
                        />
                        <h3 className="text-base sm:text-lg font-extrabold text-[#0D2545]">
                          نتائج قريبة
                        </h3>
                        <span className="text-xs text-slate-500">
                          (تختلف في بعض الشروط الموضحة أدناه)
                        </span>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3.5 sm:gap-5">
                        {nearResults.map((item) => (
                          <div key={`near-${item.id}`} className="space-y-1.5">
                            <ListingCard
                              listing={item}
                              isFavorite={favorites.includes(item.id)}
                              onToggleFavorite={handleToggleFavorite}
                              onSelect={(selected) =>
                                openListingDetail(selected.id, true)
                              }
                            />
                            <p className="px-2 py-1 rounded-lg bg-amber-50 border border-amber-200/80 text-[11px] font-bold text-amber-900">
                              الاختلاف: {item.differenceNote}
                            </p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                /* Listings Grid */
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3.5 sm:gap-5">
                  {listings.map((item) => (
                    <ListingCard
                      key={item.id}
                      listing={item}
                      isFavorite={favorites.includes(item.id)}
                      onToggleFavorite={handleToggleFavorite}
                      onSelect={(selected) => openListingDetail(selected.id, true)}
                    />
                  ))}
                </div>
              )}
            </section>
          </>
        )}

        {/* Quiet Footer */}
        <footer className="pt-8 pb-2 border-t border-slate-200/80 flex flex-col sm:flex-row items-center justify-center gap-3 text-xs text-slate-500">
          <p>دراجتي — منصة بيع وشراء الدراجات وقطع الغيار في العراق</p>
          <PWAInstallButton />
        </footer>
      </main>

      {/* Fixed Bottom Navigation */}
      <BottomNav
        activeTab={activeNavTab}
        onSelectHome={navigateHome}
        onSelectCategories={navigateCategories}
        onOpenAdd={handleRequestOpenAdd}
      />

      {/* Add Bike / Product Modal */}
      <AddListingModal
        isOpen={addModalOpen}
        isOnline={isOnline}
        categories={categories}
        defaultGovernorate={governorate}
        onClose={() => setAddModalOpen(false)}
        onCreatedPreview={(created) => {
          setDetailListing(created);
          setDetailIsOwner(true);
          openListingDetail(created.id, true);
        }}
      />
    </div>
  );
}
