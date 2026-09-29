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
              <div key={i} className="p1-logo-cloud__item">
                <img src={l.src} alt="" className="p1-logo-cloud__img" />
                {l.label && <span className="p1-logo-cloud__label">{l.label}</span>}
              </div>
            ) : (
              <div key={i} className="p1-logo-cloud__placeholder">{l.label || "Logo"}</div>
            )
          )}
        </div>
      </div>
    </div>
  );
}
