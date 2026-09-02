import { Icon, type IconName } from "@/registry/p1/internal/icons";
import "./embed.css";

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

const ICON_BY_KIND: Record<EmbedProps["kind"], IconName> = {
  video: "external",
  social: "chat",
  map: "map-pin",
  generic: "external",
};

export function EmbedRender({ kind, url, title, ratio, caption, width }: EmbedProps) {
  const provider = providerOf(url, kind);
  const isVideo = kind === "video";
  return (
    <div className="p1-embed p1-block" data-width={width}>
      <div className="p1-embed__frame" data-kind={kind} style={{ aspectRatio: ratio }}>
        {isVideo ? (
          <div className="p1-embed__play" aria-hidden="true">
            <span className="p1-embed__play-triangle" />
          </div>
        ) : (
          <div className="p1-embed__placeholder">
            <Icon name={ICON_BY_KIND[kind]} className="p1-embed__placeholder-icon" />
            <div className="p1-embed__placeholder-label">{provider}</div>
          </div>
        )}
        <div className="p1-embed__provider-tag" data-kind={kind}>{provider}</div>
        {isVideo && title && (
          <div className="p1-embed__video-title">{title}</div>
        )}
      </div>
      {caption && <div className="p1-embed__caption">{caption}</div>}
    </div>
  );
}
