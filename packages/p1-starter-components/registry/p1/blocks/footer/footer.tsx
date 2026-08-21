import type { ComponentConfig } from "@puckeditor/core";
import { Icon, type IconName } from "@/registry/p1/internal/icons";

export interface FooterColumn {
  title: string;
  links: string;
}
export interface FooterProps {
  logo: string;
  tagline: string;
  columns: FooterColumn[];
  newsletter: "on" | "off";
  newsletterTitle: string;
  newsletterButton: string;
  social: "on" | "off";
  legal: "on" | "off";
  copyright: string;
  legalLinks: string;
  tone: "dark" | "indigo" | "light";
}

const splitLines = (s: string) =>
  String(s || "")
    .split("\n")
    .map((x) => x.trim())
    .filter(Boolean);

const TONES: Record<
  FooterProps["tone"],
  { wrap: string; head: string; body: string; border: string; field: string }
> = {
  dark: {
    wrap: "bg-gray-900",
    head: "text-white",
    body: "text-white/60",
    border: "border-white/10",
    field: "bg-white/5 border-white/15 text-white/60",
  },
  indigo: {
    wrap: "bg-indigo-950",
    head: "text-white",
    body: "text-white/65",
    border: "border-white/15",
    field: "bg-white/10 border-white/20 text-white/65",
  },
  light: {
    wrap: "bg-p1-bg-light",
    head: "text-p1-text",
    body: "text-p1-text-muted",
    border: "border-p1-border",
    field: "bg-white border-p1-border text-p1-text-muted",
  },
};

const SOCIAL: IconName[] = ["globe", "mail", "external"];

export const FooterBlock: ComponentConfig<FooterProps> = {
  fields: {
    logo: { type: "text", contentEditable: true, visible: false },
    tagline: { type: "textarea", contentEditable: true, visible: false },
    columns: {
      type: "array",
      arrayFields: { title: { type: "text", contentEditable: true, visible: false }, links: { type: "textarea" } },
      defaultItemProps: { title: "Column", links: "Link one\nLink two" },
      getItemSummary: (item) => item.title || "Column",
    },
    newsletter: {
      type: "radio",
      options: [
        { label: "On", value: "on" },
        { label: "Off", value: "off" },
      ],
    },
    newsletterTitle: { type: "text", contentEditable: true, visible: false },
    newsletterButton: { type: "text", contentEditable: true, visible: false },
    social: {
      type: "radio",
      options: [
        { label: "On", value: "on" },
        { label: "Off", value: "off" },
      ],
    },
    legal: {
      type: "radio",
      options: [
        { label: "On", value: "on" },
        { label: "Off", value: "off" },
      ],
    },
    copyright: { type: "text", contentEditable: true, visible: false },
    legalLinks: { type: "textarea" },
    tone: {
      type: "select",
      options: [
        { label: "Dark", value: "dark" },
        { label: "Indigo", value: "indigo" },
        { label: "Light", value: "light" },
      ],
    },
  },
  defaultProps: {
    logo: "Pantheon",
    tagline:
      "The WebOps platform for WordPress and Drupal. Build, launch, and run ambitious sites — together.",
    columns: [
      { title: "Product", links: "Overview\nIntegrations\nPricing\nChangelog" },
      { title: "Solutions", links: "Agencies\nEnterprise\nHigher ed\nGovernment" },
      { title: "Resources", links: "Docs\nGuides\nBlog\nSupport" },
      { title: "Company", links: "About\nCareers\nPartners\nContact" },
    ],
    newsletter: "on",
    newsletterTitle: "Ship better, every week.",
    newsletterButton: "Subscribe",
    social: "on",
    legal: "on",
    copyright: "© 2026 Pantheon Systems, Inc.",
    legalLinks: "Privacy\nTerms\nSecurity\nStatus",
    tone: "dark",
  },
  render: ({
    logo,
    tagline,
    columns,
    newsletter,
    newsletterTitle,
    newsletterButton,
    social,
    legal,
    copyright,
    legalLinks,
    tone,
  }) => {
    const t = TONES[tone];
    const cols = columns || [];
    const socialRow = (
      <div className="flex gap-3">
        {SOCIAL.map((nm, i) => (
          <span
            key={i}
            className={`grid h-9 w-9 place-items-center rounded-full border ${t.border} ${t.body}`}
          >
            <Icon name={nm} className="h-4 w-4" />
          </span>
        ))}
      </div>
    );

    return (
      <footer className={`${t.wrap} px-p1-lg pb-p1-lg pt-p1-xl`}>
        <div className="mx-auto max-w-7xl">
          {newsletter === "on" && (
            <div
              className={`mb-p1-xl flex flex-wrap items-center justify-between gap-p1-lg border-b ${t.border} pb-p1-lg`}
            >
              <div className={`max-w-md text-2xl font-bold tracking-tight md:text-3xl ${t.head}`}>
                {newsletterTitle}
              </div>
              <div className="flex w-full max-w-md flex-1 items-center justify-end gap-2.5">
                <span className={`flex-1 rounded-p1-md border px-4 py-3 text-sm ${t.field}`}>you@company.com</span>
                <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full bg-p1-warning px-5 py-3 text-sm font-bold text-p1-text">
                  {newsletterButton}
                  <Icon name="arrow-right" className="h-4 w-4" />
                </span>
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-p1-lg md:grid-cols-3 lg:grid-cols-5">
            <div className="col-span-2 md:col-span-3 lg:col-span-2">
              <div className={`mb-p1-sm text-xl font-extrabold tracking-tight ${t.head}`}>{logo}</div>
              <p className={`m-0 max-w-xs text-sm leading-relaxed text-pretty ${t.body}`}>{tagline}</p>
            </div>
            {cols.map((c, i) => (
              <div key={i}>
                <h5 className={`mb-p1-md text-xs font-bold uppercase tracking-[0.06em] ${t.head}`}>{c.title}</h5>
                <ul className="m-0 flex list-none flex-col gap-2.5 p-0">
                  {splitLines(c.links).map((ln, j) => (
                    <li key={j} className={`text-sm ${t.body}`}>
                      {ln}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>

          {legal === "on" && (
            <div
              className={`mt-p1-xl flex flex-col gap-p1-md border-t ${t.border} pt-p1-md sm:flex-row sm:items-center`}
            >
              <span className={`text-xs ${t.body}`}>{copyright}</span>
              <div className="flex flex-wrap gap-5">
                {splitLines(legalLinks).map((ln, i) => (
                  <span key={i} className={`text-xs ${t.body}`}>
                    {ln}
                  </span>
                ))}
              </div>
              <span className="flex-1" />
              {social === "on" && socialRow}
            </div>
          )}

          {legal !== "on" && social === "on" && <div className="mt-p1-lg flex justify-end">{socialRow}</div>}
        </div>
      </footer>
    );
  },
};
