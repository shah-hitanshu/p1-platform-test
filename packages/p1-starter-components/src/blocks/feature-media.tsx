import type { ComponentConfig } from "@puckeditor/core";
import { Btn } from "../internal/btn";
import { Icon } from "../internal/icons";

export interface FeatureMediaBullet {
  text: string;
}
export interface FeatureMediaProps {
  eyebrow: string;
  title: string;
  body: string;
  bullets: FeatureMediaBullet[];
  buttonLabel: string;
  imageSrc: string;
  mediaSide: "right" | "left";
  tone: "white" | "light" | "dark";
}

const TONES: Record<FeatureMediaProps["tone"], { wrap: string; onDark: boolean }> = {
  white: { wrap: "bg-white text-p1-text", onDark: false },
  light: { wrap: "bg-p1-bg-light text-p1-text", onDark: false },
  dark: { wrap: "bg-gray-900 text-white", onDark: true },
};

export const FeatureMediaBlock: ComponentConfig<FeatureMediaProps> = {
  fields: {
    eyebrow: { type: "text", contentEditable: true, visible: false },
    title: { type: "text", contentEditable: true, visible: false },
    body: { type: "textarea", contentEditable: true, visible: false },
    bullets: {
      type: "array",
      arrayFields: { text: { type: "text", contentEditable: true, visible: false } },
      defaultItemProps: { text: "Benefit" },
      getItemSummary: (item) => item.text || "Bullet",
    },
    buttonLabel: { type: "text", contentEditable: true, visible: false },
    imageSrc: { type: "text" },
    mediaSide: {
      type: "radio",
      options: [
        { label: "Right", value: "right" },
        { label: "Left", value: "left" },
      ],
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
    title: "Designed around the way you work.",
    body: "Move from idea to published in a few clicks. Preview every change, then make it live whenever you’re ready.",
    bullets: [
      { text: "Visual, on-brand editing" },
      { text: "Preview before you publish" },
      { text: "Publish in one click" },
    ],
    buttonLabel: "See how it works →",
    imageSrc: "https://images.unsplash.com/photo-1551434678-e076c223a692?w=1000&q=80",
    mediaSide: "right",
    tone: "white",
  },
  render: ({ eyebrow, title, body, bullets, buttonLabel, imageSrc, mediaSide, tone }) => {
    const t = TONES[tone];
    const imgFirst = mediaSide === "left";
    const media = (
      <div className={`aspect-[4/3] overflow-hidden rounded-2xl bg-gray-100 ${t.onDark ? "border border-white/15" : "border border-p1-border"}`}>
        {imageSrc && <img src={imageSrc} alt="" className="h-full w-full object-cover" />}
      </div>
    );
    const copy = (
      <div>
        {eyebrow && (
          <div className={`mb-p1-sm text-xs font-bold uppercase tracking-[0.14em] ${t.onDark ? "text-p1-warning" : "text-p1-primary"}`}>
            {eyebrow}
          </div>
        )}
        <h2 className="mb-p1-sm text-3xl font-bold leading-tight tracking-tight text-balance md:text-4xl">{title}</h2>
        <p className={`mb-p1-md text-lg leading-relaxed ${t.onDark ? "text-white/80" : "text-p1-text-muted"}`}>{body}</p>
        {(bullets || []).length > 0 && (
          <ul className="mb-p1-lg flex list-none flex-col gap-p1-sm p-0">
            {(bullets || []).map((b, i) => (
              <li key={i} className="flex items-center gap-p1-sm font-medium">
                <span className={`grid h-[22px] w-[22px] flex-none place-items-center rounded-full ${t.onDark ? "bg-p1-warning/20 text-p1-warning" : "bg-p1-success/10 text-p1-success"}`}>
                  <Icon name="check" strokeWidth={2.4} className="h-3.5 w-3.5" />
                </span>
                {b.text}
              </li>
            ))}
          </ul>
        )}
        {buttonLabel && <Btn variant={t.onDark ? "yellow" : "primary"}>{buttonLabel}</Btn>}
      </div>
    );
    return (
      <div className={`px-p1-lg py-p1-xl ${t.wrap}`}>
        <div className="mx-auto grid max-w-7xl items-center gap-p1-xl md:grid-cols-2">
          {imgFirst ? (
            <>
              {media}
              {copy}
            </>
          ) : (
            <>
              {copy}
              {media}
            </>
          )}
        </div>
      </div>
    );
  },
};
