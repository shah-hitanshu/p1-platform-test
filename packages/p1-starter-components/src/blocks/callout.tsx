import type { ComponentConfig } from "@puckeditor/core";
import { Icon, type IconName } from "../internal/icons";

export interface CalloutProps {
  variant: "note" | "info" | "tip" | "warning";
  title: string;
  body: string;
}

const VARIANTS: Record<
  CalloutProps["variant"],
  { wrap: string; accentBorder: string; chip: string; icon: IconName }
> = {
  note: {
    wrap: "bg-gray-50 border-p1-border",
    accentBorder: "border-l-p1-text-muted",
    chip: "bg-gray-200 text-p1-text-muted",
    icon: "lines",
  },
  info: {
    wrap: "bg-indigo-50 border-indigo-200",
    accentBorder: "border-l-p1-primary",
    chip: "bg-indigo-100 text-p1-primary",
    icon: "info",
  },
  tip: {
    wrap: "bg-emerald-50 border-emerald-200",
    accentBorder: "border-l-p1-success",
    chip: "bg-emerald-100 text-p1-success",
    icon: "lightbulb",
  },
  warning: {
    wrap: "bg-amber-50 border-amber-200",
    accentBorder: "border-l-p1-warning",
    chip: "bg-amber-100 text-amber-700",
    icon: "warning",
  },
};

export const CalloutBlock: ComponentConfig<CalloutProps> = {
  fields: {
    variant: {
      type: "select",
      options: [
        { label: "Note", value: "note" },
        { label: "Info", value: "info" },
        { label: "Tip", value: "tip" },
        { label: "Warning", value: "warning" },
      ],
    },
    title: { type: "text", contentEditable: true, visible: false },
    body: { type: "textarea", contentEditable: true, visible: false },
  },
  defaultProps: {
    variant: "tip",
    title: "Try this",
    body: "Make “preview first” the default. Share the link before you publish — reviewers stop guessing and start seeing.",
  },
  render: ({ variant, title, body }) => {
    const v = VARIANTS[variant];
    return (
      <div className="mx-auto max-w-3xl px-p1-lg py-p1-sm">
        <div className={`flex gap-p1-md rounded-p1-md border border-l-4 p-p1-md ${v.wrap} ${v.accentBorder}`}>
          <div className={`grid h-9 w-9 flex-none place-items-center rounded-full ${v.chip}`}>
            <Icon name={v.icon} className="h-[18px] w-[18px]" />
          </div>
          <div className="min-w-0 flex-1">
            {title && <div className="mb-1 font-bold text-p1-text">{title}</div>}
            <p className="m-0 text-[15px] leading-relaxed text-pretty text-p1-text/80">{body}</p>
          </div>
        </div>
      </div>
    );
  },
};
