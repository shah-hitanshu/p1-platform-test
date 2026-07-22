"use client";
import { type ReactNode, isValidElement } from "react";
import { richtextField } from "@pantheon-systems/puck-css/fields";
import { blockPaddingClass } from "./block-padding";
import { sanitizeRichtextHtml } from "./sanitize-richtext";

export const paragraphBlock = {
  label: "Paragraph",
  fields: {
    text: richtextField,
  },
  defaultProps: {
    text: "Add your copy here. You can use multiple lines.",
  },
  render: ({ text }: { text?: string | ReactNode }) => {
    if (isValidElement(text)) {
      return <div className={blockPaddingClass}>{text}</div>;
    }
    return (
      <div
        className={`${blockPaddingClass} prose max-w-prose`}
        dangerouslySetInnerHTML={{
          __html: typeof text === "string" ? sanitizeRichtextHtml(text) : "",
        }}
      />
    );
  },
};
