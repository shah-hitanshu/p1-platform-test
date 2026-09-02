import { blockPaddingClass } from "./block-padding";

export const imageBlock = {
  label: "Image",
  fields: {
    src: { type: "text" as const, label: "Image URL" },
    alt: { type: "text" as const, label: "Alt text" },
    caption: { type: "textarea" as const, label: "Caption (optional)" },
    loading: {
      type: "radio" as const,
      label: "Loading",
      options: [
        { label: "Lazy", value: "lazy" },
        { label: "Eager", value: "eager" },
      ],
    },
  },
  defaultProps: {
    // Placeholder art inline as a data URI, so a fresh block loads nothing off
    // the network. Authors replace it with their own image.
    src:
      "data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%221200%22%20height%3D%22675%22%20viewBox%3D%220%200%201200%20675%22%3E%3Crect%20width%3D%221200%22%20height%3D%22675%22%20fill%3D%22%23f1f1f3%22%2F%3E%3Cpath%20d%3D%22M0%20675L1200%200%22%20stroke%3D%22%23c8c8ce%22%20stroke-width%3D%2284%22%2F%3E%3C%2Fsvg%3E",
    alt: "",
    caption: "",
    loading: "lazy",
  },
  render: ({
    src,
    alt,
    caption,
    loading,
  }: {
    src?: string;
    alt?: string;
    caption?: string;
    loading?: "lazy" | "eager";
  }) => (
    <figure className={`m-0 ${blockPaddingClass}`}>
      {src ? (
        <img
          src={src}
          alt={alt || ""}
          loading={loading === "eager" ? "eager" : "lazy"}
          decoding="async"
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
