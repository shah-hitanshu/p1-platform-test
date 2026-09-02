import { Btn, type BtnVariant } from "@/registry/p1/internal/btn";
import "./cta.css";

export interface CtaBannerProps {
  eyebrow: string;
  title: string;
  subtitle: string;
  buttonLabel: string;
  secondaryLabel: string;
  layout: "centered" | "split";
  align: "left" | "center";
  tone: "yellow" | "accent" | "dark" | "light" | "gradient" | "outline";
  decoration: "none" | "glow" | "dots";
  corners: "square" | "soft" | "round";
  padding: "compact" | "regular" | "spacious";
}

const BTN_BY_TONE: Record<CtaBannerProps["tone"], BtnVariant> = {
  yellow: "primary",
  accent: "yellow",
  dark: "yellow",
  light: "purple",
  gradient: "yellow",
  outline: "primary",
};

export function CtaBannerRender({
  eyebrow,
  title,
  subtitle,
  buttonLabel,
  secondaryLabel,
  layout,
  align,
  tone,
  decoration,
  corners,
  padding,
}: CtaBannerProps) {
  const split = layout === "split";
  const center = !split && align === "center";

  const textBlock = (
    <div className="p1-cta__text" data-center={center ? "true" : undefined} data-split={split ? "true" : undefined}>
      {eyebrow && <div className="p1-cta__eyebrow">{eyebrow}</div>}
      <h2 className="p1-cta__title">{title}</h2>
      {subtitle && <p className="p1-cta__subtitle">{subtitle}</p>}
      {!split && (
        <div className="p1-cta__actions" data-center={center ? "true" : undefined}>
          {buttonLabel && <Btn variant={BTN_BY_TONE[tone]}>{buttonLabel}</Btn>}
          {secondaryLabel && <span className="p1-cta__secondary">{secondaryLabel}</span>}
        </div>
      )}
    </div>
  );

  const actionsBlock = split ? (
    <div className="p1-cta__actions" data-split="true">
      {buttonLabel && <Btn variant={BTN_BY_TONE[tone]}>{buttonLabel}</Btn>}
      {secondaryLabel && <span className="p1-cta__secondary">{secondaryLabel}</span>}
    </div>
  ) : null;

  return (
    <div className="p1-cta-banner p1-block">
      <div
        className="p1-cta__card"
        data-tone={tone}
        data-corners={corners}
        data-padding={padding}
        data-decoration={decoration}
      >
        {decoration !== "none" && <div className="p1-cta__decoration" aria-hidden="true" />}
        <div className="p1-cta__inner" data-layout={layout}>
          {textBlock}
          {actionsBlock}
        </div>
      </div>
    </div>
  );
}
