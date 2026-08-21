import type { ComponentConfig } from "@puckeditor/core";

export interface CardGridItem {
  title: string;
  subtitle: string;
  imageUrl: string;
}
export interface CardGridProps {
  heading: string;
  columns: "2" | "3" | "4";
  items: CardGridItem[];
}

const COL_CLASS: Record<CardGridProps["columns"], string> = {
  "2": "sm:grid-cols-2",
  "3": "sm:grid-cols-2 lg:grid-cols-3",
  "4": "sm:grid-cols-2 lg:grid-cols-4",
};

export const CardGridBlock: ComponentConfig<CardGridProps> = {
  fields: {
    heading: { type: "text", contentEditable: true, visible: false },
    columns: {
      type: "select",
      options: [
        { label: "2", value: "2" },
        { label: "3", value: "3" },
        { label: "4", value: "4" },
      ],
    },
    items: {
      type: "array",
      arrayFields: {
        title: { type: "text", contentEditable: true, visible: false },
        subtitle: { type: "text", contentEditable: true, visible: false },
        imageUrl: { type: "text" },
      },
      defaultItemProps: {
        title: "Company",
        subtitle: "Industry · Result",
        imageUrl: "https://images.unsplash.com/photo-1521737604893-d14cc237f11d?w=600&q=80",
      },
      getItemSummary: (item) => item.title || "Card",
    },
  },
  defaultProps: {
    heading: "Customer stories",
    columns: "3",
    items: [
      { title: "Northwind", subtitle: "Retail · 38% faster launches", imageUrl: "https://images.unsplash.com/photo-1556742049-0cfed4f6a45d?w=600&q=80" },
      { title: "Atlas Media", subtitle: "Publishing · 2M monthly reads", imageUrl: "https://images.unsplash.com/photo-1499750310107-5fef28a66643?w=600&q=80" },
      { title: "Brightline", subtitle: "SaaS · 4.9/5 satisfaction", imageUrl: "https://images.unsplash.com/photo-1551434678-e076c223a692?w=600&q=80" },
    ],
  },
  render: ({ heading, columns, items }) => (
    <div className="mx-auto max-w-7xl px-p1-lg py-p1-xl">
      {heading && (
        <h3 className="mb-p1-xl text-center text-3xl font-bold tracking-tight text-p1-text">{heading}</h3>
      )}
      <div className={`grid grid-cols-1 gap-p1-md ${COL_CLASS[columns]}`}>
        {(items || []).map((item, i) => (
          <div key={i} className="overflow-hidden rounded-p1-lg border border-p1-border bg-p1-bg-default shadow-sm">
            {item.imageUrl && (
              <div className="aspect-[4/3] overflow-hidden bg-gray-100">
                <img src={item.imageUrl} alt="" className="h-full w-full object-cover" />
              </div>
            )}
            <div className="p-p1-md">
              <div className="text-lg font-bold leading-snug text-p1-text">{item.title}</div>
              <div className="mt-1 text-sm text-p1-text-muted">{item.subtitle}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  ),
};
