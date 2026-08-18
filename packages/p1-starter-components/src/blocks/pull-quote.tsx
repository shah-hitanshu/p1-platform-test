import type { ComponentConfig } from "@puckeditor/core";
import { RichValue } from "../internal/rich";

export interface PullQuoteProps {
  quote: string;
  cite: string;
  accent: "yellow rule" | "quote mark" | "none";
  align: "center" | "left";
}

const PQ_INNER =
  "[&>*:first-child]:mt-0 [&>*:last-child]:mb-0 [&_p]:m-0 " +
  "[&_strong]:font-bold [&_em]:italic [&_mark]:rounded-sm [&_mark]:bg-p1-warning/40 [&_mark]:px-0.5 [&_a]:underline";

export const PullQuoteBlock: ComponentConfig<PullQuoteProps> = {
  fields: {
    quote: { type: "richtext", contentEditable: true, visible: false },
    cite: { type: "text", contentEditable: true, visible: false },
    accent: {
      type: "select",
      options: [
        { label: "Yellow rule", value: "yellow rule" },
        { label: "Quote mark", value: "quote mark" },
        { label: "None", value: "none" },
      ],
    },
    align: {
      type: "radio",
      options: [
        { label: "Center", value: "center" },
        { label: "Left", value: "left" },
      ],
    },
  },
  defaultProps: {
    quote:
      "The best workflow is the one your whole team <mark>actually uses</mark> — not the one that looks impressive in a diagram.",
    cite: "Jordan Ellis, Operations Lead",
    accent: "yellow rule",
    align: "center",
  },
  render: ({ quote, cite, accent, align }) => {
    const center = align !== "left";
    return (
      <div className="mx-auto max-w-4xl px-p1-lg py-p1-xl">
        <blockquote className={center ? "text-center" : "text-left"}>
          {accent === "yellow rule" && (
            <div className={`mb-p1-lg h-1.5 w-16 rounded-full bg-p1-warning ${center ? "mx-auto" : ""}`} />
          )}
          {accent === "quote mark" && (
            <div
              className={`font-serif text-7xl font-extrabold leading-[0.5] text-p1-primary/30 ${
                center ? "mx-auto" : ""
              }`}
            >
              “
            </div>
          )}
          <div className={`mb-p1-md font-serif text-3xl font-medium italic leading-tight text-balance text-p1-text md:text-4xl ${center ? "" : ""}`}>
            <RichValue value={quote} className={PQ_INNER} />
          </div>
          {cite && (
            <cite className="font-semibold not-italic tracking-wide text-p1-primary">— {cite}</cite>
          )}
        </blockquote>
      </div>
    );
  },
};
