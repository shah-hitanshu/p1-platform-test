import { blockPaddingClass } from "./block-padding";

export const quoteBlock = {
  label: "Quote",
  fields: {
    quote: { type: "textarea" as const, label: "Quote" },
    attribution: { type: "text" as const, label: "Attribution" },
  },
  defaultProps: {
    quote: "A short quotation goes here.",
    attribution: "",
  },
  render: ({ quote, attribution }: { quote?: string; attribution?: string }) => (
    <blockquote
      className={`m-0 max-w-prose border-l-4 border-neutral-300 pl-6 ${blockPaddingClass}`}
    >
      <p className="m-0 text-lg italic leading-relaxed">{quote}</p>
      {attribution ? (
        <footer className="mt-3 text-base text-neutral-600">— {attribution}</footer>
      ) : null}
    </blockquote>
  ),
};
