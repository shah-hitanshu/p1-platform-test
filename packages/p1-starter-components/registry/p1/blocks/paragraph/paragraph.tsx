import type { ComponentConfig } from "@puckeditor/core";

export interface ParagraphProps {
  text: string;
  style: "body" | "lead";
  size: "small" | "regular" | "large";
  align: "left" | "center";
}

const BODY_SIZES: Record<ParagraphProps["size"], string> = {
  small: "text-sm",
  regular: "text-base md:text-lg",
  large: "text-lg md:text-xl",
};

export const ParagraphBlock: ComponentConfig<ParagraphProps> = {
  fields: {
    text: { type: "textarea", contentEditable: true, visible: false },
    style: {
      type: "radio",
      options: [
        { label: "Body", value: "body" },
        { label: "Lead", value: "lead" },
      ],
    },
    size: {
      type: "select",
      options: [
        { label: "Small", value: "small" },
        { label: "Regular", value: "regular" },
        { label: "Large", value: "large" },
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
  defaultProps: {
    text: "This is a paragraph. Use it to expand on the heading above with a sentence or two of supporting detail — keep it clear, specific, and easy to scan.",
    style: "body",
    size: "regular",
    align: "left",
  },
  render: ({ text, style, size, align }) => {
    const lead = style === "lead";
    return (
      <div className="mx-auto max-w-6xl px-p1-lg py-p1-sm">
        <p
          className={`max-w-prose text-pretty leading-relaxed ${align === "center" ? "mx-auto text-center" : "text-left"} ${
            lead ? "font-serif text-xl md:text-2xl text-p1-text" : `${BODY_SIZES[size]} text-p1-text-muted`
          }`}
        >
          {text}
        </p>
      </div>
    );
  },
};
