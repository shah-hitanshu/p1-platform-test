import type { ComponentConfig } from "@puckeditor/core";
import { Icon } from "@/registry/p1/internal/icons";

function safeHref(h: string): string {
  return /^(https?:\/\/|\/|#)/.test(h) ? h : "#";
}

export interface HeaderLink {
  label: string;
  href: string;
}
export interface HeaderProps {
  logo: string;
  links: HeaderLink[];
  navAlign: "left" | "center" | "right";
  showSearch: "off" | "on";
  ctaLabel: string;
  ctaStyle: "primary" | "yellow" | "purple" | "outline" | "none";
  tone: "white" | "light" | "dark";
  border: "on" | "off";
  sticky: "off" | "on";
}

const TONES: Record<HeaderProps["tone"], { wrap: string; text: string; link: string; border: string }> = {
  white: { wrap: "bg-white", text: "text-p1-text", link: "text-p1-text-muted", border: "border-p1-border" },
  light: { wrap: "bg-p1-bg-light", text: "text-p1-text", link: "text-p1-text-muted", border: "border-p1-border" },
  dark: { wrap: "bg-gray-900", text: "text-white", link: "text-white/70", border: "border-white/10" },
};

const CTA: Record<Exclude<HeaderProps["ctaStyle"], "none">, string> = {
  primary: "bg-gray-900 text-white border border-gray-900",
  yellow: "bg-p1-warning text-p1-text border border-p1-warning",
  purple: "bg-p1-primary text-white border border-p1-primary",
  outline: "bg-transparent border border-current",
};

export const HeaderBlock: ComponentConfig<HeaderProps> = {
  fields: {
    logo: { type: "text", contentEditable: true, visible: false },
    links: {
      type: "array",
      arrayFields: { label: { type: "text", contentEditable: true, visible: false }, href: { type: "text", contentEditable: true, visible: false } },
      defaultItemProps: { label: "Link", href: "#" },
      getItemSummary: (item) => item.label || "Link",
    },
    navAlign: {
      type: "select",
      options: [
        { label: "Left", value: "left" },
        { label: "Center", value: "center" },
        { label: "Right", value: "right" },
      ],
    },
    showSearch: {
      type: "radio",
      options: [
        { label: "Off", value: "off" },
        { label: "On", value: "on" },
      ],
    },
    ctaLabel: { type: "text", contentEditable: true, visible: false },
    ctaStyle: {
      type: "select",
      options: [
        { label: "Primary", value: "primary" },
        { label: "Yellow", value: "yellow" },
        { label: "Purple", value: "purple" },
        { label: "Outline", value: "outline" },
        { label: "None", value: "none" },
      ],
    },
    tone: {
      type: "select",
      options: [
        { label: "White", value: "white" },
        { label: "Light", value: "light" },
        { label: "Dark", value: "dark" },
      ],
    },
    border: {
      type: "radio",
      options: [
        { label: "On", value: "on" },
        { label: "Off", value: "off" },
      ],
    },
    sticky: {
      type: "radio",
      options: [
        { label: "Off", value: "off" },
        { label: "On", value: "on" },
      ],
    },
  },
  defaultProps: {
    logo: "Pantheon",
    links: [
      { label: "Product", href: "#" },
      { label: "Solutions", href: "#" },
      { label: "Pricing", href: "#" },
      { label: "Docs", href: "#" },
      { label: "Customers", href: "#" },
    ],
    navAlign: "center",
    showSearch: "on",
    ctaLabel: "Start for free",
    ctaStyle: "primary",
    tone: "white",
    border: "on",
    sticky: "off",
  },
  render: ({ logo, links, navAlign, showSearch, ctaLabel, ctaStyle, tone, border, sticky }) => {
    const t = TONES[tone];
    const list = links || [];
    const nav = (
      <nav className="hidden items-center gap-7 md:flex">
        {list.map((l, i) => (
          <a key={i} href={safeHref(l.href)} className={`whitespace-nowrap text-sm font-medium ${t.link} hover:text-current`}>
            {l.label}
          </a>
        ))}
      </nav>
    );
    const logoEl = (
      <span className={`whitespace-nowrap text-xl font-extrabold tracking-tight ${t.text}`}>{logo}</span>
    );
    const actions = (
      <div className="flex items-center gap-4">
        {showSearch === "on" && <Icon name="search" className={`h-[18px] w-[18px] ${t.link}`} />}
        {ctaStyle !== "none" && ctaLabel && (
          <span
            className={`hidden whitespace-nowrap rounded-full px-5 py-2.5 text-sm font-bold sm:inline-flex ${CTA[ctaStyle]}`}
          >
            {ctaLabel}
          </span>
        )}
        <button type="button" aria-label="Menu" className={`md:hidden ${t.text}`}>
          <Icon name="menu" className="h-6 w-6" />
        </button>
      </div>
    );

    return (
      <header
        className={`${t.wrap} ${border === "off" ? "" : `border-b ${t.border}`} ${
          sticky === "on" ? "sticky top-0 z-20" : "relative"
        } px-p1-lg py-p1-md`}
      >
        <div className="mx-auto flex w-full max-w-7xl items-center">
          {navAlign === "left" && (
            <>
              {logoEl}
              <span className="ml-7">{nav}</span>
              <span className="flex-1" />
              {actions}
            </>
          )}
          {navAlign === "right" && (
            <>
              {logoEl}
              <span className="flex-1" />
              {nav}
              <span className="ml-7">{actions}</span>
            </>
          )}
          {navAlign === "center" && (
            <>
              {logoEl}
              <span className="flex-1" />
              {nav}
              <span className="flex-1" />
              {actions}
            </>
          )}
        </div>
      </header>
    );
  },
};
