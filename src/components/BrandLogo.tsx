import React, { useEffect, useState } from 'react';
import { Bike, WifiOff } from 'lucide-react';
import {
  getLastKnownServerOnline,
  subscribeServerConnectivity,
} from '../utils/api';

export function BrandLogo({
  light = true,
  size = 'md',
}: {
  light?: boolean;
  size?: 'sm' | 'md' | 'lg';
}) {
  const iconClass =
    size === 'sm' ? 'w-7 h-7' : size === 'lg' ? 'w-11 h-11' : 'w-9 h-9';
  const textClass =
    size === 'sm' ? 'text-lg' : size === 'lg' ? 'text-2xl' : 'text-xl';

  return (
    <span className="inline-flex items-center gap-2 whitespace-nowrap shrink-0 select-none">
      <svg
        viewBox="0 0 64 42"
        className={iconClass}
        fill="none"
        aria-hidden="true"
      >
        {/* Rear & Front Wheels */}
        <circle
          cx="15"
          cy="29"
          r="9"
          stroke={light ? '#FFFFFF' : '#0D2545'}
          strokeWidth="3.5"
        />
        <circle cx="15" cy="29" r="3" fill="#F96B11" />
        <circle
          cx="50"
          cy="29"
          r="9"
          stroke={light ? '#FFFFFF' : '#0D2545'}
          strokeWidth="3.5"
        />
        <circle cx="50" cy="29" r="3" fill="#F96B11" />

        {/* Sportbike Fairing & Tank */}
        <path
          d="M15 29L24 18H36L45 12L52 20L50 29"
          stroke={light ? '#FFFFFF' : '#0D2545'}
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M20 17C24 13 33 12 40 14L47 19C44 22 36 24 28 24L20 17Z"
          fill="#F96B11"
        />
        {/* Windshield */}
        <path
          d="M42 13L46 8L50 13"
          stroke={light ? '#FFFFFF' : '#0D2545'}
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <span
        className={`font-extrabold tracking-tight ${textClass} ${
          light ? 'text-white' : 'text-[#0D2545]'
        }`}
      >
        دراجتي
      </span>
    </span>
  );
}

export function ProgressiveImage({
  src,
  alt,
  className = '',
  containerClassName = '',
  eager = false,
}: {
  src?: string | null;
  alt: string;
  className?: string;
  containerClassName?: string;
  eager?: boolean;
}) {
  const [loaded, setLoaded] = useState(false);
  const [errored, setErrored] = useState(false);
  const [online, setOnline] = useState(() => getLastKnownServerOnline());

  useEffect(() => {
    return subscribeServerConnectivity((isOn) => {
      setOnline(isOn);
    });
  }, []);

  // Automatically retry image loading once internet returns or src changes
  useEffect(() => {
    setErrored(false);
    setLoaded(false);
  }, [src, online]);

  if (!src || errored) {
    const offlineMissing = Boolean(src) && errored && !online;
    return (
      <div
        className={`flex flex-col items-center justify-center bg-gradient-to-br from-slate-100 to-slate-200 text-slate-500 p-2 ${containerClassName}`}
      >
        {offlineMissing ? (
          <>
            <WifiOff className="w-6 h-6 mb-1.5 text-slate-400" strokeWidth={1.8} />
            <span className="text-[11px] font-bold text-center leading-snug text-slate-500">
              هذا المحتوى يحتاج اتصالًا بالإنترنت
            </span>
          </>
        ) : (
          <>
            <Bike className="w-8 h-8 mb-1 opacity-60" strokeWidth={1.6} />
            <span className="text-[11px] font-medium px-2 text-center line-clamp-1">
              {alt}
            </span>
          </>
        )}
      </div>
    );
  }

  return (
    <div className={`relative overflow-hidden bg-slate-100 ${containerClassName}`}>
      {!loaded && (
        <div
          aria-hidden="true"
          className="absolute inset-0 bg-gradient-to-r from-slate-100 via-slate-200 to-slate-100 animate-pulse"
        />
      )}
      <img
        src={src}
        alt={alt}
        loading={eager ? 'eager' : 'lazy'}
        decoding="async"
        referrerPolicy="no-referrer"
        onLoad={() => setLoaded(true)}
        onError={() => setErrored(true)}
        className={`w-full h-full object-cover transition-opacity duration-300 ${
          loaded ? 'opacity-100' : 'opacity-0'
        } ${className}`}
      />
    </div>
  );
}
