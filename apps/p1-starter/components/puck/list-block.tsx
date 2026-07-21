import { blockPaddingClass } from "./block-padding";

/** One line = `[label](href)` (from `{{ swapi_list.markdownLinks }}` or arg form) or plain text. */
const MARKDOWN_LINK_LINE = /^\[([^\]]*)\]\(([^)]+)\)$/;

export const listBlock = {
  label: "List",
  fields: {
    ordered: {
      type: "radio" as const,
      label: "Style",
      options: [
        { label: "Bulleted", value: false },
        { label: "Numbered", value: true },
      ],
    },
    items: {
      type: "textarea" as const,
      label: "Items (one per line)",
    },
  },
  defaultProps: {
    ordered: false,
    items: "First item\nSecond item\nThird item",
  },
  render: ({ ordered, items }: { ordered?: boolean; items?: string }) => {
    const lines = (items || "")
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
    const ListTag = ordered ? "ol" : "ul";
    const listClass = ordered ? "list-decimal" : "list-disc";
    return (
      <div className={blockPaddingClass}>
        <ListTag className={`m-0 max-w-prose space-y-1 pl-6 leading-relaxed ${listClass}`}>
          {lines.map((line, i) => {
            const m = line.match(MARKDOWN_LINK_LINE);
            if (m) {
              const href = m[2];
              const safe =
                href.startsWith("/") ||
                href.startsWith("./") ||
                /^https?:\/\//i.test(href);
              if (!safe) {
                return (
                  <li key={i} className="break-words">
                    {line}
                  </li>
                );
              }
              return (
                <li key={i} className="break-words">
                  <a
                    href={href}
                    className="text-blue-700 underline decoration-blue-700/40 underline-offset-2 hover:decoration-blue-700"
                  >
                    {m[1]}
                  </a>
                </li>
              );
            }
            return (
              <li key={i} className="break-words">
                {line}
              </li>
            );
          })}
        </ListTag>
      </div>
    );
  },
};
