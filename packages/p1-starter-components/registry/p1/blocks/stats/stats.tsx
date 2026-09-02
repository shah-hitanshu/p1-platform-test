import type { ComponentConfig } from "@puckeditor/core";

export interface StatItem {
  value: string;
  label: string;
}
export interface StatsProps {
  tone: "light" | "dark";
  items: StatItem[];
}

export const StatsBlock: ComponentConfig<StatsProps> = {
  fields: {
    tone: {
      type: "radio",
      options: [
        { label: "Light", value: "light" },
        { label: "Dark", value: "dark" },
      ],
    },
    items: {
      type: "array",
      arrayFields: { value: { type: "text", contentEditable: true, visible: false }, label: { type: "text", contentEditable: true, visible: false } },
      defaultItemProps: { value: "100%", label: "Metric" },
      getItemSummary: (item) => item.value || "Stat",
    },
  },
  defaultProps: {
    tone: "light",
    items: [
      { value: "10k+", label: "Teams onboarded" },
      { value: "99.9%", label: "Uptime" },
      { value: "2M+", label: "Pages published" },
      { value: "4.9/5", label: "Customer rating" },
    ],
  },
  render: ({ tone, items }) => {
    const dark = tone === "dark";
    const cols = Math.min(4, (items || []).length || 1);
    return (
      <div className={`px-p1-lg py-p1-xl ${dark ? "bg-gray-900" : "bg-p1-bg-light"}`}>
        <div className="mx-auto grid max-w-6xl gap-p1-lg" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0,1fr))` }}>
          {(items || []).map((it, i) => (
            <div key={i} className="text-center">
              <div className={`text-4xl font-extrabold tracking-tight md:text-5xl ${dark ? "text-p1-warning" : "text-p1-primary"}`}>
                {it.value}
              </div>
              <div className={`mt-p1-sm text-sm font-medium ${dark ? "text-white/70" : "text-p1-text-muted"}`}>
                {it.label}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  },
};
