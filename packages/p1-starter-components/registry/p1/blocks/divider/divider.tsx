import "./divider.css";

export interface DividerProps {
  style: "solid" | "dashed" | "dots";
  spacing: "small" | "medium" | "large";
}

export function Divider({ style, spacing }: DividerProps) {
  return (
    <div className="p1-divider" data-style={style} data-spacing={spacing}>
      {style === "dots" ? (
        <div className="p1-divider__dots">
          {[0, 1, 2].map((i) => (
            <span key={i} className="p1-divider__dot" />
          ))}
        </div>
      ) : (
        <hr className="p1-divider__rule" />
      )}
    </div>
  );
}
