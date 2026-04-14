import { blockPaddingClass } from "./block-padding";
import ReactMarkdown from "react-markdown";

function asMarkdownText(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
}

export const paragraphBlock = {
  label: "Paragraph",
  fields: {
    text: {
      type: "textarea" as const,
      label: "Text",
      contentEditable: true,
    },
  },
  defaultProps: {
    text: "Add your copy here. You can use multiple lines.",
  },
  render: ({ text }: { text?: string }) => {
    const markdown = asMarkdownText(text);
    return (
      <div className={blockPaddingClass}>
        <ReactMarkdown
          components={{
            p: ({ children }) => <p className="m-0 max-w-prose leading-relaxed">{children}</p>,
            a: ({ href, children }) => (
              <a
                href={href}
                className="text-blue-700 underline decoration-blue-700/40 underline-offset-2 hover:decoration-blue-700"
              >
                {children}
              </a>
            ),
          }}
        >
          {markdown}
        </ReactMarkdown>
      </div>
    );
  },
};
