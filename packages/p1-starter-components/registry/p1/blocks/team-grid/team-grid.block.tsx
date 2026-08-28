import type { ComponentConfig } from "@puckeditor/core";
import { defineMeta, wireframe } from '../define-meta';
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
      { name: "Jordan Ellis", role: "Head of Operations", avatar: wireframe(300, 300), bio: "" },
      { name: "Sam Rivera", role: "Principal Engineer", avatar: wireframe(300, 300), bio: "" },
      { name: "Priya Nair", role: "Design Lead", avatar: wireframe(300, 300), bio: "" },
    ],
  },
  render: TeamGridRender,
};

export const meta = defineMeta({
  title: 'Team Grid',
  description: 'Grid of team member cards with avatar, name, role, and bio in circle or rounded photo shape; use for About/Team pages.',
  categories: ["trust"],
  published: true,
});
