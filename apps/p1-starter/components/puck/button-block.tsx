import { blockPaddingClass } from "./block-padding";

export const buttonBlock = {
  label: "Button",
  fields: {
    label: { type: "text" as const, label: "Label" },
    href: { type: "text" as const, label: "Link URL" },
    openInNewTab: {
      type: "radio" as const,
      label: "Open in new tab",
      options: [
        { label: "No", value: false },
        { label: "Yes", value: true },
      ],
    },
  },
  defaultProps: {
    label: "Learn more",
    href: "#",
    openInNewTab: false,
  },
  render: ({
    label,
    href,
    openInNewTab,
  }: {
    label?: string;
    href?: string;
    openInNewTab?: boolean;
  }) => (
    <div className={blockPaddingClass}>
      <a
        href={href || "#"}
        {...(openInNewTab ? { target: "_blank", rel: "noopener noreferrer" } : {})}
        className="inline-block rounded-lg bg-neutral-900 px-6 py-3 font-semibold text-white no-underline"
      >
        {label}
      </a>
    </div>
  ),
};
