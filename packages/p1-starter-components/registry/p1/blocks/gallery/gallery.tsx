"use client";
import * as React from "react";
import { Icon } from "@/registry/p1/internal/icons";
import "./gallery.css";

export interface GalleryImage {
  src: string;
  caption: string;
}

export interface GalleryProps {
  heading: string;
  layout: "grid" | "masonry" | "filmstrip" | "carousel";
  columns: "2" | "3" | "4";
  gap: "tight" | "regular" | "wide";
  ratio: "1 / 1" | "4 / 3" | "3 / 2" | "16 / 9";
  radius: "none" | "soft" | "round";
  captions: "off" | "on";
  images: GalleryImage[];
}

const GAP_TOKEN: Record<GalleryProps["gap"], string> = {
  tight: "var(--p1-space-sm)",
  regular: "var(--p1-space-md)",
  wide: "var(--p1-space-xl)",
};

const RADIUS_CLASS: Record<GalleryProps["radius"], string> = {
  none: "",
  soft: "p1-gallery__img-wrap--soft",
  round: "p1-gallery__img-wrap--round",
};

const GalleryCarousel: React.FC<{
  images: GalleryImage[];
  radiusClass: string;
  ratio: string;
  captions: boolean;
}> = ({ images, radiusClass, ratio, captions }) => {
  const [i, setI] = React.useState(0);
  const n = images.length || 1;
  const idx = Math.min(i, n - 1);
  const go = (d: number) => setI((idx + d + n) % n);
  const im = images[idx] || ({} as GalleryImage);
  return (
    <div className="p1-gallery__carousel">
      <div className={`p1-gallery__img-wrap ${radiusClass}`} style={{ aspectRatio: ratio }}>
        <img src={im.src} alt={im.caption || ""} className="p1-gallery__img" />
        {n > 1 &&
          (["prev", "next"] as const).map((dir) => (
            <button
              key={dir}
              type="button"
              aria-label={dir}
              data-dir={dir}
              onClick={() => go(dir === "next" ? 1 : -1)}
              className="p1-gallery__nav"
            >
              <Icon name={dir === "prev" ? "chevron-left" : "chevron-right"} className="p1-gallery__nav-icon" />
            </button>
          ))}
        {captions && im.caption && (
          <div className="p1-gallery__caption-overlay">{im.caption}</div>
        )}
      </div>
      {n > 1 && (
        <div className="p1-gallery__dots">
          {images.map((_, di) => (
            <button
              key={di}
              type="button"
              aria-label={`Go to ${di + 1}`}
              data-active={di === idx ? "true" : undefined}
              onClick={() => setI(di)}
              className="p1-gallery__dot"
            />
          ))}
        </div>
      )}
    </div>
  );
};

export function GalleryRender({ heading, layout, columns, gap, ratio, radius, captions, images }: GalleryProps) {
  const imgs = images || [];
  const cols = Math.min(Number(columns) || 3, Math.max(1, imgs.length));
  const gapVal = GAP_TOKEN[gap];
  const radiusClass = RADIUS_CLASS[radius];
  const cap = captions === "on";

  const tile = (im: GalleryImage, key: number, extra?: React.CSSProperties) => (
    <figure key={key} className="p1-gallery__tile" style={extra}>
      <div className={`p1-gallery__img-wrap ${radiusClass}`}>
        <img
          src={im.src}
          alt={im.caption || ""}
          className="p1-gallery__img"
          style={{ aspectRatio: extra?.aspectRatio, height: extra?.height ?? "100%" }}
        />
      </div>
      {cap && im.caption && <figcaption className="p1-gallery__figcaption">{im.caption}</figcaption>}
    </figure>
  );

  let body: React.ReactNode;
  if (layout === "masonry") {
    body = (
      <div style={{ columnCount: cols, columnGap: gapVal }}>
        {imgs.map((im, i) => tile(im, i, { breakInside: "avoid", marginBlockEnd: gapVal }))}
      </div>
    );
  } else if (layout === "filmstrip") {
    body = (
      <div className="p1-gallery__filmstrip" style={{ gap: gapVal }}>
        {imgs.map((im, i) => tile(im, i, { flex: "none", width: 340, height: 240 }))}
      </div>
    );
  } else if (layout === "carousel") {
    body = <GalleryCarousel images={imgs} radiusClass={radiusClass} ratio={ratio} captions={cap} />;
  } else {
    body = (
      <div className="p1-gallery__grid" style={{ gap: gapVal, gridTemplateColumns: `repeat(${cols}, minmax(0,1fr))` }}>
        {imgs.map((im, i) => tile(im, i, { aspectRatio: ratio }))}
      </div>
    );
  }

  return (
    <div className="p1-gallery p1-block">
      <div className="p1-gallery__inner">
        {heading && <h2 className="p1-gallery__heading">{heading}</h2>}
        {imgs.length ? (
          body
        ) : (
          <div className="p1-gallery__empty">Add images in the inspector.</div>
        )}
      </div>
    </div>
  );
}
