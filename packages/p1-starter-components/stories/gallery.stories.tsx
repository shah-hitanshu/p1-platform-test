import type { Meta, StoryObj } from "@storybook/react";
import { GalleryBlock, type GalleryProps } from "@/registry/p1/blocks/gallery/gallery.block";

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
  { src: "https://images.unsplash.com/photo-1522202176988-66273c2fd55f?w=800&q=80", caption: "Team offsite" },
  { src: "https://images.unsplash.com/photo-1531482615713-2afd69097998?w=800&q=80", caption: "Workshop" },
  { src: "https://images.unsplash.com/photo-1517245386807-bb43f82c33c4?w=800&q=80", caption: "Launch day" },
  { src: "https://images.unsplash.com/photo-1542744173-8e7e53415bb0?w=800&q=80", caption: "Planning" },
  { src: "https://images.unsplash.com/photo-1556761175-5973dc0f32e7?w=800&q=80", caption: "Standup" },
  { src: "https://images.unsplash.com/photo-1551836022-deb4988cc6c0?w=800&q=80", caption: "Ship it" },
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
