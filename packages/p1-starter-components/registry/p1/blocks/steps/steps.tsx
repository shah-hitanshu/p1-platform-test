import "./steps.css";

export interface StepItem {
  title: string;
  body: string;
}
export interface StepsProps {
  eyebrow: string;
  heading: string;
  items: StepItem[];
  tone: "white" | "light" | "dark";
}

export function StepsRender({ eyebrow, heading, items, tone }: StepsProps) {
  const list = items || [];
  const cols = Math.min(4, Math.max(1, list.length));
  return (
    <div className="p1-steps p1-block" data-tone={tone}>
      <div className="p1-steps__inner">
        <div className="p1-steps__header">
          {eyebrow && <p className="p1-steps__eyebrow">{eyebrow}</p>}
          {heading && <h2 className="p1-steps__heading">{heading}</h2>}
        </div>
        <div
          className="p1-steps__grid"
          style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
        >
          {list.map((it, i) => (
            <div key={i} className="p1-steps__item">
              <div className="p1-steps__number" aria-hidden="true">{i + 1}</div>
              <h3 className="p1-steps__item-title">{it.title}</h3>
              <p className="p1-steps__item-body">{it.body}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
