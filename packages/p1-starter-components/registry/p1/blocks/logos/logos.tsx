import type { ComponentConfig } from "@puckeditor/core";

export interface LogoItem {
  src: string;
  label: string;
}
export interface LogoCloudProps {
  heading: string;
  style: "mono" | "color";
  height: "small" | "medium" | "large";
  logos: LogoItem[];
}

const HEIGHT: Record<LogoCloudProps["height"], number> = { small: 26, medium: 38, large: 52 };

export const LogoCloudBlock: ComponentConfig<LogoCloudProps> = {
  fields: {
    heading: { type: "text", contentEditable: true, visible: false },
    style: {
      type: "radio",
      options: [
        { label: "Mono", value: "mono" },
        { label: "Color", value: "color" },
      ],
    },
    height: {
      type: "select",
      options: [
        { label: "Small", value: "small" },
        { label: "Medium", value: "medium" },
        { label: "Large", value: "large" },
      ],
    },
    logos: {
      type: "array",
      arrayFields: { src: { type: "text", contentEditable: true, visible: false }, label: { type: "text", contentEditable: true, visible: false } },
      defaultItemProps: { src: "", label: "Brand" },
      getItemSummary: (item) => item.label || "Logo",
    },
  },
  defaultProps: {
    heading: "Featured in",
    style: "mono",
    height: "medium",
    logos: [
      { src: "", label: "NPR" },
      { src: "", label: "PBS" },
      { src: "", label: "REUTERS" },
      { src: "", label: "NATURE" },
    ],
  },
  render: ({ heading, style, height, logos }) => {
    const mono = style !== "color";
    const h = HEIGHT[height];
    return (
      <div className="mx-auto max-w-6xl px-p1-lg py-p1-xl">
        {heading && (
          <div className="mb-p1-lg text-center text-sm font-semibold uppercase tracking-[0.14em] text-p1-text-muted">
            {heading}
          </div>
        )}
        <div className="flex flex-wrap items-center justify-center gap-x-12 gap-y-8">
          {(logos || []).map((l, i) =>
            l.src ? (
              <img
                key={i}
                src={l.src}
                alt={l.label || ""}
                style={{ height: h }}
                className={`w-auto max-w-[180px] object-contain ${mono ? "opacity-60 grayscale" : ""}`}
              />
            ) : (
              <div key={i} className="text-xl font-extrabold tracking-wide text-gray-400">
                {l.label || "Logo"}
              </div>
            )
          )}
        </div>
      </div>
    );
  },
};
