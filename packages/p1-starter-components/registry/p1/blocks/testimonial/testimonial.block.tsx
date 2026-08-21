import type { ComponentConfig } from "@puckeditor/core";
import { TestimonialRender, type TestimonialProps } from "./testimonial";
export type { TestimonialProps };

export const TestimonialBlock: ComponentConfig<TestimonialProps> = {
  fields: {
    quote: {
      type: "text" as const,
      contentEditable: true,
      visible: false,
      ai: { instructions: "A genuine-sounding customer quote, 15–35 words. First person." },
    },
    name: {
      type: "text" as const,
      contentEditable: true,
      visible: false,
      ai: { instructions: "Customer's full name." },
    },
    role: {
      type: "text" as const,
      contentEditable: true,
      visible: false,
      ai: { instructions: "Job title and company. E.g. Operations Lead, Acme Corp." },
    },
    avatarSrc: {
      type: "text" as const,
      ai: { exclude: true },
    },
    layout: {
      type: "select" as const,
      options: [
        { label: "Centered", value: "centered" },
        { label: "Card", value: "card" },
        { label: "Large", value: "large" },
      ],
    },
    tone: {
      type: "select" as const,
      options: [
        { label: "Light", value: "light" },
        { label: "White", value: "white" },
        { label: "Purple", value: "purple" },
        { label: "Dark", value: "dark" },
      ],
    },
  },
  defaultProps: {
    quote: "The team was up and running in a day, and we haven't looked back. It just works.",
    name: "Jordan Ellis",
    role: "Operations Lead",
    avatarSrc: "https://images.unsplash.com/photo-1573497019940-1c28c88b4f3e?w=200&q=80",
    layout: "centered",
    tone: "light",
  },
  render: TestimonialRender,
};
