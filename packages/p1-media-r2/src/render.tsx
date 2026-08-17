// Render-side helpers. Server-safe (no React context, no client-only hooks) so
// they can be imported from RSC via the package's "react-server" export.
import type { ImgHTMLAttributes, ReactElement } from "react";
import type {
  MediaFieldValue,
  MediaProps,
  MetadataFieldDef,
} from "./types";
import { isMediaValue, STRUCTURAL_MEDIA_KEYS } from "./media-value";
import { buildImageUrl, type ImageTransformParams } from "./utils";

export interface GetMediaPropsOptions {
  /**
   * The CDN image origin that serves media, e.g.
   * "https://staging.media.p1.pantheon.io". This is the public image host —
   * NOT the Worker API URL (`…workers.dev`), whose origin would reject every
   * real image URL.
   *
   * Security (required): a value's `url` is untrusted document content — anyone
   * who can edit a document, or call the CCR `/edits` API, controls it. Without
   * an origin check a crafted `https://evil.example/beacon.png` turns every
   * published render into a visitor-IP exfil beacon (and an SSRF under
   * server-fetching `next/image`). getMediaProps therefore rejects any url that
   * is not `https` on this exact origin. If `mediaBaseUrl` is omitted it
   * **fails closed** (empty src) rather than degrading to an insecure pass-through.
   *
   * Local dev exception: when the configured base is itself `http` on a
   * loopback host (`localhost`, `127.0.0.1`, `[::1]` — a local `wrangler dev`
   * worker), same-origin `http` urls are allowed so rich values render locally.
   */
  mediaBaseUrl?: string;
  /** Transform params merged onto the validated URL (width, height, format, quality). */
  transform?: ImageTransformParams;
}

// Hosts where an http mediaBaseUrl is honored (local `wrangler dev`). Exact
// hostnames only — no *.localhost subdomains.
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * Returns the url only if it is on the configured CDN origin AND https —
 * except that an http origin is honored when the configured mediaBaseUrl is
 * itself http on a loopback host (local dev against `wrangler dev`, which
 * serves plain http). Production is unaffected: real CDN bases are https, so
 * every http url still fails the origin check. Otherwise "". Fails closed
 * when no origin is configured (see GetMediaPropsOptions).
 */
function validateSrc(url: string, mediaBaseUrl?: string): string {
  if (!url || !mediaBaseUrl) return "";
  let parsed: URL;
  let base: URL;
  try {
    parsed = new URL(url);
    base = new URL(mediaBaseUrl);
  } catch {
    return "";
  }
  if (parsed.origin !== base.origin) return "";
  if (parsed.protocol !== "https:") {
    // Non-https is allowed only as plain http against an explicitly-configured
    // local-dev loopback base. Checking parsed.protocol too keeps schemes whose
    // origin serializes to the base origin (blob:http://…) out of the carve-out.
    const isLocalDevBase = base.protocol === "http:" && LOOPBACK_HOSTS.has(base.hostname);
    if (!isLocalDevBase || parsed.protocol !== "http:") return "";
  }
  return url;
}

/**
 * Normalizes a `string | MediaValue | null` into `{ src, alt, width?, height? }`.
 * A string (basic mode) yields `alt: ""`. `src` is validated against the CDN
 * origin (see GetMediaPropsOptions) and empty on rejection.
 */
export function getMediaProps(
  value: MediaFieldValue | null | undefined,
  options?: GetMediaPropsOptions,
): MediaProps {
  const mediaBaseUrl = options?.mediaBaseUrl;
  const transform = options?.transform;

  const finalize = (rawUrl: string): string => {
    const validated = validateSrc(rawUrl, mediaBaseUrl);
    return validated && transform ? buildImageUrl(validated, transform) : validated;
  };

  if (value == null) return { src: "", alt: "" };

  if (typeof value === "string") {
    return { src: finalize(value), alt: "" };
  }

  const props: MediaProps = {
    src: finalize(typeof value.url === "string" ? value.url : ""),
    alt: typeof value.alt === "string" ? value.alt : "",
  };
  if (typeof value.width === "number") props.width = value.width;
  if (typeof value.height === "number") props.height = value.height;
  return props;
}

/**
 * Common-case `<img>` wrapper. Renders nothing when the src is rejected/empty
 * (a broken foreign-origin image is never emitted). `alt` may be overridden;
 * otherwise it comes from the value.
 */
export function MediaImage({
  image,
  mediaBaseUrl,
  transform,
  alt,
  loading = "lazy",
  decoding = "async",
  ...rest
}: {
  image: MediaFieldValue | null | undefined;
  mediaBaseUrl?: string;
  transform?: ImageTransformParams;
} & Omit<ImgHTMLAttributes<HTMLImageElement>, "src">): ReactElement | null {
  const props = getMediaProps(image, { mediaBaseUrl, transform });
  if (!props.src) return null;
  return (
    <img
      src={props.src}
      alt={alt ?? props.alt}
      loading={loading}
      decoding={decoding}
      {...(props.width !== undefined ? { width: props.width } : {})}
      {...(props.height !== undefined ? { height: props.height } : {})}
      {...rest}
    />
  );
}

/**
 * Collects the metadata fields a figure should render, generically (req. R14):
 * with a schema, iterate its entries (canonical order/labels); without one,
 * iterate the value's own string metadata keys. Either way a new backend text
 * field appears with no plugin release. `alt` (on the `<img>`) and non-text
 * values (width/height/metaSchemaVersion) are excluded from the caption.
 */
function collectFigureFields(
  image: MediaFieldValue | null | undefined,
  schema?: MetadataFieldDef[],
): { name: string; label?: string; value: string }[] {
  if (!isMediaValue(image)) return [];
  const out: { name: string; label?: string; value: string }[] = [];
  if (schema && schema.length > 0) {
    for (const entry of schema) {
      if (entry.name === "alt") continue;
      const raw = image[entry.name];
      if (raw === undefined || raw === "") continue;
      out.push({ name: entry.name, label: entry.label, value: String(raw) });
    }
  } else {
    for (const [k, v] of Object.entries(image)) {
      if (k === "alt") continue;
      if (STRUCTURAL_MEDIA_KEYS.has(k)) continue;
      if (typeof v !== "string" || v === "") continue;
      out.push({ name: k, value: v });
    }
  }
  return out;
}

/**
 * `<figure>` that renders the image plus the schema-advertised text fields as
 * ESCAPED text (React default escaping — never dangerouslySetInnerHTML, req.
 * R6). Renders nothing when the src is rejected/empty.
 */
export function MediaFigure({
  image,
  schema,
  mediaBaseUrl,
  transform,
  className,
  captionClassName,
  loading = "lazy",
  decoding = "async",
}: {
  image: MediaFieldValue | null | undefined;
  schema?: MetadataFieldDef[];
  mediaBaseUrl?: string;
  transform?: ImageTransformParams;
  className?: string;
  captionClassName?: string;
  /** Defaults to "lazy"; pass "eager" for an above-the-fold figure. */
  loading?: ImgHTMLAttributes<HTMLImageElement>["loading"];
  decoding?: ImgHTMLAttributes<HTMLImageElement>["decoding"];
}): ReactElement | null {
  const props = getMediaProps(image, { mediaBaseUrl, transform });
  if (!props.src) return null;

  const fields = collectFigureFields(image, schema);

  return (
    <figure className={className}>
      <img
        src={props.src}
        alt={props.alt}
        loading={loading}
        decoding={decoding}
        {...(props.width !== undefined ? { width: props.width } : {})}
        {...(props.height !== undefined ? { height: props.height } : {})}
      />
      {fields.length > 0 && (
        <figcaption className={captionClassName}>
          {fields.map((f) => (
            <span key={f.name} data-field={f.name}>
              {f.value}
            </span>
          ))}
        </figcaption>
      )}
    </figure>
  );
}
