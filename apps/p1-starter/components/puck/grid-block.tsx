import { blockPaddingClass } from "./block-padding";
import { Connectable, type ConnectedItem } from "@pantheon-systems/puck-css/connectable";

function CardGrid({
  title,
  items,
}: {
  title?: string;
  items: ConnectedItem[];
}) {
  return (
    <section className={blockPaddingClass}>
      {title ? (
        <h2 className="m-0 mb-4 text-2xl font-semibold">{title}</h2>
      ) : null}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3">
        {items.map((item, index) => {
          const id = String(item.id ?? "").trim();
          const className =
            "rounded-lg border border-slate-200 bg-white p-4 shadow-sm transition hover:border-blue-400 hover:shadow-md";
          if (item._href) {
            return (
              <a
                key={`${id}-${index}`}
                href={item._href}
                className={`${className} no-underline`}
              >
                <div className="text-sm text-slate-500">
                  {id ? `#${id}` : "No ID"}
                </div>
                <div className="mt-1 text-base font-semibold text-slate-900">
                  {item._title}
                </div>
              </a>
            );
          }
          return (
            <div key={`${id}-${index}`} className={className}>
              <div className="text-sm text-slate-500">
                {id ? `#${id}` : "No ID"}
              </div>
              <div className="mt-1 text-base font-semibold text-slate-900">
                {item._title}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

const ConnectableCardGrid = Connectable(CardGrid);

export const gridBlock = {
  label: "Card Grid",
  fields: {
    title: { type: "text" as const, label: "Heading" },
    items: {
      type: "textarea" as const,
      label: "Items datasource (e.g. {{ swapi_list.items }})",
    },
    min: { type: "number" as const, label: "Min cards" },
    max: { type: "number" as const, label: "Max cards" },
    itemTitleTemplate: { type: "text" as const, label: "Item title template" },
    itemUrlTemplate: {
      type: "text" as const,
      label: "Optional item URL template (e.g. /jedi/{id} or {{ item.url }})",
    },
  },
  defaultProps: {
    title: "Cards",
    items: "{{ swapi_list.items }}",
    min: 1,
    max: 12,
    itemTitleTemplate: "title is {{ item.name }}",
    itemUrlTemplate: "/jedi/{id}",
  },
  render: ConnectableCardGrid,
};
