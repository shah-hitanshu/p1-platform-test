import { wireframe } from './define-meta';

const ORIGIN = 'https://components.p1.pantheon.io';

export const P1_ASSETS = {
  LANDSCAPE: `${ORIGIN}/p1_placeholders/landscape.jpg`,
  AVATAR: `${ORIGIN}/p1_placeholders/avatar.jpg`,
} as const;

// Inline SVG stand-ins FallbackImg shows when the matching P1_ASSETS photo fails to load.
export const P1_FALLBACKS = {
  LANDSCAPE: wireframe(1200, 675),
  AVATAR: wireframe(300, 300),
} as const;
