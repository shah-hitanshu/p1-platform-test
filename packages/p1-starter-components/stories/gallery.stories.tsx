import type { Meta, StoryObj } from "@storybook/react";
import { GalleryBlock, type GalleryProps } from "@/registry/p1/blocks/gallery/gallery.block";
import { P1_ASSETS } from '@/registry/p1/internal/assets';

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
  { src: P1_ASSETS.LANDSCAPE, caption: "Team offsite" },
  { src: P1_ASSETS.LANDSCAPE, caption: "Workshop" },
  { src: P1_ASSETS.LANDSCAPE, caption: "Launch day" },
  { src: P1_ASSETS.LANDSCAPE, caption: "Planning" },
  { src: P1_ASSETS.LANDSCAPE, caption: "Standup" },
  { src: P1_ASSETS.LANDSCAPE, caption: "Ship it" },
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
