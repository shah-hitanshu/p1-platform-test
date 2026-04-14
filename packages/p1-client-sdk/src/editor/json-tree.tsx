"use client";

import type { ReactNode } from "react";

import { mono, muted } from "../lib/styles";

export { mono, muted };

const stringColor = "var(--puck-color-rose-04, #be123c)";
const numberColor = "var(--puck-color-azure-04, #2563eb)";
const boolColor = "var(--puck-color-violet-04, #6d28d9)";

function JsonPrimitive({ value }: { value: string | number | boolean | null }) {
  if (value === null) {
    return <span style={{ ...muted, fontStyle: "italic" }}>null</span>;
  }
  if (typeof value === "string") {
    return <span style={{ color: stringColor }}>{JSON.stringify(value)}</span>;
  }
  if (typeof value === "number") {
    return <span style={{ color: numberColor }}>{value}</span>;
  }
  return <span style={{ color: boolColor }}>{String(value)}</span>;
}

function JsonTreeValue({
  name,
  value,
  depth,
}: {
  name: string | null;
  value: unknown;
  depth: number;
}): ReactNode {
  const pad = depth * 12;

  if (value === null || value === undefined) {
    return (
      <div style={{ paddingLeft: pad, ...mono, fontSize: 11, marginBottom: 2 }}>
        {name != null && (
          <>
            <span style={{ color: "var(--puck-color-grey-05, #4b5563)" }}>{name}</span>
            <span style={muted}>: </span>
          </>
        )}
        {value === null ? (
          <JsonPrimitive value={null} />
        ) : (
          <span style={{ ...muted, fontStyle: "italic" }}>undefined</span>
        )}
      </div>
    );
  }

  if (typeof value !== "object") {
    return (
      <div style={{ paddingLeft: pad, ...mono, fontSize: 11, marginBottom: 2 }}>
        {name != null && (
          <>
            <span style={{ color: "var(--puck-color-grey-05, #4b5563)" }}>{name}</span>
            <span style={muted}>: </span>
          </>
        )}
        <JsonPrimitive value={value as string | number | boolean} />
      </div>
    );
  }

  if (Array.isArray(value)) {
    if (value.length === 0) {
      return (
        <div style={{ paddingLeft: pad, ...mono, fontSize: 11, marginBottom: 2 }}>
          {name != null && (
            <>
              <span style={{ color: "var(--puck-color-grey-05, #4b5563)" }}>{name}</span>
              <span style={muted}>: </span>
            </>
          )}
          <span style={muted}>[]</span>
        </div>
      );
    }
    return (
      <details
        open={depth < 1}
        style={{ marginBottom: 2 }}
      >
        <summary
          style={{
            paddingLeft: pad,
            cursor: "pointer",
            ...mono,
            fontSize: 11,
          }}
        >
          {name != null && (
            <span style={{ color: "var(--puck-color-grey-05, #4b5563)" }}>{name}: </span>
          )}
          <span style={muted}>
            [{value.length}]
          </span>
        </summary>
        <div style={{ borderLeft: "1px solid var(--puck-color-grey-09, #e5e7eb)", marginLeft: pad + 4 }}>
          {value.map((item, i) => (
            <JsonTreeValue key={i} name={`${i}`} value={item} depth={depth + 1} />
          ))}
        </div>
      </details>
    );
  }

  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
    a.localeCompare(b)
  );
  if (entries.length === 0) {
    return (
      <div style={{ paddingLeft: pad, ...mono, fontSize: 11, marginBottom: 2 }}>
        {name != null && (
          <>
            <span style={{ color: "var(--puck-color-grey-05, #4b5563)" }}>{name}</span>
            <span style={muted}>: </span>
          </>
        )}
        <span style={muted}>{`{}`}</span>
      </div>
    );
  }

  return (
    <details open={depth < 2} style={{ marginBottom: 2 }}>
      <summary
        style={{
          paddingLeft: pad,
          cursor: "pointer",
          ...mono,
          fontSize: 11,
        }}
      >
        {name != null && (
          <span style={{ color: "var(--puck-color-grey-05, #4b5563)" }}>{name}: </span>
        )}
        <span style={muted}>{`{${entries.length} keys}`}</span>
      </summary>
      <div style={{ borderLeft: "1px solid var(--puck-color-grey-09, #e5e7eb)", marginLeft: pad + 4 }}>
        {entries.map(([k, v]) => (
          <JsonTreeValue key={k} name={k} value={v} depth={depth + 1} />
        ))}
      </div>
    </details>
  );
}

export function JsonTree({ data }: { data: unknown }) {
  if (data === null || data === undefined) {
    return <p style={{ ...muted, margin: 0 }}>—</p>;
  }
  return (
    <div
      style={{
        marginTop: 8,
        padding: 8,
        background: "var(--puck-color-white, #fff)",
        borderRadius: 4,
        border: "1px solid var(--puck-color-grey-09, #e5e7eb)",
        maxHeight: 320,
        overflow: "auto",
      }}
    >
      <JsonTreeValue name={null} value={data} depth={0} />
    </div>
  );
}
