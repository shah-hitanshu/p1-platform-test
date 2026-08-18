import type { Meta, StoryObj } from "@storybook/react";
import { HeaderBlock, type HeaderProps } from "../src/blocks/header";

const HeaderWrapper = (props: HeaderProps) => {
  const Component = HeaderBlock.render as React.FC<HeaderProps>;
  return <Component {...props} />;
};

const meta = {
  title: "Global/HeaderBlock",
  component: HeaderWrapper,
  parameters: { layout: "fullwidth" },
  tags: ["autodocs"],
  argTypes: {
    navAlign: { control: "select", options: ["left", "center", "right"] },
    showSearch: { control: "radio", options: ["off", "on"] },
    ctaStyle: { control: "select", options: ["primary", "yellow", "purple", "outline", "none"] },
    tone: { control: "select", options: ["white", "light", "dark"] },
    border: { control: "radio", options: ["on", "off"] },
    sticky: { control: "radio", options: ["off", "on"] },
  },
} satisfies Meta<typeof HeaderWrapper>;

export default meta;
type Story = StoryObj<typeof meta>;

const base: HeaderProps = {
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
};

export const Light: Story = { args: { ...base } };
export const Dark: Story = { args: { ...base, tone: "dark", ctaStyle: "yellow" } };
export const LeftAligned: Story = { args: { ...base, navAlign: "left", ctaStyle: "purple" } };
