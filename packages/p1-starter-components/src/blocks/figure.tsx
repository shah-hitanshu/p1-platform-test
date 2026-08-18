import type { ComponentConfig } from "@puckeditor/core";

export interface FigureProps {
  src: string;
  alt: string;
  caption: string;
  credit: string;
  ratio: "16 / 9" | "3 / 2" | "4 / 3" | "1 / 1" | "21 / 9";
  width: "contained" | "wide" | "full bleed";
  radius: "none" | "soft" | "round";
  treatment: "color" | "b&w";
}

const WIDTH: Record<FigureProps["width"], string> = {
  contained: "max-w-3xl",
  wide: "max-w-6xl",
  "full bleed": "max-w-none",
};
const RADIUS: Record<FigureProps["radius"], string> = {
  none: "rounded-none",
  soft: "rounded-p1-lg",
  round: "rounded-3xl",
};

export const FigureBlock: ComponentConfig<FigureProps> = {
  fields: {
    src: { type: "text" },
    alt: { type: "text" },
    caption: { type: "text", contentEditable: true, visible: false },
    credit: { type: "text", contentEditable: true, visible: false },
    ratio: {
      type: "select",
      options: [
        { label: "16 / 9", value: "16 / 9" },
        { label: "3 / 2", value: "3 / 2" },
        { label: "4 / 3", value: "4 / 3" },
        { label: "1 / 1", value: "1 / 1" },
        { label: "21 / 9", value: "21 / 9" },
      ],
    },
    width: {
      type: "select",
      options: [
        { label: "Contained", value: "contained" },
        { label: "Wide", value: "wide" },
        { label: "Full bleed", value: "full bleed" },
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
    src: "https://images.unsplash.com/photo-1522071820081-009f0129c71c?w=1300&q=80",
    alt: "The team reviewing a preview together",
    caption: "The team reviews a preview link before anything reaches Live.",
    credit: "Photo — Pantheon",
    ratio: "3 / 2",
    width: "wide",
    radius: "soft",
    treatment: "color",
  },
  render: ({ src, alt, caption, credit, ratio, width, radius, treatment }) => {
    const full = width === "full bleed";
    const hasCap = Boolean(caption || credit);
    return (
      <figure className={`mx-auto py-p1-md ${full ? "px-0" : "px-p1-lg"} ${WIDTH[width]}`}>
        <div
          className={`overflow-hidden bg-gray-100 ${full ? "rounded-none" : RADIUS[radius]} ${
            full ? "" : "border border-p1-border"
          }`}
          style={{ aspectRatio: ratio }}
        >
          <img
            src={src}
            alt={alt}
            className={`h-full w-full object-cover ${treatment === "b&w" ? "grayscale" : ""}`}
          />
        </div>
        {hasCap && (
          <figcaption
            className={`mt-p1-sm flex flex-wrap items-baseline justify-between gap-p1-md ${
              full ? "mx-auto max-w-6xl" : ""
            }`}
          >
            <span className="flex-1 text-sm leading-relaxed text-p1-text-muted">{caption}</span>
            {credit && (
              <span className="flex-none font-serif text-xs italic text-p1-text-muted/80">{credit}</span>
            )}
          </figcaption>
        )}
      </figure>
    );
  },
};
