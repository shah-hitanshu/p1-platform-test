import "./paragraph.css";
import { RichValue } from "@/registry/p1/internal/rich";

export interface ParagraphProps {
  text: unknown;
  style: "body" | "lead";
  size: "small" | "regular" | "large";
  align: "left" | "center";
}

export function Paragraph({ text, style, size, align }: ParagraphProps) {
  return (
    <div className="p1-paragraph p1-block" data-style={style} data-size={size} data-align={align}>
      <RichValue value={text} className="p1-paragraph__body" />
    </div>
  );
}
