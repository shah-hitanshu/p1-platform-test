import type { Meta, StoryObj } from "@storybook/react";
import { FooterBlock, type FooterProps } from "@/registry/p1/blocks/footer/footer";

const FooterWrapper = (props: FooterProps) => {
  const Component = FooterBlock.render as React.FC<FooterProps>;
  return <Component {...props} />;
};

const meta = {
  title: "Global/FooterBlock",
  component: FooterWrapper,
  parameters: { layout: "fullwidth" },
  tags: ["autodocs"],
  argTypes: {
    newsletter: { control: "radio", options: ["on", "off"] },
    social: { control: "radio", options: ["on", "off"] },
    legal: { control: "radio", options: ["on", "off"] },
    tone: { control: "select", options: ["dark", "indigo", "light"] },
  },
} satisfies Meta<typeof FooterWrapper>;

export default meta;
type Story = StoryObj<typeof meta>;

const base: FooterProps = {
  logo: "Pantheon",
  tagline:
    "The WebOps platform for WordPress and Drupal. Build, launch, and run ambitious sites — together.",
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
};

export const Dark: Story = { args: { ...base } };
export const Indigo: Story = { args: { ...base, tone: "indigo" } };
export const Light: Story = { args: { ...base, tone: "light" } };
