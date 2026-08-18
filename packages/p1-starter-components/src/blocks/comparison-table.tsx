import type { ComponentConfig } from "@puckeditor/core";
import { Icon } from "../internal/icons";

export interface ComparisonRow {
  feature: string;
  c1: string;
  c2: string;
  c3: string;
  c4: string;
}
export interface ComparisonTableProps {
  eyebrow: string;
  heading: string;
  subtitle: string;
  columns: string;
  featured: "none" | "1" | "2" | "3" | "4";
  rows: ComparisonRow[];
}

const splitLines = (s: string) =>
  String(s || "")
    .split("\n")
    .map((x) => x.trim())
    .filter(Boolean);

const ROW_KEYS = ["c1", "c2", "c3", "c4"] as const satisfies readonly (keyof ComparisonRow)[];
function rowKeyFor(ci: number): keyof ComparisonRow {
  switch (ci) {
    case 0:
      return ROW_KEYS[0];
    case 1:
      return ROW_KEYS[1];
    case 2:
      return ROW_KEYS[2];
    default:
      return ROW_KEYS[3];
  }
}

const CMP_YES = ["yes", "true", "✓", "✔", "check", "included", "all", "y", "∞"];
const CMP_NO = ["no", "false", "✗", "✕", "x", "none", "n"];

const CmpCell = ({ v, hot }: { v: string; hot: boolean }) => {
  const s = String(v == null ? "" : v).trim();
  const l = s.toLowerCase();
  if (s === "" || s === "-" || s === "—") return <span className="text-p1-border">—</span>;
  if (CMP_YES.includes(l))
    return <Icon name="check" strokeWidth={2.6} className={`mx-auto h-5 w-5 ${hot ? "text-p1-primary" : "text-p1-success"}`} />;
  if (CMP_NO.includes(l)) return <Icon name="x" strokeWidth={2.4} className="mx-auto h-[18px] w-[18px] text-p1-border" />;
  return <span className="text-sm font-semibold text-p1-text">{s}</span>;
};

export const ComparisonTableBlock: ComponentConfig<ComparisonTableProps> = {
  fields: {
    eyebrow: { type: "text", contentEditable: true, visible: false },
    heading: { type: "text", contentEditable: true, visible: false },
    subtitle: { type: "text", contentEditable: true, visible: false },
    columns: { type: "textarea" },
    featured: {
      type: "select",
      options: [
        { label: "None", value: "none" },
        { label: "Column 1", value: "1" },
        { label: "Column 2", value: "2" },
        { label: "Column 3", value: "3" },
        { label: "Column 4", value: "4" },
      ],
    },
    rows: {
      type: "array",
      arrayFields: {
        feature: { type: "text", contentEditable: true, visible: false },
        c1: { type: "text" },
        c2: { type: "text" },
        c3: { type: "text" },
        c4: { type: "text" },
      },
      defaultItemProps: { feature: "Feature", c1: "yes", c2: "yes", c3: "yes", c4: "" },
      getItemSummary: (item) => item.feature || "Feature",
    },
  },
  defaultProps: {
    eyebrow: "Compare",
    heading: "Find the plan that fits.",
    subtitle: "Every plan includes the core WebOps workflow.",
    columns: "Starter\nTeam\nEnterprise",
    featured: "2",
    rows: [
      { feature: "Projects", c1: "1", c2: "10", c3: "Unlimited", c4: "" },
      { feature: "Multidev environments", c1: "no", c2: "yes", c3: "yes", c4: "" },
      { feature: "Role-based access", c1: "no", c2: "yes", c3: "yes", c4: "" },
      { feature: "SSO & audit logs", c1: "no", c2: "no", c3: "yes", c4: "" },
      { feature: "Support", c1: "Community", c2: "Priority", c3: "Dedicated CSM", c4: "" },
    ],
  },
  render: ({ eyebrow, heading, subtitle, columns, featured, rows }) => {
    const plans = splitLines(columns).slice(0, 4);
    const hot = ({ none: -1, "1": 0, "2": 1, "3": 2, "4": 3 } as Record<string, number>)[featured] ?? -1;
    return (
      <div className="bg-p1-bg-default px-p1-lg py-p1-xl">
        <div className="mx-auto max-w-6xl">
          <div className="mb-p1-xl text-center">
            {eyebrow && <p className="mb-p1-sm font-serif text-xl italic text-p1-primary">{eyebrow}</p>}
            {heading && <h2 className="text-3xl font-bold tracking-tight text-p1-text md:text-4xl">{heading}</h2>}
            {subtitle && <p className="mt-p1-sm text-p1-text-muted">{subtitle}</p>}
          </div>

          {/* Table — wide screens */}
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full table-fixed border-separate border-spacing-0">
              <thead>
                <tr>
                  <th className="w-[34%] p-p1-md text-left align-bottom text-xs font-bold uppercase tracking-[0.04em] text-p1-text-muted">
                    Features
                  </th>
                  {plans.map((pl, i) => {
                    const isHot = i === hot;
                    return (
                      <th
                        key={i}
                        className={`p-p1-md text-center text-lg font-bold ${
                          isHot
                            ? "rounded-t-p1-md bg-p1-primary text-white"
                            : "border-b-2 border-p1-border text-p1-text"
                        }`}
                      >
                        {pl}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {(rows || []).map((row, ri) => (
                  <tr key={ri}>
                    <td className="border-b border-gray-100 p-p1-md text-[15px] font-semibold text-p1-text">
                      {row.feature}
                    </td>
                    {plans.map((_, ci) => {
                      const isHot = ci === hot;
                      return (
                        <td
                          key={ci}
                          className={`border-b border-gray-100 p-p1-md text-center ${isHot ? "bg-p1-primary/5" : ""}`}
                        >
                          <CmpCell v={row[rowKeyFor(ci)]} hot={isHot} />
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Stacked cards — narrow screens */}
          <div className="grid gap-p1-md md:hidden">
            {plans.map((pl, ci) => {
              const isHot = ci === hot;
              return (
                <div
                  key={ci}
                  className={`overflow-hidden rounded-p1-md ${
                    isHot ? "border-2 border-p1-primary" : "border border-p1-border"
                  }`}
                >
                  <div
                    className={`p-p1-md text-lg font-bold ${
                      isHot ? "bg-p1-primary text-white" : "bg-gray-50 text-p1-text"
                    }`}
                  >
                    {pl}
                  </div>
                  {(rows || []).map((row, ri) => (
                    <div
                      key={ri}
                      className="flex items-center justify-between gap-p1-sm border-t border-gray-100 px-p1-md py-p1-sm"
                    >
                      <span className="text-sm text-p1-text-muted">{row.feature}</span>
                      <span className="flex-none">
                        <CmpCell v={row[rowKeyFor(ci)]} hot={isHot} />
                      </span>
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  },
};
