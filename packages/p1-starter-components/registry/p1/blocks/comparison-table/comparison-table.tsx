import { Icon } from "@/registry/p1/internal/icons";
import "./comparison-table.css";

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
    case 0: return ROW_KEYS[0];
    case 1: return ROW_KEYS[1];
    case 2: return ROW_KEYS[2];
    default: return ROW_KEYS[3];
  }
}

const CMP_YES = ["yes", "true", "✓", "✔", "check", "included", "all", "y", "∞"];
const CMP_NO = ["no", "false", "✗", "✕", "x", "none", "n"];

function CmpCell({ v }: { v: string }) {
  const s = String(v == null ? "" : v).trim();
  const l = s.toLowerCase();
  if (s === "" || s === "-" || s === "—") return <span className="p1-comparison__dash">—</span>;
  if (CMP_YES.includes(l)) return <Icon name="check" strokeWidth={2.6} className="p1-comparison__check" />;
  if (CMP_NO.includes(l)) return <Icon name="x" strokeWidth={2.4} className="p1-comparison__cross" />;
  return <span className="p1-comparison__val">{s}</span>;
}

export function ComparisonTableRender({
  eyebrow,
  heading,
  subtitle,
  columns,
  featured,
  rows,
}: ComparisonTableProps) {
  const plans = splitLines(columns).slice(0, 4);
  const hot = ({ none: -1, "1": 0, "2": 1, "3": 2, "4": 3 } as Record<string, number>)[featured] ?? -1;

  return (
    <div className="p1-comparison-table p1-block">
      <div className="p1-comparison__inner">
        <div className="p1-comparison__header">
          {eyebrow && <p className="p1-comparison__eyebrow">{eyebrow}</p>}
          {heading && <h2 className="p1-comparison__heading">{heading}</h2>}
          {subtitle && <p className="p1-comparison__subtitle">{subtitle}</p>}
        </div>

        <div className="p1-comparison__table-wrap">
          <table className="p1-comparison__table">
            <thead>
              <tr>
                <th className="p1-comparison__feature-col">Features</th>
                {plans.map((pl, i) => (
                  <th key={i} className="p1-comparison__col-head" data-hot={i === hot ? "true" : undefined}>
                    {pl}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(rows || []).map((row, ri) => (
                <tr key={ri}>
                  <td className="p1-comparison__row-label">{row.feature}</td>
                  {plans.map((_, ci) => (
                    <td key={ci} className="p1-comparison__cell" data-hot={ci === hot ? "true" : undefined}>
                      <CmpCell v={row[rowKeyFor(ci)]} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="p1-comparison__cards">
          {plans.map((pl, ci) => (
            <div key={ci} className="p1-comparison__card" data-hot={ci === hot ? "true" : undefined}>
              <div className="p1-comparison__card-head">{pl}</div>
              {(rows || []).map((row, ri) => (
                <div key={ri} className="p1-comparison__card-row">
                  <span className="p1-comparison__card-label">{row.feature}</span>
                  <span className="p1-comparison__card-val">
                    <CmpCell v={row[rowKeyFor(ci)]} />
                  </span>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
