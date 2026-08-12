"use client";

import type { LayoutProps } from "../types.js";

interface RowsProps extends LayoutProps {
  rowDensity: string;
  imagePosition: string;
}

export function Rows({
  items,
  showTitle,
  showSubtitle,
  showTeaser,
  showImage,
  showIcon,
  rowDensity,
  imagePosition,
}: RowsProps) {
  const padding = rowDensity === "compact" ? "p-2" : "p-3";
  const textSize = rowDensity === "compact" ? "text-sm" : "";
  const rowShowImage = imagePosition !== "none";

  return (
    <div className="divide-y divide-slate-200 rounded-lg border border-slate-200">
      {items.map((item, i) => (
        <div key={i} className={`flex items-center gap-3 ${padding}`}>
          {rowShowImage && showImage && item.image && (
            <div className="h-[46px] w-[46px] flex-shrink-0 overflow-hidden rounded bg-slate-100">
              <img
                src={item.image}
                alt={item.title || ""}
                className="h-full w-full object-cover"
              />
            </div>
          )}
          <div className={`min-w-0 flex-1 ${textSize}`}>
            {showIcon && item.icon && (
              <span className="mr-1 text-sm">{item.icon}</span>
            )}
            {showTitle && item.title && (
              <div className="font-bold text-slate-900">{item.title}</div>
            )}
            {showSubtitle && item.subtitle && (
              <div className="text-sm text-slate-500">{item.subtitle}</div>
            )}
            {showTeaser && item.teaser && (
              <div className="mt-1 text-sm text-slate-600">{item.teaser}</div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
