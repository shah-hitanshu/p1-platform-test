import type { ComponentConfig } from "@puckeditor/core";
import { defineMeta, wireframe } from '../define-meta';
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
      defaultItemProps: { src: wireframe(800, 600), caption: "" },
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
      { src: wireframe(800, 600), caption: "Team offsite" },
      { src: wireframe(800, 600), caption: "Workshop" },
      { src: wireframe(800, 600), caption: "Launch day" },
      { src: wireframe(800, 600), caption: "Planning" },
      { src: wireframe(800, 600), caption: "Standup" },
      { src: wireframe(800, 600), caption: "Ship it" },
    ],
  },
  render: GalleryRender,
};

export const meta = defineMeta({
  title: 'Gallery',
  description: 'Multi-image display in grid, masonry, filmstrip, or carousel layout with optional captions and configurable columns/gap/ratio; use for photo galleries.',
  categories: ["showcase"],
  published: true,
  registryDependencies: ["@p1/tokens","@p1/internal-icons"],
});
