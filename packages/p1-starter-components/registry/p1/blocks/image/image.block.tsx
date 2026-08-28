import type { ComponentConfig } from "@puckeditor/core";
import { defineMeta, wireframe } from '../define-meta';
import { ImageRender, type ImageProps } from "./image";
export type { ImageProps };

export const ImageBlock: ComponentConfig<ImageProps> = {
  fields: {
    src: {
      type: "text" as const,
      ai: { exclude: true },
    },
    alt: {
      type: "text" as const,
      ai: { instructions: "Concise alt text describing what's in the image. Screen reader users depend on this." },
    },
    width: {
      type: "radio" as const,
      options: [
        { label: "Contained", value: "contained" },
        { label: "Full bleed", value: "full bleed" },
      ],
    },
    ratio: {
      type: "select" as const,
      options: [
        { label: "16 / 9", value: "16 / 9" },
        { label: "4 / 3", value: "4 / 3" },
        { label: "1 / 1", value: "1 / 1" },
        { label: "3 / 2", value: "3 / 2" },
        { label: "21 / 9", value: "21 / 9" },
      ],
    },
    fit: {
      type: "select" as const,
      options: [
        { label: "Cover", value: "cover" },
        { label: "Contain", value: "contain" },
        { label: "Fill", value: "fill" },
      ],
    },
    position: {
      type: "select" as const,
      options: [
        { label: "Center", value: "center" },
        { label: "Top", value: "top" },
        { label: "Bottom", value: "bottom" },
        { label: "Left", value: "left" },
        { label: "Right", value: "right" },
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
    src: wireframe(1100, 619),
    alt: "Editorial photograph",
    width: "contained",
    ratio: "16 / 9",
    fit: "cover",
    position: "center",
    radius: "soft",
    treatment: "color",
  },
  render: ImageRender,
};

export const meta = defineMeta({
  title: 'Image',
  description: 'Simple full-bleed or contained image block with aspect ratio, fit, position, radius, and b&w treatment controls; use for standalone images.',
  categories: ["showcase"],
  published: true,
});
