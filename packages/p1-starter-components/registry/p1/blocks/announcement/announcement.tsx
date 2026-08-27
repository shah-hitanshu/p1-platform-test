import "./announcement.css";

export interface AnnouncementProps {
  text: string;
  linkLabel: string;
  tone: "accent" | "yellow" | "dark" | "gradient";
  align: "center" | "left";
}

export function AnnouncementRender({ text, linkLabel, tone, align }: AnnouncementProps) {
  return (
    <div className="p1-announcement" data-tone={tone} data-align={align}>
      <span className="p1-announcement__text">{text}</span>
      {linkLabel && <span className="p1-announcement__link">{linkLabel}</span>}
    </div>
  );
}
