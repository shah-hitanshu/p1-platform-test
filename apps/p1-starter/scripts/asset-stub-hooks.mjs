/**
 * Node module customization hooks that stub out non-JS asset imports
 * (CSS, images, fonts, video) so a plain Node script can `import()` a
 * Next.js app's puck.config.tsx without a bundler. Zero dependencies.
 *
 * Wire in with node:module's register() — not the --import flag, which
 * does not auto-install a resolve/load-only hooks file.
 *
 * The stub is a *branded* sentinel, not a bare {}: the browser bundler
 * resolves these same imports to real URLs/StaticImageData that this script
 * cannot compute. The brand (`__p1AssetStub`) and the marker string (returned
 * for every property read, so `placeholder.src` stays detectable) let the
 * sync filter recognize and skip such components instead of writing wrong
 * descriptor content and a hash the editor will forever disagree with.
 */

const ASSET_EXTENSION_PATTERN =
  /\.(css|scss|sass|less|png|jpe?g|gif|svg|webp|ico|bmp|avif|woff2?|ttf|eot|otf|mp4|webm|mov|mp3|wav)$/i;

const ASSET_STUB_PROTOCOL = 'asset-stub:';

export const ASSET_STUB_MARKER = '__p1_asset_stub__';

// The get trap resolves every unknown property (including well-known symbols)
// to the marker string, so exotic usage of a stub (spread, iteration) throws
// during extraction — deliberately loud, rather than silently producing
// garbage.
const ASSET_STUB_SOURCE = `
const target = {
  __p1AssetStub: true,
  toString: () => '${ASSET_STUB_MARKER}',
  [Symbol.toPrimitive]: () => '${ASSET_STUB_MARKER}',
};
export default new Proxy(target, {
  get: (t, prop) => (prop in t ? t[prop] : '${ASSET_STUB_MARKER}'),
});
`;

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
      source: ASSET_STUB_SOURCE,
      shortCircuit: true,
    };
  }
  return nextLoad(url, context);
}
