import { wireframe } from './define-meta';

const ORIGIN = 'https://components.p1.pantheon.io';

export const P1_ASSETS = {
  LANDSCAPE: `${ORIGIN}/p1_placeholders/landscape.jpg`,
  AVATAR: `${ORIGIN}/p1_placeholders/avatar.jpg`,
  CARD_1: `${ORIGIN}/p1_placeholders/card-1.jpg`,
  CARD_2: `${ORIGIN}/p1_placeholders/card-2.jpg`,
  CARD_3: `${ORIGIN}/p1_placeholders/card-3.jpg`,
  GALLERY_1: `${ORIGIN}/p1_placeholders/gallery-1.jpg`,
  GALLERY_2: `${ORIGIN}/p1_placeholders/gallery-2.jpg`,
  GALLERY_3: `${ORIGIN}/p1_placeholders/gallery-3.jpg`,
  GALLERY_4: `${ORIGIN}/p1_placeholders/gallery-4.jpg`,
  GALLERY_5: `${ORIGIN}/p1_placeholders/gallery-5.jpg`,
  GALLERY_6: `${ORIGIN}/p1_placeholders/gallery-6.jpg`,
  IMAGE: `${ORIGIN}/p1_placeholders/image.jpg`,
  FIGURE: `${ORIGIN}/p1_placeholders/figure.jpg`,
  HERO: `${ORIGIN}/p1_placeholders/hero.jpg`,
  FEATURE_MEDIA: `${ORIGIN}/p1_placeholders/feature-media.jpg`,
} as const;

// The P1 mark for logo-cloud samples. It is the header logo SVG, so it stays outside the .jpg-only P1_ASSETS.
export const P1_LOGO = `${ORIGIN}/images/p1_logo.svg`;

// Inline SVG stand-ins FallbackImg shows when the matching P1_ASSETS photo fails to load.
export const P1_FALLBACKS = {
  LANDSCAPE: wireframe(1200, 675),
  AVATAR: wireframe(300, 300),
  CARD_1: wireframe(1200, 675),
  CARD_2: wireframe(1200, 675),
  CARD_3: wireframe(1200, 675),
  GALLERY_1: wireframe(1200, 675),
  GALLERY_2: wireframe(1200, 675),
  GALLERY_3: wireframe(1200, 675),
  GALLERY_4: wireframe(1200, 675),
  GALLERY_5: wireframe(1200, 675),
  GALLERY_6: wireframe(1200, 675),
  IMAGE: wireframe(1200, 675),
  FIGURE: wireframe(1200, 675),
  HERO: wireframe(1200, 675),
  FEATURE_MEDIA: wireframe(1200, 675),
} as const;
