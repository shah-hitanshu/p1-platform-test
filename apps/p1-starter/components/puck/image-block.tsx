import { blockPaddingClass } from "./block-padding";

export const imageBlock = {
  label: "Image",
  fields: {
    src: { type: "text" as const, label: "Image URL" },
    alt: { type: "text" as const, label: "Alt text" },
    caption: { type: "textarea" as const, label: "Caption (optional)" },
  },
  defaultProps: {
    src: "https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=1200&q=80",
    alt: "Mountain landscape",
    caption: "",
  },
  render: ({ src, alt, caption }: { src?: string; alt?: string; caption?: string }) => (
    <figure className={`m-0 ${blockPaddingClass}`}>
      {src ? (
        <img
          src={src}
          alt={alt || ""}
          className="block h-auto max-h-[400px] w-full max-w-4xl rounded-lg object-contain"
        />
      ) : (
        <div className="flex max-h-[400px] min-h-[200px] max-w-4xl items-center justify-center rounded-lg bg-neutral-200 text-neutral-600">
          Add an image URL
        </div>
      )}
      {caption ? (
        <figcaption className="mt-3 max-w-4xl text-sm text-neutral-600">{caption}</figcaption>
      ) : null}
    </figure>
  ),
};
