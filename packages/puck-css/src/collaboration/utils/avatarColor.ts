function hashString(str: string): number {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 33) ^ str.charCodeAt(i);
  }
  return hash >>> 0;
}

/**
 * Returns a stable HSL color string for a given user/actor ID.
 */
export function getAvatarColor(id: string | undefined | null): string {
  const hue = hashString(id ?? '') % 360;
  return `hsl(${hue}, 65%, 45%)`;
}
