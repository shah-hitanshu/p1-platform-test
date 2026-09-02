import "./timeline.css";

export interface TimelineItem {
  date: string;
  title: string;
  body: string;
}
export interface TimelineProps {
  eyebrow: string;
  heading: string;
  layout: "vertical" | "alternating";
  tone: "white" | "light";
  items: TimelineItem[];
}

function TimelineContent({ it }: { it: TimelineItem }) {
  return (
    <div className="p1-timeline__content">
      <div className="p1-timeline__date">{it.date}</div>
      <h3 className="p1-timeline__item-title">{it.title}</h3>
      <p className="p1-timeline__item-body">{it.body}</p>
    </div>
  );
}

export function TimelineRender({ eyebrow, heading, layout, tone, items }: TimelineProps) {
  const list = items || [];
  return (
    <div className="p1-timeline p1-block" data-tone={tone} data-layout={layout}>
      <div className="p1-timeline__inner">
        <div className="p1-timeline__header">
          {eyebrow && <p className="p1-timeline__eyebrow">{eyebrow}</p>}
          {heading && <h2 className="p1-timeline__heading">{heading}</h2>}
        </div>
        <div className="p1-timeline__track">
          {list.map((it, i) => (
            <div
              key={i}
              className="p1-timeline__item"
              data-side={i % 2 === 0 ? "left" : "right"}
            >
              <div className="p1-timeline__dot" aria-hidden="true" />
              <TimelineContent it={it} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
