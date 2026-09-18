"use client";

import { useState, type ImgHTMLAttributes } from "react";
import { P1_FALLBACKS } from "./assets";

/** An <img> that swaps to `fallback` (an inline data URI) when `src` fails to load,
 *  including when the failure happened before React hydrated. */
export function FallbackImg({
  src,
  fallback = P1_FALLBACKS.LANDSCAPE,
  onError: callerOnError,
  ...rest
}: Omit<ImgHTMLAttributes<HTMLImageElement>, 'src'> & { src?: string; fallback?: string }) {
  const [failedSrc, setFailedSrc] = useState<string>();
  const failed = !src || failedSrc === src;
  return (
    <img
      loading="lazy"
      decoding="async"
      {...rest}
      src={failed ? fallback : src}
      onError={(e) => { setFailedSrc(src); callerOnError?.(e); }}
      ref={(el) => {
        if (el && src && el.complete && el.naturalWidth === 0) setFailedSrc(src);
      }}
    />
  );
}
