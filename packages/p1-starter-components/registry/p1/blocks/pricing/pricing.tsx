import { Btn } from "@/registry/p1/internal/btn";
import { Icon } from "@/registry/p1/internal/icons";
import "./pricing.css";

export interface PricingTier {
  name: string;
  price: string;
  period: string;
  features: string;
  buttonLabel: string;
  featured: "off" | "on";
}
export interface PricingProps {
  eyebrow: string;
  heading: string;
  subtitle: string;
  tiers: PricingTier[];
}

const splitLines = (s: string) =>
  String(s || "")
    .split("\n")
    .map((x) => x.trim())
    .filter(Boolean);

export function PricingRender({ eyebrow, heading, subtitle, tiers }: PricingProps) {
  const list = tiers || [];
  const cols = Math.min(4, Math.max(1, list.length));
  return (
    <div className="p1-pricing p1-block">
      <div className="p1-pricing__inner">
        <div className="p1-pricing__header">
          {eyebrow && <p className="p1-pricing__eyebrow">{eyebrow}</p>}
          {heading && <h2 className="p1-pricing__heading">{heading}</h2>}
          {subtitle && <p className="p1-pricing__subtitle">{subtitle}</p>}
        </div>
        <div
          className="p1-pricing__grid"
          style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
        >
          {list.map((tier, i) => {
            const hot = tier.featured === "on";
            return (
              <div key={i} className="p1-pricing__card" data-featured={tier.featured}>
                {hot && (
                  <span className="p1-pricing__badge">Most popular</span>
                )}
                <div className="p1-pricing__tier-name">{tier.name}</div>
                <div className="p1-pricing__price-row">
                  <span className="p1-pricing__price">{tier.price}</span>
                  {tier.period && <span className="p1-pricing__period">{tier.period}</span>}
                </div>
                <ul className="p1-pricing__features">
                  {splitLines(tier.features).map((f, j) => (
                    <li key={j} className="p1-pricing__feature">
                      <Icon name="check" strokeWidth={3} className="p1-pricing__check" />
                      <span className="p1-pricing__feature-text">{f}</span>
                    </li>
                  ))}
                </ul>
                <Btn variant={hot ? "yellow" : "secondary"} className="p1-pricing__btn">
                  {tier.buttonLabel}
                </Btn>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
