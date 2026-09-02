import "./team-grid.css";

export interface TeamMember {
  name: string;
  role: string;
  avatar: string;
  bio: string;
}
export interface TeamGridProps {
  eyebrow: string;
  heading: string;
  columns: "2" | "3" | "4";
  shape: "circle" | "rounded";
  tone: "white" | "light";
  members: TeamMember[];
}

export function TeamGridRender({ eyebrow, heading, columns, shape, tone, members }: TeamGridProps) {
  return (
    <div className="p1-team-grid p1-block" data-tone={tone} data-cols={columns}>
      <div className="p1-team-grid__inner">
        <div className="p1-team-grid__header">
          {eyebrow && <p className="p1-team-grid__eyebrow">{eyebrow}</p>}
          {heading && <h2 className="p1-team-grid__heading">{heading}</h2>}
        </div>
        <div className="p1-team-grid__grid">
          {(members || []).map((m, i) => (
            <div key={i} className="p1-team-grid__member">
              <div className="p1-team-grid__avatar" data-shape={shape}>
                {m.avatar && <img src={m.avatar} alt={m.name} className="p1-team-grid__avatar-img" />}
              </div>
              <div className="p1-team-grid__name">{m.name}</div>
              <div className="p1-team-grid__role">{m.role}</div>
              {m.bio && <p className="p1-team-grid__bio">{m.bio}</p>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
