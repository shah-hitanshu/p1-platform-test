import { Icon } from "@/registry/p1/internal/icons";
import "./header.css";

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

export function HeaderRender({ logo, links, navAlign, showSearch, ctaLabel, ctaStyle, tone, border, sticky }: HeaderProps) {
  const list = links || [];

  const logoEl = <span className="p1-header__logo">{logo}</span>;

  const nav = (
    <nav className="p1-header__nav">
      {list.map((l, i) => (
        <a key={i} href={safeHref(l.href)} className="p1-header__link">
          {l.label}
        </a>
      ))}
    </nav>
  );

  const actions = (
    <div className="p1-header__actions">
      {showSearch === "on" && <Icon name="search" className="p1-header__search-icon" />}
      {ctaStyle !== "none" && ctaLabel && (
        <span className="p1-header__cta" data-cta={ctaStyle}>
          {ctaLabel}
        </span>
      )}
      <button type="button" aria-label="Menu" className="p1-header__burger">
        <Icon name="menu" className="p1-header__burger-icon" />
      </button>
    </div>
  );

  return (
    <header
      className="p1-header"
      data-tone={tone}
      data-border={border}
      data-sticky={sticky === "on" ? "on" : undefined}
    >
      <div className="p1-header__inner">
        {navAlign === "left" && (
          <>
            {logoEl}
            <span className="p1-header__gap-start">{nav}</span>
            <span className="p1-header__spacer" />
            {actions}
          </>
        )}
        {navAlign === "right" && (
          <>
            {logoEl}
            <span className="p1-header__spacer" />
            {nav}
            <span className="p1-header__gap-end">{actions}</span>
          </>
        )}
        {navAlign === "center" && (
          <>
            {logoEl}
            <span className="p1-header__spacer" />
            {nav}
            <span className="p1-header__spacer" />
            {actions}
          </>
        )}
      </div>
    </header>
  );
}
