import "./stats.css";

export interface StatItem {
  value: string;
  label: string;
}
export interface StatsProps {
  tone: "light" | "dark";
  items: StatItem[];
}

export function StatsRender({ tone, items }: StatsProps) {
  const list = items || [];
  const cols = Math.min(4, list.length || 1);
  return (
    <div className="p1-stats p1-block" data-tone={tone}>
      <div
        className="p1-stats__grid"
        style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
      >
        {list.map((it, i) => (
          <div key={i} className="p1-stats__item">
            <div className="p1-stats__value">{it.value}</div>
            <div className="p1-stats__label">{it.label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
