import * as React from "react";
import type { ComponentConfig } from "@puckeditor/core";
import { Icon } from "../internal/icons";

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

const GAP_PX: Record<GalleryProps["gap"], number> = { tight: 8, regular: 16, wide: 28 };
const RADIUS: Record<GalleryProps["radius"], string> = {
  none: "rounded-none",
  soft: "rounded-p1-md",
  round: "rounded-3xl",
};

const GalleryCarousel: React.FC<{
  images: GalleryImage[];
  radius: string;
  ratio: string;
  captions: boolean;
}> = ({ images, radius, ratio, captions }) => {
  const [i, setI] = React.useState(0);
  const n = images.length || 1;
  const idx = Math.min(i, n - 1);
  const go = (d: number) => setI((idx + d + n) % n);
  const im = images[idx] || ({} as GalleryImage);
  return (
    <div>
      <div className={`relative overflow-hidden bg-gray-100 ${radius}`}>
        <div style={{ aspectRatio: ratio }}>
          <img src={im.src} alt={im.caption || ""} className="block h-full w-full object-cover" />
        </div>
        {n > 1 &&
          (["prev", "next"] as const).map((dir) => (
            <button
              key={dir}
              type="button"
              aria-label={dir}
              onClick={() => go(dir === "next" ? 1 : -1)}
              className={`absolute top-1/2 grid h-11 w-11 -translate-y-1/2 place-items-center rounded-full bg-white/90 text-p1-text shadow-lg ${
                dir === "prev" ? "left-4" : "right-4"
              }`}
            >
              <Icon name={dir === "prev" ? "chevron-left" : "chevron-right"} className="h-5 w-5" />
            </button>
          ))}
        {captions && im.caption && (
          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 to-transparent px-p1-md pb-p1-md pt-10 text-white">
            {im.caption}
          </div>
        )}
      </div>
      {n > 1 && (
        <div className="mt-p1-md flex justify-center gap-2">
          {images.map((_, di) => (
            <button
              key={di}
              type="button"
              aria-label={`Go to ${di + 1}`}
              onClick={() => setI(di)}
              className={`h-2 rounded-full transition-all ${di === idx ? "w-6 bg-p1-primary" : "w-2 bg-gray-300"}`}
            />
          ))}
        </div>
      )}
    </div>
  );
};

const GalleryView: React.FC<GalleryProps> = ({ heading, layout, columns, gap, ratio, radius, captions, images }) => {
  const imgs = images || [];
  const cols = Math.min(Number(columns) || 3, Math.max(1, imgs.length));
  const g = GAP_PX[gap];
  const rad = RADIUS[radius];
  const cap = captions === "on";

  const tile = (im: GalleryImage, key: number, extra?: React.CSSProperties) => (
    <figure key={key} className="m-0" style={extra}>
      <div className={`overflow-hidden bg-gray-100 ${rad}`}>
        <img
          src={im.src}
          alt={im.caption || ""}
          className="block w-full object-cover"
          style={{ aspectRatio: extra?.aspectRatio, height: extra?.height ?? "100%" }}
        />
      </div>
      {cap && im.caption && <figcaption className="mt-2 text-sm text-p1-text-muted">{im.caption}</figcaption>}
    </figure>
  );

  let body: React.ReactNode;
  if (layout === "masonry") {
    body = (
      <div style={{ columnCount: cols, columnGap: g }}>
        {imgs.map((im, i) => tile(im, i, { breakInside: "avoid", marginBottom: g }))}
      </div>
    );
  } else if (layout === "filmstrip") {
    body = (
      <div className="flex overflow-x-auto pb-2" style={{ gap: g }}>
        {imgs.map((im, i) => tile(im, i, { flex: "none", width: 340, height: 240 }))}
      </div>
    );
  } else if (layout === "carousel") {
    body = <GalleryCarousel images={imgs} radius={rad} ratio={ratio} captions={cap} />;
  } else {
    body = (
      <div className="grid" style={{ gap: g, gridTemplateColumns: `repeat(${cols}, minmax(0,1fr))` }}>
        {imgs.map((im, i) => tile(im, i, { aspectRatio: ratio }))}
      </div>
    );
  }

  return (
    <div className="bg-p1-bg-default px-p1-lg py-p1-xl">
      <div className="mx-auto max-w-6xl">
        {heading && <h2 className="mb-p1-lg text-3xl font-bold tracking-tight text-p1-text md:text-4xl">{heading}</h2>}
        {imgs.length ? (
          body
        ) : (
          <div className="rounded-p1-md border border-dashed border-p1-border p-p1-lg text-center text-p1-text-muted">
            Add images in the inspector.
          </div>
        )}
      </div>
    </div>
  );
};

export const GalleryBlock: ComponentConfig<GalleryProps> = {
  fields: {
    heading: { type: "text", contentEditable: true, visible: false },
    layout: {
      type: "select",
      options: [
        { label: "Grid", value: "grid" },
        { label: "Masonry", value: "masonry" },
        { label: "Filmstrip", value: "filmstrip" },
        { label: "Carousel", value: "carousel" },
      ],
    },
    columns: {
      type: "select",
      options: [
        { label: "2", value: "2" },
        { label: "3", value: "3" },
        { label: "4", value: "4" },
      ],
    },
    gap: {
      type: "select",
      options: [
        { label: "Tight", value: "tight" },
        { label: "Regular", value: "regular" },
        { label: "Wide", value: "wide" },
      ],
    },
    ratio: {
      type: "select",
      options: [
        { label: "1 / 1", value: "1 / 1" },
        { label: "4 / 3", value: "4 / 3" },
        { label: "3 / 2", value: "3 / 2" },
        { label: "16 / 9", value: "16 / 9" },
      ],
    },
    radius: {
      type: "select",
      options: [
        { label: "None", value: "none" },
        { label: "Soft", value: "soft" },
        { label: "Round", value: "round" },
      ],
    },
    captions: {
      type: "radio",
      options: [
        { label: "Off", value: "off" },
        { label: "On", value: "on" },
      ],
    },
    images: {
      type: "array",
      arrayFields: {
        src: { type: "text" },
        caption: { type: "text", contentEditable: true, visible: false },
      },
      defaultItemProps: { src: "https://images.unsplash.com/photo-1522202176988-66273c2fd55f?w=800&q=80", caption: "" },
      getItemSummary: (item) => item.caption || "Image",
    },
  },
  defaultProps: {
    heading: "From the field",
    layout: "grid",
    columns: "3",
    gap: "regular",
    ratio: "4 / 3",
    radius: "soft",
    captions: "off",
    images: [
      { src: "https://images.unsplash.com/photo-1522202176988-66273c2fd55f?w=800&q=80", caption: "Team offsite" },
      { src: "https://images.unsplash.com/photo-1531482615713-2afd69097998?w=800&q=80", caption: "Workshop" },
      { src: "https://images.unsplash.com/photo-1517245386807-bb43f82c33c4?w=800&q=80", caption: "Launch day" },
      { src: "https://images.unsplash.com/photo-1542744173-8e7e53415bb0?w=800&q=80", caption: "Planning" },
      { src: "https://images.unsplash.com/photo-1556761175-5973dc0f32e7?w=800&q=80", caption: "Standup" },
      { src: "https://images.unsplash.com/photo-1551836022-deb4988cc6c0?w=800&q=80", caption: "Ship it" },
    ],
  },
  render: (props) => <GalleryView {...props} />,
};
