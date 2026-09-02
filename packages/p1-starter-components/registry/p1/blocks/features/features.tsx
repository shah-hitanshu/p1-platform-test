import "./features.css";

export interface FeatureCard {
  eyebrow: string;
  title: string;
  body: string;
}
export interface FeatureCardsProps {
  subtitle: string;
  heading: string;
  cards: FeatureCard[];
  columns: "2" | "3" | "4";
  colorScheme: "brand mix" | "light" | "purple" | "dark" | "outline";
  corners: "sharp" | "soft" | "round";
  depth: "flat" | "subtle" | "raised";
  cardAlign: "left" | "center";
  sectionBg: "light" | "white" | "dark" | "none";
}

function cardScheme(colorScheme: FeatureCardsProps["colorScheme"], i: number): string {
  if (colorScheme === "brand mix") {
    const cycle: string[] = ["primary", "light", "dark"];
    return cycle[i % 3] ?? "light";
  }
  if (colorScheme === "purple") return "primary";
  return colorScheme;
}

export function FeatureCardsRender({
  subtitle,
  heading,
  cards,
  columns,
  colorScheme,
  corners,
  depth,
  cardAlign,
  sectionBg,
}: FeatureCardsProps) {
  const list = cards || [];
  const cols = Math.min(Number(columns) || 3, list.length || 1);
  return (
    <div className="p1-feature-cards p1-block" data-bg={sectionBg} data-align={cardAlign}>
      <div className="p1-feature-cards__inner">
        {(subtitle || heading) && (
          <div className="p1-feature-cards__header">
            {subtitle && <p className="p1-feature-cards__subtitle" data-bg={sectionBg}>{subtitle}</p>}
            {heading && <h2 className="p1-feature-cards__heading">{heading}</h2>}
          </div>
        )}
        <div
          className="p1-feature-cards__grid"
          style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
        >
          {list.map((c, i) => (
            <div
              key={i}
              className="p1-feature-cards__card"
              data-scheme={cardScheme(colorScheme, i)}
              data-corners={corners}
              data-depth={depth}
            >
              {c.eyebrow && <div className="p1-feature-cards__eyebrow">{c.eyebrow}</div>}
              <h3 className="p1-feature-cards__card-title">{c.title}</h3>
              <p className="p1-feature-cards__card-body">{c.body}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
