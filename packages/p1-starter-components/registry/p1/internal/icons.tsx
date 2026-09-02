import * as React from "react";

/**
 * Minimal stroke-based icon set used by the new block pack.
 * Icons are monochromatic and inherit `currentColor` (PDS convention).
 * This is a shared utility — it is NOT a Puck block and is not exported
 * from `index.ts`.
 */
export type IconName =
  | "check"
  | "plus"
  | "x"
  | "chevron-down"
  | "chevron-left"
  | "chevron-right"
  | "search"
  | "menu"
  | "arrow-right"
  | "globe"
  | "mail"
  | "external"
  | "chat"
  | "info"
  | "lightbulb"
  | "warning"
  | "lines"
  | "user"
  | "map-pin";

const PATHS: Record<IconName, React.ReactNode> = {
  check: <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />,
  plus: <path strokeLinecap="round" strokeLinejoin="round" d="M12 5v14M5 12h14" />,
  x: <path strokeLinecap="round" strokeLinejoin="round" d="M6 6l12 12M18 6L6 18" />,
  "chevron-down": <path strokeLinecap="round" strokeLinejoin="round" d="M6 9l6 6 6-6" />,
  "chevron-left": <path strokeLinecap="round" strokeLinejoin="round" d="M15 6l-6 6 6 6" />,
  "chevron-right": <path strokeLinecap="round" strokeLinejoin="round" d="M9 6l6 6-6 6" />,
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path strokeLinecap="round" d="M21 21l-4.3-4.3" />
    </>
  ),
  menu: <path strokeLinecap="round" d="M4 7h16M4 12h16M4 17h16" />,
  "arrow-right": <path strokeLinecap="round" strokeLinejoin="round" d="M5 12h14M13 6l6 6-6 6" />,
  globe: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3c2.5 2.5 2.5 15 0 18M12 3c-2.5 2.5-2.5 15 0 18" />
    </>
  ),
  mail: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 7l9 6 9-6" />
    </>
  ),
  external: (
    <>
      <path strokeLinecap="round" strokeLinejoin="round" d="M14 5h5v5" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M19 5l-8 8" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M19 13v6H5V5h6" />
    </>
  ),
  chat: (
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M21 12a8 8 0 01-11.5 7.2L4 21l1.8-5.5A8 8 0 1121 12z"
    />
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path strokeLinecap="round" d="M12 11v5" />
      <path strokeLinecap="round" d="M12 8h.01" />
    </>
  ),
  lightbulb: (
    <>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 18h6M10 21h4" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 3a6 6 0 00-3.6 10.8c.6.5.9 1.2.9 2.2h5.4c0-1 .3-1.7.9-2.2A6 6 0 0012 3z" />
    </>
  ),
  warning: (
    <>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4l9 16H3l9-16z" />
      <path strokeLinecap="round" d="M12 10v4" />
      <path strokeLinecap="round" d="M12 17h.01" />
    </>
  ),
  lines: <path strokeLinecap="round" d="M5 7h14M5 12h14M5 17h9" />,
  user: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path strokeLinecap="round" d="M5 21a7 7 0 0114 0" />
    </>
  ),
  "map-pin": (
    <>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 21s7-6 7-11a7 7 0 10-14 0c0 5 7 11 7 11z" />
      <circle cx="12" cy="10" r="2.5" />
    </>
  ),
};

export interface IconProps {
  name: IconName;
  className?: string;
  strokeWidth?: number;
}

export function Icon({ name, className, strokeWidth = 2 }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      aria-hidden="true"
    >
      {PATHS[name]}
    </svg>
  );
}
