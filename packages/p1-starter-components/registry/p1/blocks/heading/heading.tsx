import "./heading.css";

export interface HeadingProps {
  text: string;
  level: "H1" | "H2" | "H3" | "H4";
  align: "left" | "center";
}

export function Heading({ text, level, align }: HeadingProps) {
  const Tag = level.toLowerCase() as "h1" | "h2" | "h3" | "h4";
  return (
    <div className="p1-heading p1-block" data-level={level} data-align={align}>
      <Tag className="p1-heading__text">{text}</Tag>
    </div>
  );
}
