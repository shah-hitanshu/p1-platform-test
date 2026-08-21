import "./image.css";

export interface ImageProps {
  src: string;
  alt: string;
  width: "contained" | "full bleed";
  ratio: "16 / 9" | "4 / 3" | "1 / 1" | "3 / 2" | "21 / 9";
  fit: "cover" | "contain" | "fill";
  position: "center" | "top" | "bottom" | "left" | "right";
  radius: "none" | "soft" | "round";
  treatment: "color" | "b&w";
}

export function ImageRender({ src, alt, width, ratio, fit, position, radius, treatment }: ImageProps) {
  const full = width === "full bleed";
  return (
    <div className="p1-image" data-width={width}>
      <div
        className="p1-image__wrap"
        data-radius={!full ? radius : undefined}
        style={{ aspectRatio: ratio }}
      >
        <img
          src={src}
          alt={alt}
          className="p1-image__img"
          data-treatment={treatment}
          style={{ objectFit: fit, objectPosition: position }}
        />
      </div>
    </div>
  );
}
