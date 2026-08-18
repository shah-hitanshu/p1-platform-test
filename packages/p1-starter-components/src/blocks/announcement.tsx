import type { ComponentConfig } from "@puckeditor/core";

export interface AnnouncementProps {
  text: string;
  linkLabel: string;
  tone: "purple" | "yellow" | "dark" | "gradient";
  align: "center" | "left";
}

const TONES: Record<AnnouncementProps["tone"], { wrap: string; link: string }> = {
  purple: { wrap: "bg-p1-primary text-white", link: "text-p1-warning" },
  yellow: { wrap: "bg-p1-warning text-p1-text", link: "text-p1-primary" },
  dark: { wrap: "bg-gray-900 text-white", link: "text-p1-warning" },
  gradient: { wrap: "bg-gradient-to-r from-fuchsia-600 via-purple-700 to-indigo-900 text-white", link: "text-p1-warning" },
};

export const AnnouncementBlock: ComponentConfig<AnnouncementProps> = {
  fields: {
    text: { type: "text", contentEditable: true, visible: false },
    linkLabel: { type: "text", contentEditable: true, visible: false },
    tone: {
      type: "select",
      options: [
        { label: "Purple", value: "purple" },
        { label: "Yellow", value: "yellow" },
        { label: "Dark", value: "dark" },
        { label: "Gradient", value: "gradient" },
      ],
    },
    align: {
      type: "radio",
      options: [
        { label: "Center", value: "center" },
        { label: "Left", value: "left" },
      ],
    },
  },
  defaultProps: {
    text: "Something new just launched — take a look.",
    linkLabel: "Read the announcement →",
    tone: "purple",
    align: "center",
  },
  render: ({ text, linkLabel, tone, align }) => {
    const t = TONES[tone];
    return (
      <div className={`flex flex-wrap items-center gap-3 px-p1-lg py-3 ${t.wrap} ${align === "left" ? "justify-start" : "justify-center"}`}>
        <span className="text-sm font-medium">{text}</span>
        {linkLabel && <span className={`text-sm font-bold ${t.link}`}>{linkLabel}</span>}
      </div>
    );
  },
};
