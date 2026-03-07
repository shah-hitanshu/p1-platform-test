/**
 * Convert a route path to a CSS document path.
 * "/" -> "home"
 * "/about" -> "about"
 * "/en/products" -> "en/products"
 */
export function toCSSPath(routePath: string): string {
  const cleaned = routePath.replace(/^\/+/, '').replace(/\/+$/, '');
  return cleaned === '' ? 'home' : cleaned;
}
