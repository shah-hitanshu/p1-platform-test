import type { ComponentConfig } from "@puckeditor/core";
import { Btn, type BtnVariant } from "@/registry/p1/internal/btn";

export interface CtaBannerProps {
  eyebrow: string;
  title: string;
  subtitle: string;
  buttonLabel: string;
  secondaryLabel: string;
  layout: "centered" | "split";
  align: "left" | "center";
  tone: "yellow" | "purple" | "dark" | "light" | "gradient" | "outline";
  decoration: "none" | "glow" | "dots";
  corners: "square" | "soft" | "round";
  padding: "compact" | "regular" | "spacious";
}

interface CtaTone {
  wrap: string;
  onDark: boolean;
  btn: BtnVariant;
  sub: string;
  glow: string;
}
const TONES: Record<CtaBannerProps["tone"], CtaTone> = {
  yellow: { wrap: "bg-p1-warning text-p1-text", onDark: false, btn: "primary", sub: "text-p1-primary", glow: "rgba(255,255,255,.5)" },
  purple: { wrap: "bg-p1-primary text-white", onDark: true, btn: "yellow", sub: "text-p1-warning", glow: "rgba(255,255,255,.18)" },
  dark: { wrap: "bg-gray-900 text-white", onDark: true, btn: "yellow", sub: "text-p1-warning", glow: "rgba(99,102,241,.45)" },
  light: { wrap: "bg-p1-bg-light text-p1-text border border-p1-border", onDark: false, btn: "purple", sub: "text-p1-primary", glow: "rgba(99,102,241,.14)" },
  gradient: { wrap: "bg-gradient-to-br from-fuchsia-600 via-purple-700 to-indigo-900 text-white", onDark: true, btn: "yellow", sub: "text-p1-warning", glow: "rgba(255,255,255,.16)" },
  outline: { wrap: "bg-white text-p1-text border-2 border-gray-900", onDark: false, btn: "primary", sub: "text-p1-primary", glow: "rgba(99,102,241,.12)" },
};
const CORNERS: Record<CtaBannerProps["corners"], string> = { square: "rounded-md", soft: "rounded-2xl", round: "rounded-3xl" };
const PADDING: Record<CtaBannerProps["padding"], string> = { compact: "p-p1-lg", regular: "p-10", spacious: "p-16" };

export const CtaBannerBlock: ComponentConfig<CtaBannerProps> = {
  fields: {
    eyebrow: { type: "text", contentEditable: true, visible: false },
    title: { type: "text", contentEditable: true, visible: false },
    subtitle: { type: "text", contentEditable: true, visible: false },
    buttonLabel: { type: "text", contentEditable: true, visible: false },
    secondaryLabel: { type: "text", contentEditable: true, visible: false },
    layout: {
      type: "select",
      options: [
        { label: "Centered", value: "centered" },
        { label: "Split", value: "split" },
      ],
    },
    align: {
      type: "radio",
      options: [
        { label: "Left", value: "left" },
        { label: "Center", value: "center" },
      ],
    },
    tone: {
      type: "select",
      options: [
        { label: "Yellow", value: "yellow" },
        { label: "Purple", value: "purple" },
        { label: "Dark", value: "dark" },
        { label: "Light", value: "light" },
        { label: "Gradient", value: "gradient" },
        { label: "Outline", value: "outline" },
      ],
    },
    decoration: {
      type: "select",
      options: [
        { label: "None", value: "none" },
        { label: "Glow", value: "glow" },
        { label: "Dots", value: "dots" },
      ],
    },
    corners: {
      type: "select",
      options: [
        { label: "Square", value: "square" },
        { label: "Soft", value: "soft" },
        { label: "Round", value: "round" },
      ],
    },
    padding: {
      type: "select",
      options: [
        { label: "Compact", value: "compact" },
        { label: "Regular", value: "regular" },
        { label: "Spacious", value: "spacious" },
      ],
    },
  },
  defaultProps: {
    eyebrow: "",
    title: "Ready to ship faster?",
    subtitle: "Start a free trial — no credit card, no deploy pipeline to wrangle.",
    buttonLabel: "Start free trial",
    secondaryLabel: "",
    layout: "centered",
    align: "center",
    tone: "yellow",
    decoration: "none",
    corners: "round",
    padding: "regular",
  },
  render: ({ eyebrow, title, subtitle, buttonLabel, secondaryLabel, layout, align, tone, decoration, corners, padding }) => {
    const t = TONES[tone];
    const split = layout === "split";
    const center = !split && align === "center";
    const buttons = (
      <div className={`flex flex-wrap items-center gap-p1-sm ${split ? "justify-end" : center ? "justify-center" : "justify-start"}`}>
        {buttonLabel && <Btn variant={t.btn}>{buttonLabel}</Btn>}
        {secondaryLabel && (
          <span
            className={`inline-flex items-center rounded-full border px-6 py-3 text-sm font-bold ${
              t.onDark ? "border-white/30 text-white" : "border-gray-300 text-p1-text"
            }`}
          >
            {secondaryLabel}
          </span>
        )}
      </div>
    );
    const text = (
      <div className={`${split ? "text-left" : center ? "mx-auto text-center" : "text-left"} ${split ? "" : "max-w-xl"}`}>
        {eyebrow && <div className={`mb-p1-sm text-xs font-bold uppercase tracking-[0.16em] ${t.sub}`}>{eyebrow}</div>}
        <h2 className="mb-p1-sm text-3xl font-extrabold tracking-tight md:text-4xl">{title}</h2>
        {subtitle && <p className={`text-lg leading-relaxed ${t.onDark ? "text-white/90" : "text-p1-text-muted"} ${center ? "mx-auto max-w-xl" : "max-w-xl"} ${split ? "" : "mb-p1-lg"}`}>{subtitle}</p>}
        {!split && buttons}
      </div>
    );
    return (
      <div className={`${tone === "gradient" || tone === "outline" || tone === "light" ? "px-p1-lg py-p1-md" : "px-p1-lg py-p1-md"}`}>
        <div className={`relative mx-auto max-w-6xl overflow-hidden ${t.wrap} ${CORNERS[corners]} ${PADDING[padding]}`}>
          {decoration === "glow" && (
            <div
              className="pointer-events-none absolute -right-28 -top-40 h-[520px] w-[520px] rounded-full"
              style={{ background: `radial-gradient(circle, ${t.glow}, transparent 70%)` }}
            />
          )}
          {decoration === "dots" && (
            <div
              className="pointer-events-none absolute inset-0 opacity-[0.08]"
              style={{ backgroundImage: "radial-gradient(currentColor 1.3px, transparent 1.3px)", backgroundSize: "22px 22px" }}
            />
          )}
          <div className="relative">
            {split ? (
              <div className="grid items-center gap-p1-lg md:grid-cols-[1.4fr_auto]">
                {text}
                {buttons}
              </div>
            ) : (
              text
            )}
          </div>
        </div>
      </div>
    );
  },
};
