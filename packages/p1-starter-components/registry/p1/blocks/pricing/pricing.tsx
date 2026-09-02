import type { ComponentConfig } from "@puckeditor/core";
import { Btn } from "@/registry/p1/internal/btn";
import { Icon } from "@/registry/p1/internal/icons";

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

export const PricingBlock: ComponentConfig<PricingProps> = {
  fields: {
    eyebrow: { type: "text", contentEditable: true, visible: false },
    heading: { type: "text", contentEditable: true, visible: false },
    subtitle: { type: "text", contentEditable: true, visible: false },
    tiers: {
      type: "array",
      arrayFields: {
        name: { type: "text", contentEditable: true, visible: false },
        price: { type: "text", contentEditable: true, visible: false },
        period: { type: "text", contentEditable: true, visible: false },
        features: { type: "textarea" },
        buttonLabel: { type: "text", contentEditable: true, visible: false },
        featured: {
          type: "radio",
          options: [
            { label: "Off", value: "off" },
            { label: "On", value: "on" },
          ],
        },
      },
      defaultItemProps: { name: "Plan", price: "$0", period: "/mo", features: "Feature one\nFeature two", buttonLabel: "Choose plan", featured: "off" },
      getItemSummary: (item) => item.name || "Tier",
    },
  },
  defaultProps: {
    eyebrow: "Pricing",
    heading: "Plans that scale with your portfolio.",
    subtitle: "Start free. Upgrade when your team is ready.",
    tiers: [
      { name: "Starter", price: "$0", period: "/mo", features: "1 project\nCore features\nCommunity support", buttonLabel: "Start free", featured: "off" },
      { name: "Team", price: "$49", period: "/mo", features: "Up to 10 projects\nAdvanced features\nRole-based access\nPriority support", buttonLabel: "Start free trial", featured: "on" },
      { name: "Enterprise", price: "Custom", period: "", features: "Unlimited sites\nBulk updates\nSSO & audit logs\nDedicated CSM", buttonLabel: "Contact sales", featured: "off" },
    ],
  },
  render: ({ eyebrow, heading, subtitle, tiers }) => {
    const cols = Math.min(4, Math.max(1, (tiers || []).length));
    return (
      <div className="bg-p1-bg-light px-p1-lg py-p1-xl">
        <div className="mx-auto max-w-7xl">
          <div className="mb-p1-xl text-center">
            {eyebrow && <p className="mb-p1-sm font-serif text-xl italic text-p1-primary">{eyebrow}</p>}
            {heading && <h2 className="text-3xl font-bold tracking-tight text-p1-text md:text-4xl">{heading}</h2>}
            {subtitle && <p className="mt-p1-sm text-p1-text-muted">{subtitle}</p>}
          </div>
          <div className="grid grid-cols-1 items-start gap-p1-md" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0,1fr))` }}>
            {(tiers || []).map((tier, i) => {
              const hot = tier.featured === "on";
              return (
                <div
                  key={i}
                  className={`relative rounded-p1-lg p-p1-lg ${
                    hot ? "-translate-y-2 bg-p1-primary text-white shadow-xl" : "border border-p1-border bg-p1-bg-default text-p1-text shadow-sm"
                  }`}
                >
                  {hot && (
                    <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-p1-warning px-p1-sm py-0.5 text-[10px] font-bold uppercase tracking-[0.08em] text-p1-text">
                      Most popular
                    </span>
                  )}
                  <div className="text-base font-bold">{tier.name}</div>
                  <div className="mb-p1-md mt-p1-sm flex items-baseline gap-1">
                    <span className="text-4xl font-extrabold tracking-tight">{tier.price}</span>
                    {tier.period && <span className="text-sm opacity-70">{tier.period}</span>}
                  </div>
                  <ul className="m-0 mb-p1-lg flex list-none flex-col gap-p1-sm p-0">
                    {splitLines(tier.features).map((f, j) => (
                      <li key={j} className="flex items-start gap-p1-sm text-sm">
                        <Icon name="check" strokeWidth={3} className={`mt-0.5 h-4 w-4 flex-none ${hot ? "text-p1-warning" : "text-p1-success"}`} />
                        <span className={hot ? "text-white/90" : "text-p1-text-muted"}>{f}</span>
                      </li>
                    ))}
                  </ul>
                  <Btn variant={hot ? "yellow" : "secondary"} className="w-full justify-center">
                    {tier.buttonLabel}
                  </Btn>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  },
};
