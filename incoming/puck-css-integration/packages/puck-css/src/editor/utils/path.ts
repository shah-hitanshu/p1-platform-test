/**
 * Convert a route path to a P1 document path.
 * "/" -> "home"
 * "/about" -> "about"
 * "/en/products" -> "en/products"
 */
function trimSlashes(value: string): string {
  let start = 0;
  let end = value.length;
  while (start < end && value[start] === '/') start++;
  while (end > start && value[end - 1] === '/') end--;
  return value.slice(start, end);
}

export function toP1Path(routePath: string): string {
  const cleaned = trimSlashes(routePath);
  return cleaned === '' ? 'home' : cleaned;
}
