import type { ComponentConfig } from "@puckeditor/core";
import { RichValue } from "../internal/rich";

export interface QuoteProps {
  quote: string;
  attribution: string;
  scale: "standard" | "display";
}

// Inner rich HTML inherits the big serif/italic styling from the container;
// strip default paragraph margins and keep emphasis on-brand.
const QUOTE_INNER =
  "[&>*:first-child]:mt-0 [&>*:last-child]:mb-0 [&_p]:m-0 " +
  "[&_strong]:font-bold [&_em]:italic [&_mark]:rounded-sm [&_mark]:bg-p1-warning/40 [&_mark]:px-0.5 [&_a]:underline";

export const QuoteBlock: ComponentConfig<QuoteProps> = {
  fields: {
    // Inline rich text on the canvas (bold a phrase, highlight, etc.).
    quote: { type: "richtext", contentEditable: true, visible: false },
    attribution: { type: "text", contentEditable: true, visible: false },
    scale: {
      type: "radio",
      options: [
        { label: "Standard", value: "standard" },
        { label: "Display", value: "display" },
      ],
    },
  },
  defaultProps: {
    quote:
      "Switching over was the easiest call we made all year — <mark>our team ships in hours, not weeks</mark> now.",
    attribution: "Jordan Ellis, Operations Lead",
    scale: "standard",
  },
  render: ({ quote, attribution, scale }) => {
    if (scale === "display") {
      return (
        <div className="mx-auto max-w-6xl px-p1-lg py-p1-xl">
          <blockquote className="mx-auto max-w-3xl text-center">
            <div className="mb-p1-md font-serif text-3xl font-medium italic leading-snug text-balance text-p1-text md:text-4xl">
              <RichValue value={quote} className={QUOTE_INNER} />
            </div>
            <cite className="font-semibold not-italic text-p1-primary">— {attribution}</cite>
          </blockquote>
        </div>
      );
    }
    return (
      <div className="mx-auto max-w-6xl px-p1-lg py-p1-lg">
        <blockquote className="border-l-4 border-p1-warning pl-p1-lg">
          <div className="mb-p1-sm font-serif text-2xl font-medium italic leading-snug text-balance text-p1-text">
            <RichValue value={quote} className={QUOTE_INNER} />
          </div>
          <cite className="font-semibold not-italic text-p1-primary">— {attribution}</cite>
        </blockquote>
      </div>
    );
  },
};
