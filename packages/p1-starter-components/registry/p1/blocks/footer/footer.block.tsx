import type { ComponentConfig } from "@puckeditor/core";
import { FooterRender, type FooterProps, type FooterColumn } from "./footer";
export type { FooterProps, FooterColumn };

export const FooterBlock: ComponentConfig<FooterProps> = {
  fields: {
    logo: {
      type: "text" as const,
      contentEditable: true,
      visible: false,
      ai: { instructions: "Brand name shown in the footer." },
    },
    tagline: {
      type: "text" as const,
      contentEditable: true,
      visible: false,
      ai: { instructions: "1–2 sentence brand description below the logo." },
    },
    columns: {
      type: "array",
      arrayFields: {
        title: {
          type: "text" as const,
          contentEditable: true,
          visible: false,
          ai: { instructions: "Column heading. 1–2 words." },
        },
        links: { type: "textarea" },
      },
      defaultItemProps: { title: "Column", links: "Link one\nLink two" },
      getItemSummary: (item: FooterColumn) => item.title || "Column",
    },
    newsletter: {
      type: "radio" as const,
      options: [
        { label: "On", value: "on" },
        { label: "Off", value: "off" },
      ],
    },
    newsletterTitle: {
      type: "text" as const,
      contentEditable: true,
      visible: false,
      ai: { instructions: "Newsletter section heading. Under 6 words." },
    },
    newsletterButton: {
      type: "text" as const,
      contentEditable: true,
      visible: false,
      ai: { instructions: "Newsletter CTA label. 1–2 words." },
    },
    social: {
      type: "radio" as const,
      options: [
        { label: "On", value: "on" },
        { label: "Off", value: "off" },
      ],
    },
    legal: {
      type: "radio" as const,
      options: [
        { label: "On", value: "on" },
        { label: "Off", value: "off" },
      ],
    },
    copyright: {
      type: "text" as const,
      contentEditable: true,
      visible: false,
      ai: { instructions: "Copyright line. E.g. © 2026 Company, Inc." },
    },
    legalLinks: {
      type: "text" as const,
      ai: { instructions: "Legal link labels separated by newlines. E.g. Privacy\nTerms\nSecurity." },
    },
    tone: {
      type: "select" as const,
      options: [
        { label: "Dark", value: "dark" },
        { label: "Accent", value: "accent" },
        { label: "Light", value: "light" },
      ],
    },
  },
  defaultProps: {
    logo: "Pantheon",
    tagline: "The WebOps platform for WordPress and Drupal. Build, launch, and run ambitious sites — together.",
    columns: [
      { title: "Product", links: "Overview\nIntegrations\nPricing\nChangelog" },
      { title: "Solutions", links: "Agencies\nEnterprise\nHigher ed\nGovernment" },
      { title: "Resources", links: "Docs\nGuides\nBlog\nSupport" },
      { title: "Company", links: "About\nCareers\nPartners\nContact" },
    ],
    newsletter: "on",
    newsletterTitle: "Ship better, every week.",
    newsletterButton: "Subscribe",
    social: "on",
    legal: "on",
    copyright: "© 2026 Pantheon Systems, Inc.",
    legalLinks: "Privacy\nTerms\nSecurity\nStatus",
    tone: "dark",
  },
  render: FooterRender,
};
