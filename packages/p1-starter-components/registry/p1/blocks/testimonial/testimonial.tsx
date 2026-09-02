import "./testimonial.css";

export interface TestimonialProps {
  quote: string;
  name: string;
  role: string;
  avatarSrc: string;
  layout: "centered" | "card" | "large";
  tone: "light" | "white" | "accent" | "dark";
}

export function TestimonialRender({ quote, name, role, avatarSrc, layout, tone }: TestimonialProps) {
  return (
    <div className="p1-testimonial p1-block" data-layout={layout} data-tone={tone}>
      <div className="p1-testimonial__inner">
        <div className="p1-testimonial__mark" aria-hidden="true">&ldquo;</div>
        <p className="p1-testimonial__quote">{quote}</p>
        <div className="p1-testimonial__attribution">
          <div className="p1-testimonial__avatar">
            {avatarSrc && <img src={avatarSrc} alt={name} className="p1-testimonial__avatar-img" />}
          </div>
          <div className="p1-testimonial__byline">
            <div className="p1-testimonial__name">{name}</div>
            <div className="p1-testimonial__role">{role}</div>
          </div>
        </div>
      </div>
    </div>
  );
}
