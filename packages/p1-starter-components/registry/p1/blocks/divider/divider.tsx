import type { ComponentConfig } from "@puckeditor/core";

export interface DividerProps {
  style: "solid" | "dashed" | "dots";
  spacing: "small" | "medium" | "large";
}

const PAD: Record<DividerProps["spacing"], string> = {
  small: "py-p1-sm",
  medium: "py-p1-lg",
  large: "py-p1-xl",
};

export const DividerBlock: ComponentConfig<DividerProps> = {
  fields: {
    style: {
      type: "select",
      options: [
        { label: "Solid", value: "solid" },
        { label: "Dashed", value: "dashed" },
        { label: "Dots", value: "dots" },
      ],
    },
    spacing: {
      type: "select",
      options: [
        { label: "Small", value: "small" },
        { label: "Medium", value: "medium" },
        { label: "Large", value: "large" },
      ],
    },
  },
  defaultProps: { style: "solid", spacing: "medium" },
  render: ({ style, spacing }) => (
    <div className={`mx-auto max-w-6xl px-p1-lg ${PAD[spacing]}`}>
      {style === "dots" ? (
        <div className="flex justify-center gap-2.5">
          {[0, 1, 2].map((i) => (
            <span key={i} className="h-1.5 w-1.5 rounded-full bg-p1-border" />
          ))}
        </div>
      ) : (
        <hr className={`m-0 border-0 border-t border-p1-border ${style === "dashed" ? "border-dashed border-t-2" : ""}`} />
      )}
    </div>
  ),
};
