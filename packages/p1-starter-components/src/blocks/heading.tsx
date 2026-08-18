import type { ComponentConfig } from "@puckeditor/core";

export interface HeadingProps {
  text: string;
  level: "H1" | "H2" | "H3" | "H4";
  align: "left" | "center";
}

const SIZES: Record<HeadingProps["level"], string> = {
  H1: "text-4xl md:text-5xl",
  H2: "text-3xl md:text-4xl",
  H3: "text-2xl md:text-3xl",
  H4: "text-xl",
};

export const HeadingBlock: ComponentConfig<HeadingProps> = {
  fields: {
    text: { type: "text", contentEditable: true, visible: false },
    level: {
      type: "select",
      options: [
        { label: "H1", value: "H1" },
        { label: "H2", value: "H2" },
        { label: "H3", value: "H3" },
        { label: "H4", value: "H4" },
      ],
    },
    align: {
      type: "radio",
      options: [
        { label: "Left", value: "left" },
        { label: "Center", value: "center" },
      ],
    },
  },
  defaultProps: { text: "A heading to anchor the section", level: "H2", align: "left" },
  render: ({ text, level, align }) => (
    <div className="mx-auto max-w-6xl px-p1-lg py-p1-md">
      <div
        className={`font-bold leading-tight tracking-tight text-balance text-p1-text ${SIZES[level]} ${
          align === "center" ? "text-center" : "text-left"
        }`}
      >
        {text}
      </div>
    </div>
  ),
};
