import type { ComponentConfig } from "@puckeditor/core";
import { defineMeta, wireframe } from '@/registry/p1/internal/define-meta';
import { FigureRender, type FigureProps } from "./figure";
export type { FigureProps };

export const FigureBlock: ComponentConfig<FigureProps> = {
  fields: {
    src: {
      type: "text" as const,
      contentEditable: true,
      visible: false,
      ai: { exclude: true },
    },
    alt: {
      type: "text" as const,
      contentEditable: true,
      visible: false,
      ai: { instructions: "Alt text for the image. 1–2 sentences describing what is shown." },
    },
    caption: {
      type: "text" as const,
      contentEditable: true,
      visible: false,
      ai: { instructions: "A brief caption for the image. 1 sentence." },
    },
    credit: {
      type: "text" as const,
      contentEditable: true,
      visible: false,
      ai: { instructions: "Photo credit. Format: Photo — Source Name." },
    },
    ratio: {
      type: "select" as const,
      options: [
        { label: "16 / 9", value: "16 / 9" },
        { label: "3 / 2", value: "3 / 2" },
        { label: "4 / 3", value: "4 / 3" },
        { label: "1 / 1", value: "1 / 1" },
        { label: "21 / 9", value: "21 / 9" },
      ],
    },
    width: {
      type: "select" as const,
      options: [
        { label: "Contained", value: "contained" },
        { label: "Wide", value: "wide" },
        { label: "Full bleed", value: "full bleed" },
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
    treatment: {
      type: "radio" as const,
      options: [
        { label: "Color", value: "color" },
        { label: "B&W", value: "b&w" },
      ],
    },
  },
  defaultProps: {
    src: wireframe(1300, 731),
    alt: "The team reviewing a preview together",
    caption: "The team reviews a preview link before anything reaches Live.",
    credit: "Photo — Pantheon",
    ratio: "3 / 2",
    width: "wide",
    radius: "soft",
    treatment: "color",
  },
  render: FigureRender,
};

export const meta = defineMeta({
  title: 'Figure',
  description: 'Single image with optional caption and photo credit, supporting aspect ratio, width, radius, and b&w treatment; use for editorial images.',
  categories: ["editorial"],
  published: true,
});
