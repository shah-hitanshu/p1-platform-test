import "./logos.css";

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

export function LogoCloudRender({ heading, style, height, logos }: LogoCloudProps) {
  return (
    <div className="p1-logo-cloud p1-block" data-style={style} data-height={height}>
      <div className="p1-logo-cloud__inner">
        {heading && <div className="p1-logo-cloud__heading">{heading}</div>}
        <div className="p1-logo-cloud__list">
          {(logos || []).map((l, i) =>
            l.src ? (
              <img
                key={i}
                src={l.src}
                alt={l.label || ""}
                className="p1-logo-cloud__img"
              />
            ) : (
              <div key={i} className="p1-logo-cloud__placeholder">{l.label || "Logo"}</div>
            )
          )}
        </div>
      </div>
    </div>
  );
}
