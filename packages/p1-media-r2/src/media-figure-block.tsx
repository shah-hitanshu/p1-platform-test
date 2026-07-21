// Ready-made Puck component for the rich `p1-media` field. Server-safe (no
// hooks, no context) so it can be registered in configs that render via RSC.
import type { CSSProperties, ReactElement, ReactNode } from "react";
import type { ComponentConfig, Field } from "@puckeditor/core";
import { getMediaProps, MediaFigure } from "./render";
import type { ImageTransformParams } from "./utils";
import type { MediaFieldValue, MetadataFieldDef } from "./types";

export interface MediaFigureBlockProps {
  photo: MediaFieldValue | null;
}

export interface MediaFigureBlockOptions {
  /**
   * The CDN image origin (e.g. "https://media.p1.pantheon.io") used to
   * validate value URLs — NOT the Worker API URL. See GetMediaPropsOptions.
   */
  mediaBaseUrl: string;
  /**
   * Render-time transform. Include BOTH width and height — the editor's crop
   * intent only changes the output when there is a target aspect ratio.
   * Defaults to `{ width: 1200, height: 630, format: "auto" }`.
   */
  transform?: ImageTransformParams;
  /** Component label in the Puck sidebar. Defaults to "Media Figure". */
  label?: string;
  /** Label of the media field. Defaults to "Photo". */
  fieldLabel?: string;
  /** Metadata schema passed to MediaFigure — pins figcaption field order/labels. */
  schema?: MetadataFieldDef[];
  className?: string;
  captionClassName?: string;
  /** Rendered when no photo is chosen (or its URL fails origin validation). */
  placeholder?: ReactNode;
}

const DEFAULT_TRANSFORM: ImageTransformParams = { width: 1200, height: 630, format: "auto" };

const placeholderStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  minHeight: "200px",
  borderRadius: "8px",
  backgroundColor: "#e5e5e5",
  color: "#525252",
  fontSize: "14px",
};

/**
 * Builds a registerable Puck component around the rich `p1-media` field and
 * `MediaFigure`. Spares consumers the custom-field-type cast and the
 * width+height transform pitfall:
 *
 * ```tsx
 * const config = {
 *   components: {
 *     MediaFigureBlock: createMediaFigureBlock({ mediaBaseUrl: MEDIA_BASE }),
 *   },
 * };
 * ```
 */
export function createMediaFigureBlock(
  options: MediaFigureBlockOptions,
): ComponentConfig<MediaFigureBlockProps> {
  const {
    mediaBaseUrl,
    transform = DEFAULT_TRANSFORM,
    label = "Media Figure",
    fieldLabel = "Photo",
    schema,
    className,
    captionClassName,
    placeholder = "Choose a photo from the media library",
  } = options;

  return {
    label,
    fields: {
      // `p1-media` is registered by createMediaPlugin via overrides.fieldTypes,
      // so it is not part of Puck's built-in Field union.
      photo: { type: "p1-media", label: fieldLabel } as unknown as Field,
    },
    defaultProps: {
      photo: null,
    },
    render: ({ photo }: MediaFigureBlockProps): ReactElement => {
      const { src } = getMediaProps(photo ?? null, { mediaBaseUrl });
      if (!src) {
        return <div style={placeholderStyle}>{placeholder}</div>;
      }
      return (
        <MediaFigure
          image={photo ?? null}
          mediaBaseUrl={mediaBaseUrl}
          transform={transform}
          schema={schema}
          className={className}
          captionClassName={captionClassName}
        />
      );
    },
  };
}
