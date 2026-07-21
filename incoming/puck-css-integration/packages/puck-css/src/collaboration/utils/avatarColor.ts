import type React from 'react';

function hashString(str: string): number {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 33) ^ str.charCodeAt(i);
  }
  return hash >>> 0;
}

/** Returns a stable HSL color string for a given user/actor ID. */
export function getAvatarColor(id: string): string {
  const hue = hashString(id) % 360;
  return `hsl(${hue}, 65%, 45%)`;
}

/**
 * Returns a React style object that overrides all PDS Avatar gradient CSS custom
 * properties with our stable per-user color. PDS Avatar v2 picks one of 16
 * --pds-gradient-avatar-* variables based on uniqueId; overriding all of them
 * ensures our color wins regardless of which the component selects.
 */
export function getAvatarStyleOverride(id: string): React.CSSProperties {
  const color = getAvatarColor(id);
  // PDS Avatar uses background-image, so the value must be a valid <image> type.
  const gradient = `linear-gradient(${color}, ${color})`;
  return {
    '--pds-gradient-avatar-midnight': gradient,
    '--pds-gradient-avatar-twilight': gradient,
    '--pds-gradient-avatar-sunrise': gradient,
    '--pds-gradient-avatar-dawn': gradient,
    '--pds-gradient-avatar-sundown': gradient,
    '--pds-gradient-avatar-dusk': gradient,
    '--pds-gradient-avatar-plum': gradient,
    '--pds-gradient-avatar-grape': gradient,
    '--pds-gradient-avatar-dragonfruit': gradient,
    '--pds-gradient-avatar-winter': gradient,
    '--pds-gradient-avatar-spring': gradient,
    '--pds-gradient-avatar-summer': gradient,
    '--pds-gradient-avatar-fall': gradient,
    '--pds-gradient-avatar-earth': gradient,
    '--pds-gradient-avatar-moon': gradient,
    '--pds-gradient-avatar-sun': gradient,
  } as React.CSSProperties;
}
