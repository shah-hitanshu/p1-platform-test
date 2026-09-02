"use client";

import type { ImageLoading, LayoutProps, ResolvedItem } from "../types.js";
import "../data-list.css";

interface CardsProps extends LayoutProps {
  columns: number;
  imagePosition: string;
}

function CardImage({
  src,
  alt,
  position,
  loading,
}: {
  src: string;
  alt: string;
  position: string;
  loading: ImageLoading;
}) {
  if (position === "backdrop") {
    return null;
  }

  const shape =
    position === "left" || position === "right"
      ? "p1-datalist-cards__media--side"
      : "p1-datalist-cards__media--stacked";

  return (
    <div className={`p1-datalist-media ${shape}`}>
      <img
        src={src}
        alt={alt}
        loading={loading}
        decoding="async"
        className="p1-datalist-media__img"
      />
    </div>
  );
}

function CardContent({
  item,
  showTitle,
  showSubtitle,
  showTeaser,
  showIcon,
}: {
  item: ResolvedItem;
  showTitle: boolean;
  showSubtitle: boolean;
  showTeaser: boolean;
  showIcon: boolean;
}) {
  return (
    <div className="p1-datalist-cards__content">
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
  );
}

export function Cards({
  items,
  showTitle,
  showSubtitle,
  showTeaser,
  showImage,
  showIcon,
  columns,
  imagePosition,
  imageLoading = "lazy",
}: CardsProps) {
  return (
    <div className="p1-datalist-cards" data-columns={columns}>
      {items.map((item, i) => {
        const hasImage =
          showImage && !!item.image && imagePosition !== "none";
        const isHorizontal =
          imagePosition === "left" || imagePosition === "right";
        const isBackdrop = imagePosition === "backdrop";

        const bodyClass = [
          "p1-datalist-cards__body",
          isBackdrop ? "p1-datalist-cards__body--backdrop" : "",
          isHorizontal ? "p1-datalist-cards__body--horizontal" : "",
        ]
          .filter(Boolean)
          .join(" ");

        return (
          <div
            key={i}
            className={`p1-datalist-cards__card${
              isHorizontal ? " p1-datalist-cards__card--horizontal" : ""
            }`}
          >
            {isBackdrop && hasImage && (
              <div
                className="p1-datalist-cards__backdrop"
                style={{ backgroundImage: `url(${item.image})` }}
              >
                <div className="p1-datalist-cards__scrim" />
              </div>
            )}
            {hasImage &&
              !isBackdrop &&
              imagePosition !== "right" && (
                <CardImage
                  src={item.image}
                  alt={item.title || ""}
                  position={imagePosition}
                  loading={imageLoading}
                />
              )}
            <div className={bodyClass}>
              <CardContent
                item={item}
                showTitle={showTitle}
                showSubtitle={showSubtitle}
                showTeaser={showTeaser}
                showIcon={showIcon}
              />
            </div>
            {hasImage &&
              !isBackdrop &&
              imagePosition === "right" && (
                <CardImage
                  src={item.image}
                  alt={item.title || ""}
                  position={imagePosition}
                  loading={imageLoading}
                />
              )}
          </div>
        );
      })}
    </div>
  );
}
