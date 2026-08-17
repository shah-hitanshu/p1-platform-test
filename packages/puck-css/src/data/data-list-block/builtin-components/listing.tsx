"use client";

import type { LayoutProps } from "../types.js";

interface ListingProps extends LayoutProps {
  listingWidth: string;
  imagePosition: string;
}

export function Listing({
  items,
  showTitle,
  showSubtitle,
  showTeaser,
  showImage,
  showIcon,
  listingWidth,
  imagePosition,
  imageLoading = "lazy",
}: ListingProps) {
  const widthClass = listingWidth === "narrow" ? "mx-auto max-w-2xl" : "";

  return (
    <div className={`space-y-4 ${widthClass}`}>
      {items.map((item, i) => {
        const hasImage =
          showImage && !!item.image && imagePosition !== "none";
        const isReversed = imagePosition === "right";

        return (
          <div
            key={i}
            className={`flex overflow-hidden rounded-lg border border-slate-200 ${
              isReversed ? "flex-row-reverse" : ""
            }`}
          >
            {hasImage && (
              <div className="h-auto w-48 flex-shrink-0 overflow-hidden bg-slate-100">
                <img
                  src={item.image}
                  alt={item.title || ""}
                  loading={imageLoading}
                  decoding="async"
                  className="h-full w-full object-cover"
                />
              </div>
            )}
            <div className="flex-1 p-4">
              {showIcon && item.icon && (
                <span className="mb-1 inline-block text-lg">{item.icon}</span>
              )}
              {showTitle && item.title && (
                <div className="text-lg font-bold text-slate-900">
                  {item.title}
                </div>
              )}
              {showSubtitle && item.subtitle && (
                <div className="mt-1 text-sm text-slate-500">
                  {item.subtitle}
                </div>
              )}
              {showTeaser && item.teaser && (
                <div className="mt-2 text-slate-600">{item.teaser}</div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
