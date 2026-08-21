import type { Meta, StoryObj } from "@storybook/react";
import { ColumnsBlock, type ColumnsProps } from "@/registry/p1/blocks/columns/columns.block";

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
    <div style={{ borderRadius: "0.75rem", border: "1px solid var(--p1-border)", background: "var(--p1-surface-default)", padding: "1.5rem" }}>
      <h3 style={{ marginBlockEnd: "0.5rem", fontSize: "1.25rem", fontWeight: 700, color: "var(--p1-fg-default)" }}>{title}</h3>
      <p style={{ lineHeight: 1.6, color: "var(--p1-fg-muted)" }}>{body}</p>
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
