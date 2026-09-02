import { Btn } from "@/registry/p1/internal/btn";
import { Icon } from "@/registry/p1/internal/icons";
import "./feature-media.css";

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

export function FeatureMediaRender({
  eyebrow,
  title,
  body,
  bullets,
  buttonLabel,
  imageSrc,
  mediaSide,
  tone,
}: FeatureMediaProps) {
  const list = bullets || [];
  return (
    <div className="p1-feature-media p1-block" data-tone={tone} data-mediaside={mediaSide}>
      <div className="p1-feature-media__inner">
        <div className="p1-feature-media__media">
          <div className="p1-feature-media__img-frame">
            {imageSrc && <img src={imageSrc} alt="" className="p1-feature-media__img" />}
          </div>
        </div>
        <div className="p1-feature-media__copy">
          {eyebrow && <div className="p1-feature-media__eyebrow">{eyebrow}</div>}
          <h2 className="p1-feature-media__title">{title}</h2>
          <p className="p1-feature-media__body">{body}</p>
          {list.length > 0 && (
            <ul className="p1-feature-media__bullets">
              {list.map((b, i) => (
                <li key={i} className="p1-feature-media__bullet">
                  <span className="p1-feature-media__check" aria-hidden="true">
                    <Icon name="check" strokeWidth={2.4} className="p1-feature-media__check-icon" />
                  </span>
                  {b.text}
                </li>
              ))}
            </ul>
          )}
          {buttonLabel && (
            <Btn variant={tone === "dark" ? "yellow" : "primary"}>{buttonLabel}</Btn>
          )}
        </div>
      </div>
    </div>
  );
}
