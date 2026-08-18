import type { ComponentConfig } from "@puckeditor/core";
import { Btn } from "../internal/btn";

export interface HeroProps {
  eyebrow: string;
  title: string;
  description: string;
  primaryLabel: string;
  secondaryLabel: string;
  tone: "indigo" | "purple" | "dark" | "light";
  layout: "split" | "full image" | "text only";
  imageSrc: string;
  imageSide: "right" | "left";
  imageFill: "card" | "flush";
  splitRatio: "even" | "copy-wide" | "image-wide";
  align: "left" | "center" | "right";
  overlay: "none" | "scrim" | "gradient down" | "gradient right";
  overlayStrength: "light" | "medium" | "heavy";
  knockout: "off" | "on";
}

const TONES: Record<HeroProps["tone"], { wrap: string; onDark: boolean }> = {
  indigo: { wrap: "bg-indigo-900 text-white", onDark: true },
  purple: { wrap: "bg-p1-primary text-white", onDark: true },
  dark: { wrap: "bg-gray-900 text-white", onDark: true },
  light: { wrap: "bg-p1-bg-light text-p1-text", onDark: false },
};

// Responsive side padding shared by every Hero layout — comfortable gutters
// on phones, generous margins on desktop. Stacks below md.
const HERO_PAD = "px-6 sm:px-10 lg:px-16";

// Split column ratios expressed as a 12-col Tailwind grid (literal class names
// so Tailwind's scanner keeps them). Single column below md, ratioed at md+.
const SPLIT: Record<HeroProps["splitRatio"], { copy: string; image: string }> = {
  even: { copy: "md:col-span-6", image: "md:col-span-6" },
  "copy-wide": { copy: "md:col-span-7", image: "md:col-span-5" },
  "image-wide": { copy: "md:col-span-5", image: "md:col-span-7" },
};

export const HeroBlock: ComponentConfig<HeroProps> = {
  fields: {
    eyebrow: { type: "text", contentEditable: true, visible: false },
    title: { type: "text", contentEditable: true, visible: false },
    description: { type: "textarea", contentEditable: true, visible: false },
    primaryLabel: { type: "text", contentEditable: true, visible: false },
    secondaryLabel: { type: "text", contentEditable: true, visible: false },
    tone: {
      type: "select",
      options: [
        { label: "Indigo", value: "indigo" },
        { label: "Purple", value: "purple" },
        { label: "Dark", value: "dark" },
        { label: "Light", value: "light" },
      ],
    },
    layout: {
      type: "select",
      options: [
        { label: "Split", value: "split" },
        { label: "Full image", value: "full image" },
        { label: "Text only", value: "text only" },
      ],
    },
    imageSrc: { type: "text" },
    imageSide: {
      type: "radio",
      options: [
        { label: "Right", value: "right" },
        { label: "Left", value: "left" },
      ],
    },
    imageFill: {
      type: "radio",
      options: [
        { label: "Card", value: "card" },
        { label: "Flush", value: "flush" },
      ],
    },
    splitRatio: {
      type: "select",
      options: [
        { label: "Even", value: "even" },
        { label: "Copy-wide", value: "copy-wide" },
        { label: "Image-wide", value: "image-wide" },
      ],
    },
    align: {
      type: "select",
      options: [
        { label: "Left", value: "left" },
        { label: "Center", value: "center" },
        { label: "Right", value: "right" },
      ],
    },
    overlay: {
      type: "select",
      options: [
        { label: "None", value: "none" },
        { label: "Scrim", value: "scrim" },
        { label: "Gradient ↓", value: "gradient down" },
        { label: "Gradient →", value: "gradient right" },
      ],
    },
    overlayStrength: {
      type: "select",
      options: [
        { label: "Light", value: "light" },
        { label: "Medium", value: "medium" },
        { label: "Heavy", value: "heavy" },
      ],
    },
    knockout: {
      type: "radio",
      options: [
        { label: "Off", value: "off" },
        { label: "On", value: "on" },
      ],
    },
  },
  defaultProps: {
    eyebrow: "New — now available",
    title: "Your big idea, beautifully online.",
    description:
      "A flexible starting point for your next page. Swap in your own headline, story, and imagery — this layout adapts to whatever you publish.",
    primaryLabel: "Start free trial",
    secondaryLabel: "Book a demo →",
    tone: "indigo",
    layout: "split",
    imageSrc: "https://images.unsplash.com/photo-1487958449943-2429e8be8625?w=1200&q=80",
    imageSide: "right",
    imageFill: "card",
    splitRatio: "even",
    align: "left",
    overlay: "gradient right",
    overlayStrength: "medium",
    knockout: "off",
  },
  render: ({
    eyebrow,
    title,
    description,
    primaryLabel,
    secondaryLabel,
    tone,
    layout,
    imageSrc,
    imageSide,
    imageFill,
    splitRatio,
    align,
    overlay,
    overlayStrength,
    knockout,
  }) => {
    const t = TONES[tone];
    const alignCls = align === "center" ? "text-center" : align === "right" ? "text-right" : "text-left";
    const justify = align === "center" ? "justify-center" : align === "right" ? "justify-end" : "justify-start";
    const img = imageSrc || "https://images.unsplash.com/photo-1487958449943-2429e8be8625?w=1200&q=80";
    const ko = knockout === "on";

    const copy = (onDark: boolean) => {
      const titleStyle = ko
        ? {
            backgroundImage: `url(${img})`,
            backgroundSize: "cover",
            backgroundPosition: "center",
            WebkitBackgroundClip: "text",
            backgroundClip: "text",
            color: "transparent",
            WebkitTextFillColor: "transparent",
          }
        : undefined;
      return (
        <div className={`relative z-10 w-full ${align === "center" ? "mx-auto" : ""} ${alignCls}`} style={{ maxWidth: align === "center" ? 760 : 560 }}>
          {eyebrow && (
            <span
              className={`mb-p1-md inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-sm font-medium ${
                onDark ? "border border-white/20 bg-white/10 text-white" : "border border-p1-border bg-white text-p1-text"
              }`}
            >
              <span className="h-1.5 w-1.5 rounded-full bg-p1-warning" />
              {eyebrow}
            </span>
          )}
          <h1
            className="text-3xl font-extrabold leading-[1.02] tracking-tight text-balance sm:text-4xl md:text-5xl lg:text-6xl md:leading-[0.98]"
            style={titleStyle}
          >
            {title}
          </h1>
          <p className={`mt-p1-md max-w-xl text-base leading-relaxed sm:text-lg ${align === "center" ? "mx-auto" : align === "right" ? "ml-auto" : ""} ${onDark ? "text-white/90" : "text-p1-text-muted"}`}>
            {description}
          </p>
          <div className={`mt-p1-lg flex flex-wrap gap-p1-sm ${justify}`}>
            {primaryLabel && <Btn variant="yellow">{primaryLabel}</Btn>}
            {secondaryLabel && (
              <span
                className={`inline-flex items-center rounded-full border px-6 py-3 text-sm font-bold ${
                  onDark ? "border-white/30 text-white" : "border-p1-border text-p1-text"
                }`}
              >
                {secondaryLabel}
              </span>
            )}
          </div>
        </div>
      );
    };

    if (layout === "full image") {
      const a = ({ light: 0.32, medium: 0.56, heavy: 0.8 } as Record<string, number>)[overlayStrength] ?? 0.56;
      let overlayBg = "none";
      if (overlay === "scrim") overlayBg = `rgba(10,6,30,${a})`;
      else if (overlay === "gradient down") overlayBg = `linear-gradient(180deg, rgba(10,6,30,0) 30%, rgba(10,6,30,${a}) 100%)`;
      else if (overlay === "gradient right") overlayBg = `linear-gradient(90deg, rgba(10,6,30,${a + 0.12}) 0%, rgba(10,6,30,${a * 0.5}) 45%, rgba(10,6,30,0) 80%)`;
      return (
        <section className={`relative grid min-h-[460px] items-center overflow-hidden bg-gray-900 py-16 md:min-h-[540px] md:py-24 ${HERO_PAD}`}>
          <img src={img} alt="" className="absolute inset-0 z-0 h-full w-full object-cover" />
          {overlayBg !== "none" && <div className="absolute inset-0 z-[1]" style={{ background: overlayBg }} />}
          <div className={`relative z-[2] mx-auto flex w-full max-w-7xl ${justify}`}>
            {copy(true)}
          </div>
        </section>
      );
    }

    if (layout === "text only") {
      return (
        <section className={`overflow-hidden py-20 md:py-24 ${HERO_PAD} ${t.wrap}`}>
          <div className={`mx-auto flex max-w-7xl ${justify}`}>
            {copy(t.onDark)}
          </div>
        </section>
      );
    }

    // split
    const imgFirst = imageSide === "left";
    const flush = imageFill === "flush";
    const span = SPLIT[splitRatio] || SPLIT.even;

    if (flush) {
      const copyCell = (
        <div className={`flex items-center py-14 md:py-20 ${HERO_PAD}`}>
          {copy(t.onDark)}
        </div>
      );
      const imgCell = (
        <div className="relative min-h-[280px] overflow-hidden md:min-h-[440px]">
          <img src={img} alt="" className="absolute inset-0 h-full w-full object-cover" />
        </div>
      );
      return (
        <section className={`overflow-hidden ${t.wrap}`}>
          <div className="grid items-stretch md:min-h-[480px] md:grid-cols-2">
            {imgFirst ? (
              <>
                {imgCell}
                {copyCell}
              </>
            ) : (
              <>
                {copyCell}
                {imgCell}
              </>
            )}
          </div>
        </section>
      );
    }

    const imageCard = (
      <div className={`overflow-hidden rounded-2xl ${span.image} ${t.onDark ? "border border-white/15 bg-white/5" : "border border-p1-border"}`}>
        <img src={img} alt="" className="aspect-[4/3] h-full w-full object-cover" />
      </div>
    );
    const copyCol = <div className={`flex items-center ${span.copy}`}>{copy(t.onDark)}</div>;
    return (
      <section className={`overflow-hidden py-16 md:py-20 ${HERO_PAD} ${t.wrap}`}>
        <div className="mx-auto grid max-w-7xl grid-cols-1 items-center gap-p1-lg md:grid-cols-12 md:gap-14">
          {imgFirst ? (
            <>
              {imageCard}
              {copyCol}
            </>
          ) : (
            <>
              {copyCol}
              {imageCard}
            </>
          )}
        </div>
      </section>
    );
  },
};
