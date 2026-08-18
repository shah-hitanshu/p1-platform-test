import type { ComponentConfig } from "@puckeditor/core";
import { Icon, type IconName } from "../internal/icons";

export interface EmbedProps {
  kind: "video" | "social" | "map" | "generic";
  url: string;
  title: string;
  ratio: "16 / 9" | "4 / 3" | "1 / 1";
  caption: string;
  width: "contained" | "wide";
}

function providerOf(url: string, kind: EmbedProps["kind"]): string {
  const u = (url || "").toLowerCase();
  if (/youtu\.?be/.test(u)) return "YouTube";
  if (/vimeo/.test(u)) return "Vimeo";
  if (/wistia/.test(u)) return "Wistia";
  if (/twitter|x\.com/.test(u)) return "X / Twitter";
  if (/instagram/.test(u)) return "Instagram";
  if (/linkedin/.test(u)) return "LinkedIn";
  if (/maps|google\.com\/maps/.test(u)) return "Google Maps";
  return { video: "Video", social: "Social post", map: "Map", generic: "Embedded content" }[kind];
}

export const EmbedBlock: ComponentConfig<EmbedProps> = {
  fields: {
    kind: {
      type: "select",
      options: [
        { label: "Video", value: "video" },
        { label: "Social", value: "social" },
        { label: "Map", value: "map" },
        { label: "Generic", value: "generic" },
      ],
    },
    url: { type: "text" },
    title: { type: "text", contentEditable: true, visible: false },
    ratio: {
      type: "select",
      options: [
        { label: "16 / 9", value: "16 / 9" },
        { label: "4 / 3", value: "4 / 3" },
        { label: "1 / 1", value: "1 / 1" },
      ],
    },
    caption: { type: "text", contentEditable: true, visible: false },
    width: {
      type: "select",
      options: [
        { label: "Contained", value: "contained" },
        { label: "Wide", value: "wide" },
      ],
    },
  },
  defaultProps: {
    kind: "video",
    url: "https://youtube.com/watch?v=demo",
    title: "Inside a Pantheon deploy — start to Live in 90 seconds",
    ratio: "16 / 9",
    caption: "",
    width: "wide",
  },
  render: ({ kind, url, title, ratio, caption, width }) => {
    const provider = providerOf(url, kind);
    const isVideo = kind === "video";
    const iconByKind: Record<EmbedProps["kind"], IconName> = {
      video: "external",
      social: "chat",
      map: "map-pin",
      generic: "external",
    };
    return (
      <div className={`mx-auto py-p1-md px-p1-lg ${width === "contained" ? "max-w-3xl" : "max-w-6xl"}`}>
        <div
          className={`relative grid place-items-center overflow-hidden rounded-p1-lg ${
            isVideo ? "bg-gray-900" : "border border-p1-border bg-gray-100"
          }`}
          style={{ aspectRatio: ratio }}
        >
          {isVideo ? (
            <div className="grid h-[72px] w-[72px] place-items-center rounded-full bg-p1-warning shadow-xl">
              <span
                className="ml-1 block h-0 w-0"
                style={{
                  borderTop: "13px solid transparent",
                  borderBottom: "13px solid transparent",
                  borderLeft: "21px solid var(--p1-text)",
                }}
              />
            </div>
          ) : (
            <div className="text-center text-p1-text-muted">
              <Icon name={iconByKind[kind]} className="mx-auto mb-2 h-9 w-9" />
              <div className="font-bold text-p1-text-muted">{provider}</div>
            </div>
          )}
          <div
            className={`absolute left-4 top-3.5 text-xs font-bold uppercase tracking-[0.12em] ${
              isVideo ? "text-white/85" : "text-p1-text-muted"
            }`}
          >
            {provider}
          </div>
          {isVideo && title && (
            <div className="absolute inset-x-5 bottom-4 text-base font-semibold leading-snug text-white drop-shadow-lg">
              {title}
            </div>
          )}
        </div>
        {caption && <div className="mt-p1-sm text-sm leading-relaxed text-p1-text-muted">{caption}</div>}
      </div>
    );
  },
};
