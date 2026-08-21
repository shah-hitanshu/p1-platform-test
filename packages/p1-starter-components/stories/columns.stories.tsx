import type { Meta, StoryObj } from "@storybook/react";
import { ColumnsBlock, type ColumnsProps } from "@/registry/p1/blocks/columns/columns";

const ColumnsWrapper = (props: ColumnsProps) => {
  const Component = ColumnsBlock.render as unknown as React.FC<ColumnsProps>;
  return <Component {...props} />;
};

const meta = {
  title: "Layout/ColumnsBlock",
  component: ColumnsWrapper,
  parameters: { layout: "fullwidth" },
  tags: ["autodocs"],
  argTypes: {
    distribution: { control: "select", options: ["1:1", "2:1", "1:2", "1:1:1", "1:1:1:1"] },
    gap: { control: "select", options: ["tight", "regular", "wide"] },
    valign: { control: "select", options: ["top", "center", "stretch"] },
    tone: { control: "radio", options: ["none", "light"] },
  },
} satisfies Meta<typeof ColumnsWrapper>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * In the Puck editor each `col*` is a real DropZone you fill with blocks.
 * Storybook can't host the editor, so these stories pass sample render
 * functions to preview the layout. Empty slots render a dashed placeholder.
 */
const Card = (title: string, body: string) =>
  (() => (
    <div className="rounded-p1-lg border border-p1-border bg-p1-bg-default p-p1-lg">
      <h3 className="mb-p1-sm text-xl font-bold text-p1-text">{title}</h3>
      <p className="leading-relaxed text-p1-text-muted">{body}</p>
    </div>
  )) as unknown as ColumnsProps["col1"];

const empty = [] as unknown as ColumnsProps["col1"];

export const Two: Story = {
  args: {
    distribution: "1:1",
    gap: "regular",
    valign: "top",
    tone: "none",
    col1: Card("Develop", "Branch every change into its own Multidev environment."),
    col2: Card("Launch", "Deploy to Live in seconds — and roll back just as fast."),
    col3: empty,
    col4: empty,
  },
};

export const Three: Story = {
  args: {
    distribution: "1:1:1",
    gap: "regular",
    valign: "stretch",
    tone: "light",
    col1: Card("Plan", "Start from a template or a blank page."),
    col2: Card("Build", "Compose your page from ready-made blocks."),
    col3: Card("Publish", "Preview your changes, then go live in a click."),
    col4: empty,
  },
};

export const EmptySlots: Story = {
  args: {
    distribution: "2:1",
    gap: "regular",
    valign: "top",
    tone: "none",
    col1: empty,
    col2: empty,
    col3: empty,
    col4: empty,
  },
};
