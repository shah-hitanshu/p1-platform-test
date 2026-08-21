import "./list.css";

export interface ListProps {
  items: { text: string }[];
  style: "bullet" | "numbered" | "check";
}

export function List({ items, style }: ListProps) {
  const Tag = style === "numbered" ? "ol" : "ul";
  return (
    <div className="p1-list p1-block" data-style={style}>
      <Tag className="p1-list__items">
        {items.map((item, i) => (
          <li key={i} className="p1-list__item">
            <span className="p1-list__marker" aria-hidden="true" />
            <span className="p1-list__text">{item.text}</span>
          </li>
        ))}
      </Tag>
    </div>
  );
}
