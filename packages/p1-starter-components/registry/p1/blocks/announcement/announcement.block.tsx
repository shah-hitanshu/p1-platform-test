import type { ComponentConfig } from "@puckeditor/core";
import { defineMeta } from '../define-meta';
import { AnnouncementRender, type AnnouncementProps } from "./announcement";
export type { AnnouncementProps };

export const AnnouncementBlock: ComponentConfig<AnnouncementProps> = {
  fields: {
    text: {
      type: "text" as const,
      contentEditable: true,
      visible: false,
      ai: { instructions: "Short announcement message. 1 sentence." },
    },
    linkLabel: {
      type: "text" as const,
      contentEditable: true,
      visible: false,
      ai: { instructions: "CTA label after the message. E.g. Read more →. Leave blank to omit." },
    },
    tone: {
      type: "select" as const,
      options: [
        { label: "Accent", value: "accent" },
        { label: "Yellow", value: "yellow" },
        { label: "Dark", value: "dark" },
        { label: "Gradient", value: "gradient" },
      ],
    },
    align: {
      type: "radio" as const,
      options: [
        { label: "Center", value: "center" },
        { label: "Left", value: "left" },
      ],
    },
  },
  defaultProps: {
    text: "Something new just launched — take a look.",
    linkLabel: "Read the announcement →",
    tone: "accent",
    align: "center",
  },
  render: AnnouncementRender,
};

export const meta = defineMeta({
  title: 'Announcement',
  description: 'Slim banner strip with a text message and optional link label in themed tones (purple/yellow/dark/gradient); use for site-wide notices.',
  categories: ["attention"],
});
