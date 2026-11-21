import React from 'react';
import { Heart, MapPin } from 'lucide-react';
import { formatPriceIQD, Listing } from '../types';
import { ProgressiveImage } from './BrandLogo';

export function ListingCard({
  listing,
  isFavorite,
  onToggleFavorite,
  onSelect,
}: {
  listing: Listing;
  isFavorite: boolean;
  onToggleFavorite: (id: number) => void;
  onSelect: (listing: Listing) => void;
}) {
  const coverImage =
    listing.images.find((img) => img.isCover)?.url || listing.images[0]?.url;

  return (
    <article
      onClick={() => onSelect(listing)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect(listing);
        }
      }}
      className="group relative bg-white rounded-2xl shadow-sm hover:shadow-md transition-all duration-200 hover:-translate-y-0.5 overflow-hidden cursor-pointer flex flex-row sm:flex-col border border-slate-200/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F96B11]"
    >
      {/* Thumbnail Image */}
      <div className="relative w-36 xs:w-40 sm:w-full h-32 sm:h-auto sm:aspect-[4/3] shrink-0 overflow-hidden bg-slate-100">
        <ProgressiveImage
          src={coverImage}
          alt={listing.title}
          containerClassName="w-full h-full"
          className="group-hover:scale-[1.03] transition-transform duration-300"
        />

        {listing.status === 'sold' && (
          <div className="absolute inset-0 bg-[#0D2545]/60 flex items-center justify-center">
            <span className="text-white font-extrabold text-sm sm:text-base tracking-wide px-3 py-1 bg-[#0D2545]/90 rounded-lg">
              تم البيع
            </span>
          </div>
        )}

        {/* Favorite button on desktop top-left */}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onToggleFavorite(listing.id);
          }}
          aria-label={isFavorite ? 'إزالة من المفضلة' : 'إضافة إلى المفضلة'}
          className="hidden sm:flex absolute top-2.5 left-2.5 w-10 h-10 rounded-full bg-white/90 hover:bg-white shadow-sm items-center justify-center text-slate-600 transition-colors cursor-pointer"
        >
          <Heart
            className={`w-5 h-5 transition-colors ${
              isFavorite ? 'fill-[#F96B11] text-[#F96B11]' : 'text-slate-600'
            }`}
          />
        </button>
      </div>

      {/* Card Body */}
      <div className="flex-1 p-3 sm:p-4 flex flex-col justify-between min-w-0">
        <div>
          <div className="flex items-start justify-between gap-2">
            <h3 className="font-bold text-[15px] sm:text-base text-[#0D2545] leading-snug line-clamp-1">
              {listing.title}
            </h3>
            {/* Mobile favorite button matching reference layout */}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onToggleFavorite(listing.id);
              }}
              aria-label={isFavorite ? 'إزالة من المفضلة' : 'إضافة إلى المفضلة'}
              className="sm:hidden -mt-1 -ml-1 min-w-[40px] min-h-[40px] flex items-center justify-center text-slate-400 hover:text-[#F96B11] shrink-0 cursor-pointer"
            >
              <Heart
                className={`w-5 h-5 ${
                  isFavorite ? 'fill-[#F96B11] text-[#F96B11]' : 'text-slate-400'
                }`}
              />
            </button>
          </div>

          {/* Unboxed clean metadata line (zero-pill discipline) */}
          <p className="mt-0.5 text-xs text-slate-500 truncate">
            <span>{listing.category_name}</span>
            {listing.brand ? (
              <>
                <span aria-hidden="true"> · </span>
                <span>{listing.brand}</span>
              </>
            ) : null}
            {listing.engine_cc ? (
              <>
                <span aria-hidden="true"> · </span>
                <span className="tabular-nums">{listing.engine_cc} سي سي</span>
              </>
            ) : listing.motor_watts ? (
              <>
                <span aria-hidden="true"> · </span>
                <span className="tabular-nums">{listing.motor_watts} واط</span>
              </>
            ) : null}
            {listing.model_year ? (
              <>
                <span aria-hidden="true"> · </span>
                <span className="tabular-nums">{listing.model_year}</span>
              </>
            ) : null}
            <span aria-hidden="true"> · </span>
            <span>{listing.condition === 'new' ? 'جديدة' : 'مستعملة'}</span>
          </p>
        </div>

        <div className="mt-2 sm:mt-3">
          <div className="flex items-baseline gap-1.5 flex-wrap">
            <span className="text-[#F96B11] font-extrabold text-[15px] sm:text-lg tabular-nums">
              {formatPriceIQD(listing.price_iqd)}
            </span>
            <span className="text-[#F96B11] font-bold text-xs sm:text-sm">
              دينار عراقي
            </span>
            {listing.negotiable && (
              <span className="text-[11px] text-slate-500 font-medium">
                · قابل للتفاوض
              </span>
            )}
          </div>

          <div className="mt-1.5 flex items-center justify-between gap-2 text-xs text-slate-500">
            <span className="inline-flex items-center gap-1 truncate">
              <MapPin className="w-3.5 h-3.5 text-slate-400 shrink-0" />
              <span className="truncate">
                {listing.governorate}
                {listing.area ? ` — ${listing.area}` : ''}
              </span>
            </span>
            {listing.is_demo && (
              <span className="text-[11px] text-slate-400 shrink-0">
                بيانات تجريبية
              </span>
            )}
          </div>
        </div>
      </div>
    </article>
  );
}
