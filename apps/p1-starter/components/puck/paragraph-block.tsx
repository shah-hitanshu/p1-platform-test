"use client";
import { type ReactNode, isValidElement } from "react";
import { richtextField } from "@pantheon-systems/puck-css/fields";
import { sanitizeRichtextHtml } from "@pantheon-systems/puck-css/sanitize-richtext";
import { blockPaddingClass } from "./block-padding";
import { ParagraphEditorText } from "./paragraph-editor-text";

export const paragraphBlock = {
  label: "Paragraph",
  fields: {
    text: richtextField,
  },
  defaultProps: {
    text: "Add your copy here. You can use multiple lines.",
  },
  render: ({ text, id }: { text?: string | ReactNode; id: string }) => {
    if (isValidElement(text)) {
      return (
        <div className={blockPaddingClass}>
          <ParagraphEditorText text={text} id={id} />
        </div>
      );
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
