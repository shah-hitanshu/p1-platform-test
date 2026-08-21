import "./figure.css";

export interface FigureProps {
  src: string;
  alt: string;
  caption: string;
  credit: string;
  ratio: "16 / 9" | "3 / 2" | "4 / 3" | "1 / 1" | "21 / 9";
  width: "contained" | "wide" | "full bleed";
  radius: "none" | "soft" | "round";
  treatment: "color" | "b&w";
}

export function FigureRender({ src, alt, caption, credit, ratio, width, radius, treatment }: FigureProps) {
  const hasCap = Boolean(caption || credit);
  return (
    <figure className="p1-figure p1-block" data-width={width} data-radius={radius}>
      <div className="p1-figure__frame" style={{ aspectRatio: ratio }}>
        <img src={src} alt={alt} className="p1-figure__img" data-treatment={treatment} />
      </div>
      {hasCap && (
        <figcaption className="p1-figure__caption">
          <span className="p1-figure__caption-text">{caption}</span>
          {credit && <span className="p1-figure__credit">{credit}</span>}
        </figcaption>
      )}
    </figure>
  );
}
