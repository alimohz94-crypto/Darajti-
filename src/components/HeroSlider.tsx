import React, { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { SliderItem } from '../types';
import { ProgressiveImage } from './BrandLogo';

export function HeroSlider({
  slides,
  onSlideClick,
  autoplay = true,
  intervalMs = 5500,
}: {
  slides: SliderItem[];
  onSlideClick?: (slide: SliderItem) => void;
  autoplay?: boolean;
  intervalMs?: number;
}) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [dragOffset, setDragOffset] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const startXRef = useRef<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const didDragRef = useRef(false);

  const count = slides.length;

  useEffect(() => {
    if (activeIndex >= count && count > 0) {
      setActiveIndex(0);
    }
  }, [count, activeIndex]);

  useEffect(() => {
    if (!autoplay || count <= 1 || isDragging) return;
    const timer = window.setInterval(() => {
      setActiveIndex((prev) => (prev + 1) % count);
    }, intervalMs);
    return () => window.clearInterval(timer);
  }, [count, isDragging, autoplay, intervalMs]);

  if (count === 0) return null;

  const goTo = (idx: number) => {
    setActiveIndex((idx + count) % count);
  };

  const handlePointerDown = (e: React.PointerEvent) => {
    if (count <= 1) return;
    startXRef.current = e.clientX;
    didDragRef.current = false;
    setIsDragging(true);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (startXRef.current === null) return;
    const delta = e.clientX - startXRef.current;
    if (Math.abs(delta) > 6) {
      didDragRef.current = true;
    }
    const width = containerRef.current?.offsetWidth || 360;
    const clamped = Math.max(-width * 0.45, Math.min(width * 0.45, delta));
    setDragOffset(clamped);
  };

  const handlePointerEnd = () => {
    if (startXRef.current === null) return;
    const threshold = 45;
    if (dragOffset < -threshold) {
      goTo(activeIndex + 1);
    } else if (dragOffset > threshold) {
      goTo(activeIndex - 1);
    }
    startXRef.current = null;
    setIsDragging(false);
    setDragOffset(0);
  };

  return (
    <section
      ref={containerRef}
      aria-label="عروض دراجتي المميزة"
      className="relative w-full overflow-hidden rounded-2xl shadow-md bg-[#0D2545] select-none touch-pan-y"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerEnd}
      onPointerCancel={handlePointerEnd}
      onPointerLeave={handlePointerEnd}
    >
      {/* Keep slide track LTR internally so translateX percentage is deterministic inside frame */}
      <div
        dir="ltr"
        className="flex will-change-transform"
        style={{
          transform: `translate3d(calc(-${activeIndex * 100}% + ${dragOffset}px), 0, 0)`,
          transition: isDragging ? 'none' : 'transform 320ms cubic-bezier(0.16, 1, 0.3, 1)',
        }}
      >
        {slides.map((slide, idx) => (
          <div
            key={slide.id}
            dir="rtl"
            onClick={() => {
              if (!didDragRef.current && onSlideClick) {
                onSlideClick(slide);
              }
            }}
            className={`relative w-full h-[170px] sm:h-[220px] lg:h-[280px] shrink-0 ${
              slide.link_category_id ? 'cursor-pointer' : ''
            }`}
          >
            <ProgressiveImage
              src={slide.image_url}
              alt={slide.title}
              eager={idx === 0}
              containerClassName="w-full h-full"
              className="object-cover object-center pointer-events-none"
            />
            {/* Measured gradient scrim for WCAG AA contrast */}
            <div
              aria-hidden="true"
              className="absolute inset-0 bg-gradient-to-l from-[#0D2545]/85 via-[#0D2545]/45 to-transparent"
            />
            <div className="absolute inset-y-0 right-0 flex flex-col justify-center px-3.5 sm:px-7 lg:px-10 max-w-[72%] sm:max-w-[70%] lg:max-w-lg text-white">
              <h2 className="text-base sm:text-xl lg:text-2xl font-extrabold leading-tight tracking-tight text-balance drop-shadow-sm line-clamp-2">
                {slide.title}
              </h2>
              {/* Signature orange curved underline matching reference */}
              <svg
                viewBox="0 0 160 12"
                className="w-20 sm:w-28 lg:w-36 h-2 sm:h-2.5 mt-1"
                fill="none"
                aria-hidden="true"
              >
                <path
                  d="M2 8C48 2 112 2 158 7"
                  stroke="#F96B11"
                  strokeWidth="4"
                  strokeLinecap="round"
                />
              </svg>
              {slide.subtitle && (
                <p className="mt-1.5 text-[10px] sm:text-xs lg:text-sm text-slate-100/95 leading-relaxed line-clamp-2">
                  {slide.subtitle}
                </p>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Desktop prev/next buttons */}
      {count > 1 && (
        <>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              goTo(activeIndex - 1);
            }}
            aria-label="الشريحة السابقة"
            className="hidden sm:flex absolute right-2 lg:right-3 top-1/2 -translate-y-1/2 w-8 h-8 lg:w-9 lg:h-9 rounded-full bg-black/35 hover:bg-black/55 text-white items-center justify-center backdrop-blur-sm transition-colors cursor-pointer"
          >
            <ChevronRight className="w-4 h-4 lg:w-5 lg:h-5" />
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              goTo(activeIndex + 1);
            }}
            aria-label="الشريحة التالية"
            className="hidden sm:flex absolute left-2 lg:left-3 top-1/2 -translate-y-1/2 w-8 h-8 lg:w-9 lg:h-9 rounded-full bg-black/35 hover:bg-black/55 text-white items-center justify-center backdrop-blur-sm transition-colors cursor-pointer"
          >
            <ChevronLeft className="w-4 h-4 lg:w-5 lg:h-5" />
          </button>
        </>
      )}

      {/* Navigation dots inside the slider frame */}
      {count > 1 && (
        <div className="absolute bottom-2 lg:bottom-3 inset-x-0 flex items-center justify-center gap-1.5 z-10">
          {slides.map((s, idx) => (
            <button
              key={s.id}
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                goTo(idx);
              }}
              aria-label={`الانتقال إلى الشريحة ${idx + 1}`}
              className={`h-2 rounded-full transition-all duration-200 cursor-pointer ${
                idx === activeIndex
                  ? 'w-5 bg-[#F96B11]'
                  : 'w-2 bg-white/75 hover:bg-white'
              }`}
            />
          ))}
        </div>
      )}
    </section>
  );
}
