// Server-safe entry point — no React context, safe for RSC.
// Next.js resolves this via the "react-server" exports condition.
export { buildImageUrl } from "./utils";
export type { ImageTransformParams } from "./utils";
export { getMediaProps, MediaImage, MediaFigure } from "./render";
export type { GetMediaPropsOptions } from "./render";
export { createMediaFigureBlock } from "./media-figure-block";
export type { MediaFigureBlockOptions, MediaFigureBlockProps } from "./media-figure-block";
export { makeMediaValue, isMediaValue } from "./media-value";
export type {
  MediaValue,
  MediaFieldValue,
  MediaProps,
  MetadataFieldDef,
} from "./types";
