import { RichValue } from "@/registry/p1/internal/rich";
import "./rich-text.css";

export interface RichTextProps {
  content: string;
  measure: "narrow" | "standard" | "wide";
  size: "regular" | "large";
  dropCap: "off" | "on";
}

export function RichTextRender({ content, measure, size, dropCap }: RichTextProps) {
  return (
    <div
      className="p1-rich-text p1-block"
      data-measure={measure}
      data-size={size}
      data-dropcap={dropCap}
    >
      <div className="p1-rich-text__inner">
        <RichValue value={content} />
      </div>
    </div>
  );
}
