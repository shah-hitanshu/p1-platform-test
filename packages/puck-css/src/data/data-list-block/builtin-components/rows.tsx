"use client";

import type { LayoutProps } from "../types.js";
import "../data-list.css";

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
  imageLoading = "lazy",
}: RowsProps) {
  const density = rowDensity === "compact" ? "compact" : "comfortable";
  const rowShowImage = imagePosition !== "none";

  return (
    <div className="p1-datalist-rows" data-density={density}>
      {items.map((item, i) => (
        <div key={i} className="p1-datalist-rows__row">
          {rowShowImage && showImage && item.image && (
            <div className="p1-datalist-media p1-datalist-rows__media">
              <img
                src={item.image}
                alt={item.title || ""}
                loading={imageLoading}
                decoding="async"
                className="p1-datalist-media__img"
              />
            </div>
          )}
          <div className="p1-datalist-rows__content">
            {showIcon && item.icon && (
              <span className="p1-datalist-item__icon">{item.icon}</span>
            )}
            {showTitle && item.title && (
              <div className="p1-datalist-item__title">{item.title}</div>
            )}
            {showSubtitle && item.subtitle && (
              <div className="p1-datalist-item__subtitle">{item.subtitle}</div>
            )}
            {showTeaser && item.teaser && (
              <div className="p1-datalist-item__teaser">{item.teaser}</div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
