import { Icon, type IconName } from "@/registry/p1/internal/icons";
import "./footer.css";

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

const SOCIAL_ICONS: IconName[] = ["globe", "mail", "external"];

export function FooterRender({
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
}: FooterProps) {
  const cols = columns || [];

  const socialRow = (
    <div className="p1-footer__social">
      {SOCIAL_ICONS.map((nm, i) => (
        <span key={i} className="p1-footer__social-btn">
          <Icon name={nm} className="p1-footer__social-icon" />
        </span>
      ))}
    </div>
  );

  return (
    <footer className="p1-footer" data-tone={tone}>
      <div className="p1-footer__inner">
        {newsletter === "on" && (
          <div className="p1-footer__newsletter">
            <div className="p1-footer__newsletter-title">{newsletterTitle}</div>
            <div className="p1-footer__newsletter-form">
              <span className="p1-footer__newsletter-field">you@company.com</span>
              <span className="p1-footer__newsletter-btn">
                {newsletterButton}
                <Icon name="arrow-right" className="p1-footer__newsletter-arrow" />
              </span>
            </div>
          </div>
        )}

        <div className="p1-footer__grid">
          <div className="p1-footer__brand">
            <div className="p1-footer__logo">{logo}</div>
            <p className="p1-footer__tagline">{tagline}</p>
          </div>
          {cols.map((c, i) => (
            <div key={i} className="p1-footer__col">
              <h5 className="p1-footer__col-head">{c.title}</h5>
              <ul className="p1-footer__col-list">
                {splitLines(c.links).map((ln, j) => (
                  <li key={j} className="p1-footer__col-item">
                    {ln}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        {legal === "on" && (
          <div className="p1-footer__legal">
            <span className="p1-footer__copyright">{copyright}</span>
            <div className="p1-footer__legal-links">
              {splitLines(legalLinks).map((ln, i) => (
                <span key={i} className="p1-footer__legal-item">
                  {ln}
                </span>
              ))}
            </div>
            <span className="p1-footer__legal-spacer" />
            {social === "on" && socialRow}
          </div>
        )}

        {legal !== "on" && social === "on" && (
          <div className="p1-footer__social-standalone">{socialRow}</div>
        )}
      </div>
    </footer>
  );
}
