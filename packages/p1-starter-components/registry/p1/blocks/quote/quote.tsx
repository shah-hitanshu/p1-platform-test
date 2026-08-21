import "./quote.css";
import { RichValue } from "@/registry/p1/internal/rich";

export interface QuoteProps {
  quote: unknown;
  attribution: string;
  scale: "standard" | "display";
}

export function Quote({ quote, attribution, scale }: QuoteProps) {
  return (
    <div className="p1-quote p1-block" data-scale={scale}>
      <blockquote className="p1-quote__blockquote">
        <RichValue value={quote} className="p1-quote__text" />
        <cite className="p1-quote__cite">— {attribution}</cite>
      </blockquote>
    </div>
  );
}
