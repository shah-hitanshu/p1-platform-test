import { Btn, type BtnVariant } from "@/registry/p1/internal/btn";
import "./lead-capture.css";

export interface LeadCaptureProps {
  heading: string;
  subtitle: string;
  placeholder: string;
  buttonLabel: string;
  note: string;
  tone: "light" | "purple" | "dark" | "yellow";
  layout: "inline" | "stacked";
}

const BTN_BY_TONE: Record<LeadCaptureProps["tone"], BtnVariant> = {
  light: "purple",
  purple: "yellow",
  dark: "yellow",
  yellow: "primary",
};

export function LeadCaptureRender({
  heading,
  subtitle,
  placeholder,
  buttonLabel,
  note,
  tone,
  layout,
}: LeadCaptureProps) {
  return (
    <div className="p1-lead-capture p1-block">
      <div className="p1-lead-capture__card" data-tone={tone} data-layout={layout}>
        <h2 className="p1-lead-capture__heading">{heading}</h2>
        {subtitle && <p className="p1-lead-capture__subtitle">{subtitle}</p>}
        <div className="p1-lead-capture__form">
          <div className="p1-lead-capture__field">{placeholder}</div>
          <Btn variant={BTN_BY_TONE[tone]}>{buttonLabel}</Btn>
        </div>
        {note && <div className="p1-lead-capture__note">{note}</div>}
      </div>
    </div>
  );
}
