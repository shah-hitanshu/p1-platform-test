import type { ComponentConfig } from "@puckeditor/core";

export interface ImageProps {
  src: string;
  alt: string;
  width: "contained" | "full bleed";
  ratio: "16 / 9" | "4 / 3" | "1 / 1" | "3 / 2" | "21 / 9";
  fit: "cover" | "contain" | "fill";
  position: "center" | "top" | "bottom" | "left" | "right";
  radius: "none" | "soft" | "round";
  treatment: "color" | "b&w";
}

const RADIUS: Record<ImageProps["radius"], string> = {
  none: "rounded-none",
  soft: "rounded-p1-lg",
  round: "rounded-3xl",
};

export const ImageBlock: ComponentConfig<ImageProps> = {
  fields: {
    src: { type: "text" },
    alt: { type: "text" },
    width: {
      type: "radio",
      options: [
        { label: "Contained", value: "contained" },
        { label: "Full bleed", value: "full bleed" },
      ],
    },
    ratio: {
      type: "select",
      options: [
        { label: "16 / 9", value: "16 / 9" },
        { label: "4 / 3", value: "4 / 3" },
        { label: "1 / 1", value: "1 / 1" },
        { label: "3 / 2", value: "3 / 2" },
        { label: "21 / 9", value: "21 / 9" },
      ],
    },
    fit: {
      type: "select",
      options: [
        { label: "Cover", value: "cover" },
        { label: "Contain", value: "contain" },
        { label: "Fill", value: "fill" },
      ],
    },
    position: {
      type: "select",
      options: [
        { label: "Center", value: "center" },
        { label: "Top", value: "top" },
        { label: "Bottom", value: "bottom" },
        { label: "Left", value: "left" },
        { label: "Right", value: "right" },
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
    treatment: {
      type: "radio",
      options: [
        { label: "Color", value: "color" },
        { label: "B&W", value: "b&w" },
      ],
    },
  },
  defaultProps: {
    src: "https://images.unsplash.com/photo-1559136555-9303baea8ebd?w=1100&q=80",
    alt: "Editorial photograph",
    width: "contained",
    ratio: "16 / 9",
    fit: "cover",
    position: "center",
    radius: "soft",
    treatment: "color",
  },
  render: ({ src, alt, width, ratio, fit, position, radius, treatment }) => {
    const full = width === "full bleed";
    return (
      <div className={`mx-auto ${full ? "max-w-none px-0" : "max-w-6xl px-p1-lg py-p1-md"}`}>
        <div
          className={`overflow-hidden bg-gray-100 ${full ? "rounded-none" : `${RADIUS[radius]} border border-p1-border`}`}
          style={{ aspectRatio: ratio }}
        >
          <img
            src={src}
            alt={alt}
            className={`h-full w-full ${treatment === "b&w" ? "grayscale" : ""}`}
            style={{ objectFit: fit, objectPosition: position }}
          />
        </div>
      </div>
    );
  },
};
