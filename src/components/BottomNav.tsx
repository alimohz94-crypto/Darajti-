import React from 'react';
import { Home, LayoutGrid, Plus } from 'lucide-react';

export function BottomNav({
  activeTab,
  onSelectHome,
  onSelectCategories,
  onOpenAdd,
}: {
  activeTab: 'home' | 'categories';
  onSelectHome: () => void;
  onSelectCategories: () => void;
  onOpenAdd: () => void;
}) {
  return (
    <nav
      aria-label="التنقل الرئيسي"
      className="fixed bottom-0 inset-x-0 z-40 bg-white/95 backdrop-blur-md border-t border-slate-200/90 shadow-[0_-4px_20px_rgba(13,37,69,0.06)] pb-safe"
    >
      <div className="max-w-3xl mx-auto grid grid-cols-3 items-end h-16 px-4">
        {/* Right in RTL: الرئيسية */}
        <button
          type="button"
          onClick={onSelectHome}
          className={`flex flex-col items-center justify-center h-full min-h-[44px] gap-1 transition-colors cursor-pointer ${
            activeTab === 'home'
              ? 'text-[#F96B11] font-bold'
              : 'text-[#0D2545]/75 hover:text-[#0D2545] font-medium'
          }`}
        >
          <Home className="w-6 h-6" strokeWidth={activeTab === 'home' ? 2.4 : 1.9} />
          <span className="text-xs whitespace-nowrap">الرئيسية</span>
        </button>

        {/* Center: Elevated Circular Orange + Button */}
        <div className="flex flex-col items-center justify-end h-full pb-1">
          <button
            type="button"
            onClick={onOpenAdd}
            aria-label="إضافة دراجة"
            className="w-14 h-14 -mt-7 rounded-full bg-[#F96B11] hover:bg-[#e55d09] active:scale-95 text-white shadow-lg shadow-[#F96B11]/35 flex items-center justify-center transition-all border-4 border-white cursor-pointer"
          >
            <Plus className="w-7 h-7" strokeWidth={2.8} />
          </button>
          <span className="text-xs font-bold text-[#0D2545] mt-0.5 whitespace-nowrap">
            إضافة دراجة
          </span>
        </div>

        {/* Left in RTL: الأقسام */}
        <button
          type="button"
          onClick={onSelectCategories}
          className={`flex flex-col items-center justify-center h-full min-h-[44px] gap-1 transition-colors cursor-pointer ${
            activeTab === 'categories'
              ? 'text-[#F96B11] font-bold'
              : 'text-[#0D2545]/75 hover:text-[#0D2545] font-medium'
          }`}
        >
          <LayoutGrid
            className="w-6 h-6"
            strokeWidth={activeTab === 'categories' ? 2.4 : 1.9}
          />
          <span className="text-xs whitespace-nowrap">الأقسام</span>
        </button>
      </div>
    </nav>
  );
}
