import type { ComponentConfig } from "@puckeditor/core";

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

interface CardStyle {
  wrap: string;
  title: string;
  body: string;
  sub: string;
}
const MIX: readonly [CardStyle, CardStyle, CardStyle] = [
  { wrap: "bg-p1-primary", title: "text-white", body: "text-white/90", sub: "text-p1-warning" },
  { wrap: "bg-white border border-p1-border", title: "text-p1-text", body: "text-p1-text-muted", sub: "text-p1-primary" },
  { wrap: "bg-gray-900", title: "text-white", body: "text-white/85", sub: "text-p1-warning" },
];
function schemeFor(scheme: FeatureCardsProps["colorScheme"], i: number): CardStyle {
  switch (scheme) {
    case "brand mix":
      switch (i % 3) {
        case 0:
          return MIX[0];
        case 1:
          return MIX[1];
        default:
          return MIX[2];
      }
    case "purple":
      return { wrap: "bg-p1-primary", title: "text-white", body: "text-white/90", sub: "text-p1-warning" };
    case "dark":
      return { wrap: "bg-gray-900", title: "text-white", body: "text-white/85", sub: "text-p1-warning" };
    case "outline":
      return { wrap: "bg-transparent border-[1.5px] border-gray-300", title: "text-p1-text", body: "text-p1-text-muted", sub: "text-p1-primary" };
    default:
      return { wrap: "bg-white border border-p1-border", title: "text-p1-text", body: "text-p1-text-muted", sub: "text-p1-primary" };
  }
}
const CORNERS: Record<FeatureCardsProps["corners"], string> = { sharp: "rounded-lg", soft: "rounded-2xl", round: "rounded-3xl" };
const DEPTH: Record<FeatureCardsProps["depth"], string> = { flat: "", subtle: "shadow-md", raised: "shadow-xl" };
const SECTION_BG: Record<FeatureCardsProps["sectionBg"], string> = {
  light: "bg-p1-bg-light",
  white: "bg-white",
  dark: "bg-gray-900",
  none: "bg-transparent",
};

export const FeatureCardsBlock: ComponentConfig<FeatureCardsProps> = {
  fields: {
    subtitle: { type: "text", contentEditable: true, visible: false },
    heading: { type: "text", contentEditable: true, visible: false },
    cards: {
      type: "array",
      arrayFields: { eyebrow: { type: "text", contentEditable: true, visible: false }, title: { type: "text", contentEditable: true, visible: false }, body: { type: "textarea", contentEditable: true, visible: false } },
      defaultItemProps: { eyebrow: "Eyebrow", title: "Feature", body: "Describe the feature." },
      getItemSummary: (item) => item.title || "Card",
    },
    columns: {
      type: "select",
      options: [
        { label: "2", value: "2" },
        { label: "3", value: "3" },
        { label: "4", value: "4" },
      ],
    },
    colorScheme: {
      type: "select",
      options: [
        { label: "Brand mix", value: "brand mix" },
        { label: "Light", value: "light" },
        { label: "Purple", value: "purple" },
        { label: "Dark", value: "dark" },
        { label: "Outline", value: "outline" },
      ],
    },
    corners: {
      type: "select",
      options: [
        { label: "Sharp", value: "sharp" },
        { label: "Soft", value: "soft" },
        { label: "Round", value: "round" },
      ],
    },
    depth: {
      type: "select",
      options: [
        { label: "Flat", value: "flat" },
        { label: "Subtle", value: "subtle" },
        { label: "Raised", value: "raised" },
      ],
    },
    cardAlign: {
      type: "radio",
      options: [
        { label: "Left", value: "left" },
        { label: "Center", value: "center" },
      ],
    },
    sectionBg: {
      type: "select",
      options: [
        { label: "Light", value: "light" },
        { label: "White", value: "white" },
        { label: "Dark", value: "dark" },
        { label: "None", value: "none" },
      ],
    },
  },
  defaultProps: {
    subtitle: "Why teams choose us",
    heading: "Everything you need, in one place.",
    cards: [
      { eyebrow: "Simple", title: "Easy to use", body: "A visual editor anyone on your team can pick up in minutes — no training required." },
      { eyebrow: "Flexible", title: "Built to scale", body: "Start with one page and grow to hundreds — everything stays consistent as you go." },
      { eyebrow: "Reliable", title: "Always on", body: "Fast, secure, and dependable — so you can focus on your content, not your infrastructure." },
    ],
    columns: "3",
    colorScheme: "brand mix",
    corners: "round",
    depth: "flat",
    cardAlign: "left",
    sectionBg: "light",
  },
  render: ({ subtitle, heading, cards, columns, colorScheme, corners, depth, cardAlign, sectionBg }) => {
    const onDarkSection = sectionBg === "dark";
    const center = cardAlign === "center";
    const list = cards || [];
    const cols = Math.min(Number(columns) || 3, list.length || 1);
    return (
      <div className={`px-p1-lg py-p1-xl ${SECTION_BG[sectionBg]}`}>
        <div className="mx-auto max-w-7xl">
          <div className="mb-p1-xl text-center">
            {subtitle && (
              <p className={`mb-p1-xs font-serif text-xl italic ${onDarkSection ? "text-p1-warning" : "text-p1-primary"}`}>
                {subtitle}
              </p>
            )}
            {heading && (
              <h2 className={`text-3xl font-bold tracking-tight md:text-4xl ${onDarkSection ? "text-white" : "text-p1-text"}`}>
                {heading}
              </h2>
            )}
          </div>
          <div className="grid grid-cols-1 gap-p1-md" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0,1fr))` }}>
            {list.map((c, i) => {
              const s = schemeFor(colorScheme, i);
              return (
                <div
                  key={i}
                  className={`flex min-h-[15rem] flex-col gap-p1-sm p-p1-lg ${s.wrap} ${CORNERS[corners]} ${DEPTH[depth]} ${
                    center ? "items-center text-center" : "items-stretch text-left"
                  }`}
                >
                  {c.eyebrow != null && c.eyebrow !== "" && (
                    <div className={`text-xs font-bold uppercase tracking-[0.14em] ${s.sub}`}>{c.eyebrow}</div>
                  )}
                  <h3 className={`text-xl font-bold leading-snug ${s.title}`}>{c.title}</h3>
                  <p className={`text-[15px] leading-relaxed ${s.body}`}>{c.body}</p>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  },
};
