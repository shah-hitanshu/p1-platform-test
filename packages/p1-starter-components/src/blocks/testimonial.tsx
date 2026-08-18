import type { ComponentConfig } from "@puckeditor/core";

export interface TestimonialProps {
  quote: string;
  name: string;
  role: string;
  avatarSrc: string;
  layout: "centered" | "card" | "large";
  tone: "light" | "white" | "purple" | "dark";
}

const TONES: Record<TestimonialProps["tone"], { wrap: string; onDark: boolean; accent: string }> = {
  light: { wrap: "bg-p1-bg-light text-p1-text", onDark: false, accent: "text-p1-primary" },
  white: { wrap: "bg-white text-p1-text", onDark: false, accent: "text-p1-primary" },
  purple: { wrap: "bg-p1-primary text-white", onDark: true, accent: "text-p1-warning" },
  dark: { wrap: "bg-gray-900 text-white", onDark: true, accent: "text-p1-warning" },
};

export const TestimonialBlock: ComponentConfig<TestimonialProps> = {
  fields: {
    quote: { type: "textarea", contentEditable: true, visible: false },
    name: { type: "text", contentEditable: true, visible: false },
    role: { type: "text", contentEditable: true, visible: false },
    avatarSrc: { type: "text" },
    layout: {
      type: "select",
      options: [
        { label: "Centered", value: "centered" },
        { label: "Card", value: "card" },
        { label: "Large", value: "large" },
      ],
    },
    tone: {
      type: "select",
      options: [
        { label: "Light", value: "light" },
        { label: "White", value: "white" },
        { label: "Purple", value: "purple" },
        { label: "Dark", value: "dark" },
      ],
    },
  },
  defaultProps: {
    quote: "The team was up and running in a day, and we haven’t looked back. It just works.",
    name: "Jordan Ellis",
    role: "Operations Lead",
    avatarSrc: "https://images.unsplash.com/photo-1573497019940-1c28c88b4f3e?w=200&q=80",
    layout: "centered",
    tone: "light",
  },
  render: ({ quote, name, role, avatarSrc, layout, tone }) => {
    const t = TONES[tone];
    const center = layout !== "card";
    const large = layout === "large";
    return (
      <div className={`px-p1-lg py-p1-xl ${t.wrap}`}>
        <div className={`mx-auto flex flex-col gap-p1-lg ${large ? "max-w-4xl" : "max-w-3xl"} ${center ? "text-center" : "text-left"}`}>
          <div className={`font-serif text-5xl leading-none ${t.accent}`}>“</div>
          <p className={`font-serif font-medium italic leading-snug text-balance ${large ? "text-3xl" : "text-2xl"}`}>{quote}</p>
          <div className={`flex items-center gap-p1-sm ${center ? "justify-center" : "justify-start"}`}>
            <div className="h-12 w-12 flex-none overflow-hidden rounded-full bg-black/10">
              {avatarSrc && <img src={avatarSrc} alt={name} className="h-full w-full object-cover" />}
            </div>
            <div className="text-left">
              <div className="font-bold">{name}</div>
              <div className={`text-sm ${t.onDark ? "text-white/70" : "text-p1-text-muted"}`}>{role}</div>
            </div>
          </div>
        </div>
      </div>
    );
  },
};
