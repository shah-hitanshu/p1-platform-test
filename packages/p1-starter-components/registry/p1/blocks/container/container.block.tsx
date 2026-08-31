import type { ComponentConfig } from "@puckeditor/core";
import { defineMeta } from '@/registry/p1/internal/define-meta';
import { ContainerRender, type ContainerProps } from "./container";
export type { ContainerProps };

export const ContainerBlock: ComponentConfig<ContainerProps> = {
  fields: {
    content: { type: "slot" as const },
    tone: {
      type: "select" as const,
      options: [
        { label: "None", value: "none" },
        { label: "Light", value: "light" },
        { label: "White", value: "white" },
      ],
    },
    pad: {
      type: "select" as const,
      options: [
        { label: "Compact", value: "compact" },
        { label: "Regular", value: "regular" },
        { label: "Spacious", value: "spacious" },
      ],
    },
    maxWidth: {
      type: "select" as const,
      options: [
        { label: "Narrow", value: "narrow" },
        { label: "Standard", value: "standard" },
        { label: "Wide", value: "wide" },
        { label: "Full", value: "full" },
      ],
    },
    align: {
      type: "radio" as const,
      options: [
        { label: "Left", value: "left" },
        { label: "Center", value: "center" },
      ],
    },
    radius: {
      type: "select" as const,
      options: [
        { label: "None", value: "none" },
        { label: "Soft", value: "soft" },
        { label: "Round", value: "round" },
      ],
    },
  },
  defaultProps: {
    content: [],
    tone: "light",
    pad: "regular",
    maxWidth: "standard",
    align: "left",
    radius: "soft",
  },
  render: ContainerRender as unknown as ComponentConfig<ContainerProps>["render"],
};

export const meta = defineMeta({
  title: 'Container',
  description: 'Constrained-width wrapper slot with tone, padding, radius, and max-width controls; use to scope and style groups of nested blocks.',
  categories: ["layout"],
  published: true,
});
