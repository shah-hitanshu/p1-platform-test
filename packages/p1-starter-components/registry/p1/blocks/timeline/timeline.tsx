import type { ComponentConfig } from "@puckeditor/core";

export interface TimelineItem {
  date: string;
  title: string;
  body: string;
}
export interface TimelineProps {
  eyebrow: string;
  heading: string;
  layout: "vertical" | "alternating";
  tone: "white" | "light";
  items: TimelineItem[];
}

const Dot = () => (
  <span className="block h-4 w-4 flex-none rounded-full border-[3px] border-p1-primary bg-p1-warning" />
);

const Content = ({ it }: { it: TimelineItem }) => (
  <div>
    <div className="mb-1 text-xs font-bold uppercase tracking-[0.12em] text-p1-primary">{it.date}</div>
    <h3 className="mb-p1-xs text-xl font-bold tracking-tight text-p1-text">{it.title}</h3>
    <p className="m-0 leading-relaxed text-pretty text-p1-text-muted">{it.body}</p>
  </div>
);

export const TimelineBlock: ComponentConfig<TimelineProps> = {
  fields: {
    eyebrow: { type: "text", contentEditable: true, visible: false },
    heading: { type: "text", contentEditable: true, visible: false },
    layout: {
      type: "select",
      options: [
        { label: "Vertical", value: "vertical" },
        { label: "Alternating", value: "alternating" },
      ],
    },
    tone: {
      type: "radio",
      options: [
        { label: "White", value: "white" },
        { label: "Light", value: "light" },
      ],
    },
    items: {
      type: "array",
      arrayFields: {
        date: { type: "text", contentEditable: true, visible: false },
        title: { type: "text", contentEditable: true, visible: false },
        body: { type: "textarea", contentEditable: true, visible: false },
      },
      defaultItemProps: { date: "Year", title: "Milestone", body: "What happened." },
      getItemSummary: (item) => item.title || "Milestone",
    },
  },
  defaultProps: {
    eyebrow: "Our story",
    heading: "How we got here.",
    layout: "vertical",
    tone: "white",
    items: [
      { date: "2019", title: "The first commit", body: "Two engineers, one repo, and a stubborn belief that shipping should be simple." },
      { date: "2021", title: "Multidev arrives", body: "Parallel environments for every branch — review without stepping on each other." },
      { date: "2023", title: "100,000 sites", body: "Teams across publishing, higher ed, and government make the switch." },
      { date: "2026", title: "One workflow for everyone", body: "Developers, marketers, and IT finally share a single way to build and run the web." },
    ],
  },
  render: ({ eyebrow, heading, layout, tone, items }) => {
    const list = items || [];
    const alt = layout === "alternating";
    return (
      <div className={`px-p1-lg py-p1-xl ${tone === "light" ? "bg-p1-bg-light" : "bg-p1-bg-default"}`}>
        <div className="mx-auto max-w-6xl">
          <div className="mb-p1-xl text-center">
            {eyebrow && <p className="mb-p1-sm font-serif text-xl italic text-p1-primary">{eyebrow}</p>}
            {heading && <h2 className="text-3xl font-bold tracking-tight text-p1-text md:text-4xl">{heading}</h2>}
          </div>

          {alt ? (
            <div className="relative mx-auto max-w-4xl">
              {/* center axis on md+, left rail on mobile */}
              <div className="absolute bottom-0 top-0 left-[7px] w-0.5 bg-p1-primary/15 md:left-1/2 md:-translate-x-1/2" />
              <div className="flex flex-col gap-p1-xl">
                {list.map((it, i) => {
                  const right = i % 2 === 1;
                  return (
                    <div
                      key={i}
                      className="grid items-start gap-p1-md md:gap-0"
                      style={{ gridTemplateColumns: "16px 1fr" }}
                    >
                      {/* mobile dot + content */}
                      <div className="pt-1 md:hidden">
                        <Dot />
                      </div>
                      <div className="md:hidden">
                        <Content it={it} />
                      </div>
                      {/* md alternating */}
                      <div className="hidden md:col-span-2 md:grid md:grid-cols-[1fr_32px_1fr] md:items-start">
                        <div className={`pr-p1-lg text-right ${right ? "md:invisible" : ""}`}>
                          {!right && <Content it={it} />}
                        </div>
                        <div className="grid place-items-center pt-1">
                          <Dot />
                        </div>
                        <div className={`pl-p1-lg ${right ? "" : "md:invisible"}`}>{right && <Content it={it} />}</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="relative mx-auto max-w-2xl pl-2">
              <div className="absolute bottom-1.5 left-[7px] top-1.5 w-0.5 bg-p1-primary/15" />
              <div className="flex flex-col gap-p1-xl">
                {list.map((it, i) => (
                  <div key={i} className="grid items-start gap-p1-lg" style={{ gridTemplateColumns: "16px 1fr" }}>
                    <div className="relative z-10 pt-1">
                      <Dot />
                    </div>
                    <Content it={it} />
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    );
  },
};
