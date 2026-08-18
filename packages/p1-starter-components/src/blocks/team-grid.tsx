import type { ComponentConfig } from "@puckeditor/core";

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

const COL_CLASS: Record<TeamGridProps["columns"], string> = {
  "2": "sm:grid-cols-2",
  "3": "sm:grid-cols-2 lg:grid-cols-3",
  "4": "sm:grid-cols-2 lg:grid-cols-4",
};

export const TeamGridBlock: ComponentConfig<TeamGridProps> = {
  fields: {
    eyebrow: { type: "text", contentEditable: true, visible: false },
    heading: { type: "text", contentEditable: true, visible: false },
    columns: {
      type: "select",
      options: [
        { label: "2", value: "2" },
        { label: "3", value: "3" },
        { label: "4", value: "4" },
      ],
    },
    shape: {
      type: "radio",
      options: [
        { label: "Circle", value: "circle" },
        { label: "Rounded", value: "rounded" },
      ],
    },
    tone: {
      type: "radio",
      options: [
        { label: "White", value: "white" },
        { label: "Light", value: "light" },
      ],
    },
    members: {
      type: "array",
      arrayFields: {
        name: { type: "text", contentEditable: true, visible: false },
        role: { type: "text", contentEditable: true, visible: false },
        avatar: { type: "text" },
        bio: { type: "textarea", contentEditable: true, visible: false },
      },
      defaultItemProps: { name: "Team member", role: "Role", avatar: "", bio: "" },
      getItemSummary: (item) => item.name || "Member",
    },
  },
  defaultProps: {
    eyebrow: "The team",
    heading: "People behind the platform.",
    columns: "3",
    shape: "circle",
    tone: "white",
    members: [
      { name: "Jordan Ellis", role: "Head of Operations", avatar: "https://images.unsplash.com/photo-1573497019940-1c28c88b4f3e?w=300&q=80", bio: "" },
      { name: "Sam Rivera", role: "Principal Engineer", avatar: "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=300&q=80", bio: "" },
      { name: "Priya Nair", role: "Design Lead", avatar: "https://images.unsplash.com/photo-1438761681033-6461ffad8d80?w=300&q=80", bio: "" },
    ],
  },
  render: ({ eyebrow, heading, columns, shape, tone, members }) => (
    <div className={`px-p1-lg py-p1-xl ${tone === "light" ? "bg-p1-bg-light" : "bg-p1-bg-default"}`}>
      <div className="mx-auto max-w-6xl">
        <div className="mb-p1-xl text-center">
          {eyebrow && <p className="mb-p1-sm font-serif text-xl italic text-p1-primary">{eyebrow}</p>}
          {heading && <h2 className="text-3xl font-bold tracking-tight text-p1-text md:text-4xl">{heading}</h2>}
        </div>
        <div className={`grid grid-cols-1 gap-p1-lg ${COL_CLASS[columns]}`}>
          {(members || []).map((m, i) => (
            <div key={i} className="flex flex-col items-center gap-1 text-center">
              <div
                className={`mb-p1-sm h-32 w-32 overflow-hidden bg-gray-200 ${
                  shape === "rounded" ? "rounded-p1-lg" : "rounded-full"
                }`}
              >
                {m.avatar && <img src={m.avatar} alt={m.name} className="h-full w-full object-cover" />}
              </div>
              <div className="text-lg font-bold text-p1-text">{m.name}</div>
              <div className="text-sm font-medium text-p1-primary">{m.role}</div>
              {m.bio && <p className="mt-p1-sm max-w-[16rem] text-sm leading-relaxed text-p1-text-muted">{m.bio}</p>}
            </div>
          ))}
        </div>
      </div>
    </div>
  ),
};
