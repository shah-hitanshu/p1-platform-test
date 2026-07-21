/**
 * Node module customization hooks that stub out non-JS asset imports
 * (CSS, images, fonts, video) so a plain Node script can `import()` a
 * Next.js app's puck.config.tsx without a bundler. Zero dependencies.
 *
 * Wire in with node:module's register() — not the --import flag, which
 * does not auto-install a resolve/load-only hooks file.
 */

const ASSET_EXTENSION_PATTERN =
  /\.(css|scss|sass|less|png|jpe?g|gif|svg|webp|ico|bmp|avif|woff2?|ttf|eot|otf|mp4|webm|mov|mp3|wav)$/i;

const ASSET_STUB_PROTOCOL = 'asset-stub:';

export async function resolve(specifier, context, nextResolve) {
  if (ASSET_EXTENSION_PATTERN.test(specifier)) {
    return {
      url: `${ASSET_STUB_PROTOCOL}${encodeURIComponent(specifier)}`,
      shortCircuit: true,
    };
  }
  return nextResolve(specifier, context);
}

export async function load(url, context, nextLoad) {
  if (url.startsWith(ASSET_STUB_PROTOCOL)) {
    return {
      format: 'module',
      source: 'export default {};',
      shortCircuit: true,
    };
  }
  return nextLoad(url, context);
}
