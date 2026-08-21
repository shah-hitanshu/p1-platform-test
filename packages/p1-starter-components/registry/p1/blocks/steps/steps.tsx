import type { ComponentConfig } from "@puckeditor/core";

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

const TONES: Record<StepsProps["tone"], { wrap: string; onDark: boolean }> = {
  white: { wrap: "bg-white text-p1-text", onDark: false },
  light: { wrap: "bg-p1-bg-light text-p1-text", onDark: false },
  dark: { wrap: "bg-gray-900 text-white", onDark: true },
};

export const StepsBlock: ComponentConfig<StepsProps> = {
  fields: {
    eyebrow: { type: "text", contentEditable: true, visible: false },
    heading: { type: "text", contentEditable: true, visible: false },
    items: {
      type: "array",
      arrayFields: { title: { type: "text", contentEditable: true, visible: false }, body: { type: "textarea", contentEditable: true, visible: false } },
      defaultItemProps: { title: "Step", body: "Describe this step." },
      getItemSummary: (item) => item.title || "Step",
    },
    tone: {
      type: "select",
      options: [
        { label: "White", value: "white" },
        { label: "Light", value: "light" },
        { label: "Dark", value: "dark" },
      ],
    },
  },
  defaultProps: {
    eyebrow: "How it works",
    heading: "Ship in three steps.",
    items: [
      { title: "Plan", body: "Start from a template or a blank page and outline what you want to say." },
      { title: "Build", body: "Compose your page from ready-made blocks — no code required." },
      { title: "Publish", body: "Preview your changes, then make them live in a single click." },
    ],
    tone: "light",
  },
  render: ({ eyebrow, heading, items, tone }) => {
    const t = TONES[tone];
    const list = items || [];
    const cols = Math.min(4, Math.max(1, list.length));
    return (
      <div className={`px-p1-lg py-p1-xl ${t.wrap}`}>
        <div className="mx-auto max-w-7xl">
          <div className="mb-p1-xl text-center">
            {eyebrow && (
              <p className={`mb-p1-xs font-serif text-lg italic ${t.onDark ? "text-p1-warning" : "text-p1-primary"}`}>{eyebrow}</p>
            )}
            {heading && <h2 className="text-3xl font-bold tracking-tight md:text-4xl">{heading}</h2>}
          </div>
          <div className="grid grid-cols-1 gap-p1-xl sm:grid-cols-2" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0,1fr))` }}>
            {list.map((it, i) => (
              <div key={i} className="flex flex-col gap-p1-sm">
                <div className={`grid h-12 w-12 place-items-center rounded-full text-lg font-extrabold ${t.onDark ? "bg-p1-warning/15 text-p1-warning" : "bg-indigo-50 text-p1-primary"}`}>
                  {i + 1}
                </div>
                <h3 className="mt-p1-xs text-xl font-bold">{it.title}</h3>
                <p className={`text-[15px] leading-relaxed ${t.onDark ? "text-white/80" : "text-p1-text-muted"}`}>{it.body}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  },
};
