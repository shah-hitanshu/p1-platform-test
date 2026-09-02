import type { Meta, StoryObj } from "@storybook/react";
import { TestimonialBlock, type TestimonialProps } from "@/registry/p1/blocks/testimonial/testimonial.block";
import { wireframe } from '@/registry/p1/internal/define-meta';

const TestimonialWrapper = (props: TestimonialProps) => {
  const Component = TestimonialBlock.render as React.FC<TestimonialProps>;
  return <Component {...props} />;
};

const meta = {
  title: "Trust/TestimonialBlock",
  component: TestimonialWrapper,
  parameters: { layout: "fullwidth" },
  tags: ["autodocs"],
  argTypes: {
    layout: { control: "select", options: ["centered", "card", "large"] },
    tone: { control: "select", options: ["light", "white", "accent", "dark"] },
  },
} satisfies Meta<typeof TestimonialWrapper>;

export default meta;
type Story = StoryObj<typeof meta>;

const base: TestimonialProps = {
  quote: "The team was up and running in a day, and we haven't looked back. It just works.",
  name: "Jordan Ellis",
  role: "Operations Lead",
  avatarSrc: wireframe(200, 200),
  layout: "centered",
  tone: "light",
};

export const Centered: Story = { args: { ...base } };
export const Accent: Story = { args: { ...base, layout: "large", tone: "accent" } };
