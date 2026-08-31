import type { Meta, StoryObj } from "@storybook/react";
import { GalleryBlock, type GalleryProps } from "@/registry/p1/blocks/gallery/gallery.block";
import { wireframe } from '@/registry/p1/internal/define-meta';

const GalleryWrapper = (props: GalleryProps) => {
  const Component = GalleryBlock.render as React.FC<GalleryProps>;
  return <Component {...props} />;
};

const meta = {
  title: "Showcase/GalleryBlock",
  component: GalleryWrapper,
  parameters: { layout: "fullwidth" },
  tags: ["autodocs"],
  argTypes: {
    layout: { control: "select", options: ["grid", "masonry", "filmstrip", "carousel"] },
    columns: { control: "select", options: ["2", "3", "4"] },
    gap: { control: "select", options: ["tight", "regular", "wide"] },
    ratio: { control: "select", options: ["1 / 1", "4 / 3", "3 / 2", "16 / 9"] },
    radius: { control: "select", options: ["none", "soft", "round"] },
    captions: { control: "radio", options: ["off", "on"] },
  },
} satisfies Meta<typeof GalleryWrapper>;

export default meta;
type Story = StoryObj<typeof meta>;

const images = [
  { src: wireframe(800, 600), caption: "Team offsite" },
  { src: wireframe(800, 600), caption: "Workshop" },
  { src: wireframe(800, 600), caption: "Launch day" },
  { src: wireframe(800, 600), caption: "Planning" },
  { src: wireframe(800, 600), caption: "Standup" },
  { src: wireframe(800, 600), caption: "Ship it" },
];

const base: GalleryProps = {
  heading: "From the field",
  layout: "grid",
  columns: "3",
  gap: "regular",
  ratio: "4 / 3",
  radius: "soft",
  captions: "off",
  images,
};

export const Grid: Story = { args: { ...base } };
export const Masonry: Story = { args: { ...base, layout: "masonry" } };
export const Carousel: Story = { args: { ...base, layout: "carousel", captions: "on" } };
export const Filmstrip: Story = { args: { ...base, layout: "filmstrip", captions: "on" } };
