import type { ComponentConfig } from "@puckeditor/core";

export interface ArticleHeaderProps {
  category: string;
  title: string;
  standfirst: string;
  authorName: string;
  authorAvatar: string;
  date: string;
  readTime: string;
  align: "left" | "center";
  rule: "on" | "off";
}

export const ArticleHeaderBlock: ComponentConfig<ArticleHeaderProps> = {
  fields: {
    category: { type: "text", contentEditable: true, visible: false },
    title: { type: "text", contentEditable: true, visible: false },
    standfirst: { type: "textarea", contentEditable: true, visible: false },
    authorName: { type: "text", contentEditable: true, visible: false },
    authorAvatar: { type: "text", contentEditable: true, visible: false },
    date: { type: "text", contentEditable: true, visible: false },
    readTime: { type: "text", contentEditable: true, visible: false },
    align: {
      type: "radio",
      options: [
        { label: "Left", value: "left" },
        { label: "Center", value: "center" },
      ],
    },
    rule: {
      type: "radio",
      options: [
        { label: "On", value: "on" },
        { label: "Off", value: "off" },
      ],
    },
  },
  defaultProps: {
    category: "Engineering",
    title: "What a year of shipping on Multidev taught us about flow.",
    standfirst:
      "A behind-the-scenes look at how the team moved from weeks to hours — and the small habits that made the difference.",
    authorName: "Jordan Ellis",
    authorAvatar: "https://images.unsplash.com/photo-1573497019940-1c28c88b4f3e?w=200&q=80",
    date: "April 18, 2026",
    readTime: "6 min read",
    align: "left",
    rule: "on",
  },
  render: ({ category, title, standfirst, authorName, authorAvatar, date, readTime, align, rule }) => {
    const center = align === "center";
    return (
      <div className="mx-auto max-w-3xl px-p1-lg pb-p1-md pt-p1-xl">
        <div className={center ? "text-center" : "text-left"}>
          {category && (
            <div className="mb-p1-md text-xs font-bold uppercase tracking-[0.16em] text-p1-primary">{category}</div>
          )}
          <h1 className="mb-p1-md text-4xl font-extrabold leading-tight tracking-tight text-balance text-p1-text md:text-5xl">
            {title}
          </h1>
          {standfirst && (
            <p
              className={`mb-p1-lg max-w-2xl font-serif text-xl italic leading-snug text-pretty text-p1-text-muted ${
                center ? "mx-auto" : ""
              }`}
            >
              {standfirst}
            </p>
          )}
        </div>
        <div className={`flex items-center gap-p1-sm ${center ? "justify-center" : "justify-start"}`}>
          <div className="h-11 w-11 flex-none overflow-hidden rounded-full bg-black/10">
            {authorAvatar && <img src={authorAvatar} alt={authorName} className="h-full w-full object-cover" />}
          </div>
          <div className="text-left">
            <div className="font-bold text-p1-text">{authorName}</div>
            {(date || readTime) && (
              <div className="mt-0.5 text-sm text-p1-text-muted">
                {date}
                {date && readTime ? <span className="mx-1.5 text-p1-border">·</span> : null}
                {readTime}
              </div>
            )}
          </div>
        </div>
        {rule !== "off" && <hr className="mt-p1-lg border-t border-p1-border" />}
      </div>
    );
  },
};
