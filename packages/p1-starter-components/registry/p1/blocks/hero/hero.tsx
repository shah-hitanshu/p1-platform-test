import { wireframe } from '@/registry/p1/internal/define-meta';
import { Btn } from "@/registry/p1/internal/btn";
import "./hero.css";

export interface HeroProps {
  eyebrow: string;
  title: string;
  description: string;
  primaryLabel: string;
  secondaryLabel: string;
  tone: "accent" | "dark" | "light";
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

const FALLBACK_IMG = wireframe(1200, 675);

const ALPHA: Record<HeroProps["overlayStrength"], number> = { light: 0.32, medium: 0.56, heavy: 0.8 };

function overlayGradient(overlay: HeroProps["overlay"], strength: HeroProps["overlayStrength"]): string | undefined {
  const a = ALPHA[strength];
  if (overlay === "scrim") return `rgba(10,6,30,${a})`;
  if (overlay === "gradient down") return `linear-gradient(180deg, rgba(10,6,30,0) 30%, rgba(10,6,30,${a}) 100%)`;
  if (overlay === "gradient right") return `linear-gradient(90deg, rgba(10,6,30,${a + 0.12}) 0%, rgba(10,6,30,${a * 0.5}) 45%, rgba(10,6,30,0) 80%)`;
  return undefined;
}

const SPLIT_COLS: Record<HeroProps["imageSide"], Record<HeroProps["splitRatio"], string>> = {
  right: { even: "1fr 1fr", "copy-wide": "7fr 5fr", "image-wide": "5fr 7fr" },
  left: { even: "1fr 1fr", "copy-wide": "5fr 7fr", "image-wide": "7fr 5fr" },
};

export function HeroRender({
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
}: HeroProps) {
  const img = imageSrc || FALLBACK_IMG;
  const onDark = layout === "full image" || tone !== "light";

  const koStyle: React.CSSProperties | undefined =
    knockout === "on"
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

  const copyBlock = (
    <div className="p1-hero__copy" data-align={align} data-ondark={onDark ? "true" : undefined}>
      {eyebrow && <span className="p1-hero__eyebrow">{eyebrow}</span>}
      <h1 className="p1-hero__title" style={koStyle}>
        {title}
      </h1>
      {description && <p className="p1-hero__desc">{description}</p>}
      <div className="p1-hero__actions" data-align={align}>
        {primaryLabel && <Btn variant="yellow">{primaryLabel}</Btn>}
        {secondaryLabel && <span className="p1-hero__secondary">{secondaryLabel}</span>}
      </div>
    </div>
  );

  if (layout === "full image") {
    const bg = overlayGradient(overlay, overlayStrength);
    return (
      <section className="p1-hero p1-block" data-layout="full-image">
        <img src={img} alt="" className="p1-hero__bg-img" />
        {bg && <div className="p1-hero__overlay" style={{ background: bg }} />}
        <div className="p1-hero__fullimg-content" data-align={align}>
          {copyBlock}
        </div>
      </section>
    );
  }

  if (layout === "text only") {
    return (
      <section className="p1-hero p1-block" data-layout="text-only" data-tone={tone}>
        <div className="p1-hero__text-content" data-align={align}>
          {copyBlock}
        </div>
      </section>
    );
  }

  // split
  const imgFirst = imageSide === "left";
  const cols = SPLIT_COLS[imageSide]?.[splitRatio] ?? "1fr 1fr";

  const imageEl =
    imageFill === "flush" ? (
      <div className="p1-hero__img-flush">
        <img src={img} alt="" className="p1-hero__img" />
      </div>
    ) : (
      <div className="p1-hero__img-card">
        <img src={img} alt="" className="p1-hero__img" />
      </div>
    );

  const copyWrap = <div className="p1-hero__copy-wrap">{copyBlock}</div>;

  return (
    <section className="p1-hero p1-block" data-layout="split" data-tone={tone} data-imagefill={imageFill}>
      <div
        className="p1-hero__split-grid"
        style={{ "--p1-hero-split-cols": cols } as React.CSSProperties}
      >
        {imgFirst ? (
          <>
            {imageEl}
            {copyWrap}
          </>
        ) : (
          <>
            {copyWrap}
            {imageEl}
          </>
        )}
      </div>
    </section>
  );
}
