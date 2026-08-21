import type { ComponentConfig } from "@puckeditor/core";
import { Btn, type BtnVariant } from "@/registry/p1/internal/btn";

export interface LeadCaptureProps {
  heading: string;
  subtitle: string;
  placeholder: string;
  buttonLabel: string;
  note: string;
  tone: "light" | "purple" | "dark" | "yellow";
  layout: "inline" | "stacked";
}

interface LeadTone {
  wrap: string;
  onDark: boolean;
  btn: BtnVariant;
  sub: string;
  field: string;
}
const TONES: Record<LeadCaptureProps["tone"], LeadTone> = {
  light: { wrap: "bg-p1-bg-light text-p1-text", onDark: false, btn: "purple", sub: "text-p1-text-muted", field: "bg-white border-p1-border" },
  purple: { wrap: "bg-p1-primary text-white", onDark: true, btn: "yellow", sub: "text-white/80", field: "bg-white/15 border-white/25" },
  dark: { wrap: "bg-gray-900 text-white", onDark: true, btn: "yellow", sub: "text-white/70", field: "bg-white/10 border-white/20" },
  yellow: { wrap: "bg-p1-warning text-p1-text", onDark: false, btn: "primary", sub: "text-p1-primary", field: "bg-white border-black/10" },
};

export const LeadCaptureBlock: ComponentConfig<LeadCaptureProps> = {
  fields: {
    heading: { type: "text", contentEditable: true, visible: false },
    subtitle: { type: "text", contentEditable: true, visible: false },
    placeholder: { type: "text", contentEditable: true, visible: false },
    buttonLabel: { type: "text", contentEditable: true, visible: false },
    note: { type: "text", contentEditable: true, visible: false },
    tone: {
      type: "select",
      options: [
        { label: "Light", value: "light" },
        { label: "Purple", value: "purple" },
        { label: "Dark", value: "dark" },
        { label: "Yellow", value: "yellow" },
      ],
    },
    layout: {
      type: "radio",
      options: [
        { label: "Inline", value: "inline" },
        { label: "Stacked", value: "stacked" },
      ],
    },
  },
  defaultProps: {
    heading: "Stay in the loop.",
    subtitle: "Occasional updates, straight to your inbox.",
    placeholder: "you@company.com",
    buttonLabel: "Subscribe",
    note: "No spam. Unsubscribe anytime.",
    tone: "purple",
    layout: "inline",
  },
  render: ({ heading, subtitle, placeholder, buttonLabel, note, tone, layout }) => {
    const t = TONES[tone];
    const inline = layout === "inline";
    return (
      <div className="px-p1-lg py-p1-md">
        <div className={`mx-auto max-w-7xl rounded-3xl px-p1-lg py-p1-xl text-center ${t.wrap}`}>
          <h2 className="mb-p1-sm text-3xl font-extrabold tracking-tight md:text-4xl">{heading}</h2>
          {subtitle && <p className={`mx-auto mb-p1-lg max-w-xl ${t.sub}`}>{subtitle}</p>}
          <div className={`mx-auto flex items-stretch gap-2.5 ${inline ? "max-w-md flex-row" : "max-w-sm flex-col"}`}>
            <div className={`flex flex-1 items-center rounded-full border px-4 py-3 text-left text-sm ${t.field} ${t.onDark ? "text-white/60" : "text-gray-400"}`}>
              {placeholder}
            </div>
            <Btn variant={t.btn} className={inline ? "" : "justify-center"}>
              {buttonLabel}
            </Btn>
          </div>
          {note && <div className={`mt-p1-sm text-xs font-medium ${t.sub}`}>{note}</div>}
        </div>
      </div>
    );
  },
};
