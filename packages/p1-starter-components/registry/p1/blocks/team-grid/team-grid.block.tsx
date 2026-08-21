import type { ComponentConfig } from "@puckeditor/core";
import { TeamGridRender, type TeamGridProps, type TeamMember } from "./team-grid";
export type { TeamGridProps, TeamMember };

export const TeamGridBlock: ComponentConfig<TeamGridProps> = {
  fields: {
    eyebrow: {
      type: "text" as const,
      contentEditable: true,
      visible: false,
      ai: { instructions: "Short label above the heading. 2–4 words. E.g. The team." },
    },
    heading: {
      type: "text" as const,
      contentEditable: true,
      visible: false,
      ai: { instructions: "Section heading. 4–8 words." },
    },
    columns: {
      type: "select" as const,
      options: [
        { label: "2", value: "2" },
        { label: "3", value: "3" },
        { label: "4", value: "4" },
      ],
    },
    shape: {
      type: "radio" as const,
      options: [
        { label: "Circle", value: "circle" },
        { label: "Rounded", value: "rounded" },
      ],
    },
    tone: {
      type: "radio" as const,
      options: [
        { label: "White", value: "white" },
        { label: "Light", value: "light" },
      ],
    },
    members: {
      type: "array" as const,
      arrayFields: {
        name: {
          type: "text" as const,
          contentEditable: true,
          visible: false,
          ai: { instructions: "Team member's full name." },
        },
        role: {
          type: "text" as const,
          contentEditable: true,
          visible: false,
          ai: { instructions: "Job title. E.g. Head of Operations." },
        },
        avatar: {
          type: "text" as const,
          ai: { exclude: true },
        },
        bio: {
          type: "text" as const,
          contentEditable: true,
          visible: false,
          ai: { instructions: "1–2 sentence bio. Optional — leave blank to omit." },
        },
      },
      defaultItemProps: { name: "Team member", role: "Role", avatar: "", bio: "" },
      getItemSummary: (item: TeamMember) => item.name || "Member",
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
  render: TeamGridRender,
};
