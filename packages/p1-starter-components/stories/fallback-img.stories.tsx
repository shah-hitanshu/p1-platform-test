import type { Meta, StoryObj } from "@storybook/react";
import { expect, waitFor, within } from "storybook/test";
import { FallbackImg } from "@/registry/p1/internal/img";
import { wireframe } from "@/registry/p1/internal/define-meta";

const FALLBACK = wireframe(400, 300);
// A second, visibly different data URI standing in for a real photo.
const GOOD = wireframe(400, 300).replace("f1f1f3", "d0e8ff");

const meta = {
  title: "Internal/FallbackImg",
  component: FallbackImg,
  args: { fallback: FALLBACK, alt: "sample", width: 400, height: 300 },
} satisfies Meta<typeof FallbackImg>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Broken: Story = {
  // Port 9 (discard) refuses the connection, so the load fails fast and deterministically.
  args: { src: "http://127.0.0.1:9/missing.jpg" },
  play: async ({ canvasElement }) => {
    const img = await within(canvasElement).findByRole("img");
    await waitFor(() => expect(img.getAttribute("src")).toBe(FALLBACK));
  },
};

export const Valid: Story = {
  args: { src: GOOD },
  play: async ({ canvasElement }) => {
    const img = await within(canvasElement).findByRole("img");
    await waitFor(() =>
      expect(
        (img as HTMLImageElement).complete &&
          (img as HTMLImageElement).naturalWidth > 0,
      ).toBe(true),
    );
    expect(img.getAttribute("src")).toBe(GOOD);
  },
};

export const AlreadyFailed: Story = {
  // Two instances share the same bad src. The browser caches the failed
  // load, so the second <img> is complete===true, naturalWidth===0 at mount —
  // the same state as a server-rendered image that failed before hydration.
  args: { src: "data:image/png;base64,!" },
  render: (args) => (
    <>
      <FallbackImg {...args} />
      <FallbackImg {...args} />
    </>
  ),
  play: async ({ canvasElement }) => {
    const imgs = await within(canvasElement).findAllByRole("img");
    await waitFor(() =>
      imgs.forEach((img) => expect(img.getAttribute("src")).toBe(FALLBACK)),
    );
  },
};
