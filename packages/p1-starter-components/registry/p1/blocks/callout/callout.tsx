import { Icon, type IconName } from "@/registry/p1/internal/icons";
import "./callout.css";

export interface CalloutProps {
  variant: "note" | "info" | "tip" | "warning";
  title: string;
  body: string;
}

const ICON_BY_VARIANT: Record<CalloutProps["variant"], IconName> = {
  note: "lines",
  info: "info",
  tip: "lightbulb",
  warning: "warning",
};

export function CalloutRender({ variant, title, body }: CalloutProps) {
  return (
    <div className="p1-callout p1-block" data-variant={variant}>
      <div className="p1-callout__inner">
        <div className="p1-callout__box">
          <div className="p1-callout__icon-wrap" aria-hidden="true">
            <Icon name={ICON_BY_VARIANT[variant]} className="p1-callout__icon" />
          </div>
          <div className="p1-callout__content">
            {title && <div className="p1-callout__title">{title}</div>}
            <p className="p1-callout__body">{body}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
