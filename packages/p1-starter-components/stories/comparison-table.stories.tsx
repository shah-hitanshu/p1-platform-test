import type { Meta, StoryObj } from "@storybook/react";
import { ComparisonTableBlock, type ComparisonTableProps } from "@/registry/p1/blocks/comparison-table/comparison-table.block";

const ComparisonTableWrapper = (props: ComparisonTableProps) => {
  const Component = ComparisonTableBlock.render as React.FC<ComparisonTableProps>;
  return <Component {...props} />;
};

const meta = {
  title: "Convert/ComparisonTableBlock",
  component: ComparisonTableWrapper,
  parameters: { layout: "fullwidth" },
  tags: ["autodocs"],
  argTypes: { featured: { control: "select", options: ["none", "1", "2", "3", "4"] } },
} satisfies Meta<typeof ComparisonTableWrapper>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    eyebrow: "Compare",
    heading: "Find the plan that fits.",
    subtitle: "Every plan includes the core WebOps workflow.",
    columns: "Starter\nTeam\nEnterprise",
    featured: "2",
    rows: [
      { feature: "Projects", c1: "1", c2: "10", c3: "Unlimited", c4: "" },
      { feature: "Multidev environments", c1: "no", c2: "yes", c3: "yes", c4: "" },
      { feature: "Role-based access", c1: "no", c2: "yes", c3: "yes", c4: "" },
      { feature: "SSO & audit logs", c1: "no", c2: "no", c3: "yes", c4: "" },
      { feature: "Support", c1: "Community", c2: "Priority", c3: "Dedicated CSM", c4: "" },
    ],
  },
};
