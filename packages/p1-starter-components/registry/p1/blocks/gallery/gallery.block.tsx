import type { ComponentConfig } from "@puckeditor/core";
import { GalleryRender, type GalleryProps, type GalleryImage } from "./gallery";
export type { GalleryProps, GalleryImage };

export const GalleryBlock: ComponentConfig<GalleryProps> = {
  fields: {
    heading: {
      type: "text" as const,
      contentEditable: true,
      visible: false,
      ai: { instructions: "A short section heading of 2–5 words. Plain text, sentence case." },
    },
    layout: {
      type: "select" as const,
      options: [
        { label: "Grid", value: "grid" },
        { label: "Masonry", value: "masonry" },
        { label: "Filmstrip", value: "filmstrip" },
        { label: "Carousel", value: "carousel" },
      ],
    },
    columns: {
      type: "select" as const,
      options: [
        { label: "2", value: "2" },
        { label: "3", value: "3" },
        { label: "4", value: "4" },
      ],
    },
    gap: {
      type: "select" as const,
      options: [
        { label: "Tight", value: "tight" },
        { label: "Regular", value: "regular" },
        { label: "Wide", value: "wide" },
      ],
    },
    ratio: {
      type: "select" as const,
      options: [
        { label: "1 / 1", value: "1 / 1" },
        { label: "4 / 3", value: "4 / 3" },
        { label: "3 / 2", value: "3 / 2" },
        { label: "16 / 9", value: "16 / 9" },
      ],
    },
    radius: {
      type: "select" as const,
      options: [
        { label: "None", value: "none" },
        { label: "Soft", value: "soft" },
        { label: "Round", value: "round" },
      ],
    },
    captions: {
      type: "radio" as const,
      options: [
        { label: "Off", value: "off" },
        { label: "On", value: "on" },
      ],
    },
    images: {
      type: "array" as const,
      arrayFields: {
        src: { type: "text" as const },
        caption: { type: "text" as const, contentEditable: true, visible: false },
      },
      defaultItemProps: { src: "https://images.unsplash.com/photo-1522202176988-66273c2fd55f?w=800&q=80", caption: "" },
      getItemSummary: (item: GalleryImage) => item.caption || "Image",
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
  render: GalleryRender,
};
