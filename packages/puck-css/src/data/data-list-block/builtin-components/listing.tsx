"use client";

import type { LayoutProps } from "../types.js";
import "../data-list.css";

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
  const widthClass =
    listingWidth === "narrow" ? " p1-datalist-listing--narrow" : "";

  return (
    <div className={`p1-datalist-listing${widthClass}`}>
      {items.map((item, i) => {
        const hasImage =
          showImage && !!item.image && imagePosition !== "none";
        const isReversed = imagePosition === "right";

        return (
          <div
            key={i}
            className={`p1-datalist-listing__item${
              isReversed ? " p1-datalist-listing__item--reversed" : ""
            }`}
          >
            {hasImage && (
              <div className="p1-datalist-media p1-datalist-listing__media">
                <img
                  src={item.image}
                  alt={item.title || ""}
                  loading={imageLoading}
                  decoding="async"
                  className="p1-datalist-media__img"
                />
              </div>
            )}
            <div className="p1-datalist-listing__content">
              {showIcon && item.icon && (
                <span className="p1-datalist-item__icon">{item.icon}</span>
              )}
              {showTitle && item.title && (
                <div className="p1-datalist-item__title">{item.title}</div>
              )}
              {showSubtitle && item.subtitle && (
                <div className="p1-datalist-item__subtitle">
                  {item.subtitle}
                </div>
              )}
              {showTeaser && item.teaser && (
                <div className="p1-datalist-item__teaser">{item.teaser}</div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
