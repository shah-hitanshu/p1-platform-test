"use client";

import type { LayoutProps, ResolvedItem } from "../types.js";

interface CardsProps extends LayoutProps {
  columns: number;
  imagePosition: string;
}

const GRID_COLS: Record<number, string> = {
  1: "grid-cols-1",
  2: "grid-cols-2",
  3: "grid-cols-3",
  4: "grid-cols-4",
  5: "grid-cols-5",
  6: "grid-cols-6",
};

function CardImage({
  src,
  alt,
  position,
}: {
  src: string;
  alt: string;
  position: string;
}) {
  if (position === "backdrop") {
    return null;
  }

  const sizeClasses =
    position === "left" || position === "right"
      ? "h-full w-24 flex-shrink-0"
      : "aspect-[4/3] w-full";

  return (
    <div className={`overflow-hidden bg-slate-100 ${sizeClasses}`}>
      <img src={src} alt={alt} className="h-full w-full object-cover" />
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
    <div className="flex-1 p-3">
      {showIcon && item.icon && (
        <span className="mb-1 inline-block text-lg">{item.icon}</span>
      )}
      {showTitle && item.title && (
        <div className="font-bold text-slate-900">{item.title}</div>
      )}
      {showSubtitle && item.subtitle && (
        <div className="mt-1 text-sm text-slate-500">{item.subtitle}</div>
      )}
      {showTeaser && item.teaser && (
        <div className="mt-2 text-sm text-slate-600">{item.teaser}</div>
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
}: CardsProps) {
  return (
    <div className={`grid gap-4 ${GRID_COLS[columns] ?? "grid-cols-3"}`}>
      {items.map((item, i) => {
        const hasImage =
          showImage && !!item.image && imagePosition !== "none";
        const isHorizontal =
          imagePosition === "left" || imagePosition === "right";
        const isBackdrop = imagePosition === "backdrop";

        return (
          <div
            key={i}
            className={`relative overflow-hidden rounded-lg border border-slate-200 ${
              isHorizontal ? "flex" : ""
            }`}
          >
            {isBackdrop && hasImage && (
              <div
                className="absolute inset-0 bg-cover bg-center"
                style={{ backgroundImage: `url(${item.image})` }}
              >
                <div className="absolute inset-0 bg-black/50" />
              </div>
            )}
            {hasImage &&
              !isBackdrop &&
              imagePosition !== "right" && (
                <CardImage
                  src={item.image}
                  alt={item.title || ""}
                  position={imagePosition}
                />
              )}
            <div className={isBackdrop ? "relative z-10 text-white" : isHorizontal ? "flex-1 min-w-0" : ""}>
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
                />
              )}
          </div>
        );
      })}
    </div>
  );
}
