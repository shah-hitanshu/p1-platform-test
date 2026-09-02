import type { ComponentConfig } from "@puckeditor/core";
import { HeaderRender, type HeaderProps, type HeaderLink } from "./header";
export type { HeaderProps, HeaderLink };

export const HeaderBlock: ComponentConfig<HeaderProps> = {
  fields: {
    logo: {
      type: "text" as const,
      contentEditable: true,
      visible: false,
      ai: { instructions: "Brand name or wordmark shown in the header." },
    },
    links: {
      type: "array",
      arrayFields: {
        label: {
          type: "text" as const,
          contentEditable: true,
          visible: false,
          ai: { instructions: "Nav link label. 1–2 words." },
        },
        href: {
          type: "text" as const,
          contentEditable: true,
          visible: false,
          ai: { exclude: true },
        },
      },
      defaultItemProps: { label: "Link", href: "#" },
      getItemSummary: (item: HeaderLink) => item.label || "Link",
    },
    navAlign: {
      type: "select" as const,
      options: [
        { label: "Left", value: "left" },
        { label: "Center", value: "center" },
        { label: "Right", value: "right" },
      ],
    },
    showSearch: {
      type: "radio" as const,
      options: [
        { label: "Off", value: "off" },
        { label: "On", value: "on" },
      ],
    },
    ctaLabel: {
      type: "text" as const,
      contentEditable: true,
      visible: false,
      ai: { instructions: "Header CTA label. 2–4 words." },
    },
    ctaStyle: {
      type: "select" as const,
      options: [
        { label: "Primary", value: "primary" },
        { label: "Yellow", value: "yellow" },
        { label: "Purple", value: "purple" },
        { label: "Outline", value: "outline" },
        { label: "None", value: "none" },
      ],
    },
    tone: {
      type: "select" as const,
      options: [
        { label: "White", value: "white" },
        { label: "Light", value: "light" },
        { label: "Dark", value: "dark" },
      ],
    },
    border: {
      type: "radio" as const,
      options: [
        { label: "On", value: "on" },
        { label: "Off", value: "off" },
      ],
    },
    sticky: {
      type: "radio" as const,
      options: [
        { label: "Off", value: "off" },
        { label: "On", value: "on" },
      ],
    },
  },
  defaultProps: {
    logo: "Pantheon",
    links: [
      { label: "Product", href: "#" },
      { label: "Solutions", href: "#" },
      { label: "Pricing", href: "#" },
      { label: "Docs", href: "#" },
      { label: "Customers", href: "#" },
    ],
    navAlign: "center",
    showSearch: "on",
    ctaLabel: "Start for free",
    ctaStyle: "primary",
    tone: "white",
    border: "on",
    sticky: "off",
  },
  render: HeaderRender,
};
