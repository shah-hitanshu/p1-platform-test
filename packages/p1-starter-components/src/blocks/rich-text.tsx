import type { ComponentConfig } from "@puckeditor/core";
import { RichValue, RICH_PROSE } from "../internal/rich";

export interface RichTextProps {
  content: string;
  measure: "narrow" | "standard" | "wide";
  size: "regular" | "large";
  dropCap: "off" | "on";
}

const MEASURE: Record<RichTextProps["measure"], string> = {
  narrow: "max-w-[39rem]",
  standard: "max-w-[45rem]",
  wide: "max-w-[54rem]",
};

const DROP_CAP =
  "[&>p:first-of-type]:first-letter:float-left [&>p:first-of-type]:first-letter:mr-2 " +
  "[&>p:first-of-type]:first-letter:font-serif [&>p:first-of-type]:first-letter:text-6xl " +
  "[&>p:first-of-type]:first-letter:font-bold [&>p:first-of-type]:first-letter:leading-[0.8] " +
  "[&>p:first-of-type]:first-letter:text-p1-primary";

export const RichTextBlock: ComponentConfig<RichTextProps> = {
  fields: {
    // Native Puck rich text — inline-editable on the canvas (bold / italic /
    // headings / lists / links), hidden from the sidebar.
    content: { type: "richtext", contentEditable: true, visible: false },
    measure: {
      type: "select",
      options: [
        { label: "Narrow", value: "narrow" },
        { label: "Standard", value: "standard" },
        { label: "Wide", value: "wide" },
      ],
    },
    size: {
      type: "radio",
      options: [
        { label: "Regular", value: "regular" },
        { label: "Large", value: "large" },
      ],
    },
    dropCap: {
      type: "radio",
      options: [
        { label: "Off", value: "off" },
        { label: "On", value: "on" },
      ],
    },
  },
  defaultProps: {
    content:
      "<p>A year ago, shipping a change meant a ticket, a queue, and a wait. Today it takes minutes — and the difference wasn't a single tool.</p>" +
      "<h2>It started with previews</h2>" +
      "<p>Every change got a shareable link before it went live. Reviewers stopped guessing and <mark>started seeing</mark>.</p>" +
      "<ul><li>Fewer round-trips between teams</li><li>Marketers unblocked from engineering</li><li>Confidence to publish on a Friday</li></ul>" +
      "<h3>The habit that stuck</h3>" +
      "<p>We made \"preview first\" the default, not the exception. Small change, large compounding effect.</p>" +
      "<blockquote>The best workflow is the one your whole team actually uses.</blockquote>",
    measure: "standard",
    size: "regular",
    dropCap: "off",
  },
  render: ({ content, measure, size, dropCap }) => (
    <div className={`mx-auto px-p1-lg py-p1-sm ${MEASURE[measure]}`}>
      <RichValue
        value={content}
        className={`${RICH_PROSE} ${size === "large" ? "text-lg [&_p]:text-lg [&_li]:text-lg md:text-xl" : ""} ${
          dropCap === "on" ? DROP_CAP : ""
        }`}
      />
    </div>
  ),
};
