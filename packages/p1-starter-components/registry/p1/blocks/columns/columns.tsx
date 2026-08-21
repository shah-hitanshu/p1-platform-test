import * as React from "react";
import { type Slot } from "@puckeditor/core";
import "./columns.css";

export interface ColumnsProps {
  distribution: "1:1" | "1:1:1" | "2:1" | "1:2" | "1:1:1:1";
  gap: "tight" | "regular" | "wide";
  valign: "top" | "center" | "stretch";
  tone: "none" | "light";
  col1: Slot;
  col2: Slot;
  col3: Slot;
  col4: Slot;
}

const TEMPLATES: Record<ColumnsProps["distribution"], { count: number; template: string }> = {
  "1:1": { count: 2, template: "1fr 1fr" },
  "2:1": { count: 2, template: "1.5fr 1fr" },
  "1:2": { count: 2, template: "1fr 1.5fr" },
  "1:1:1": { count: 3, template: "1fr 1fr 1fr" },
  "1:1:1:1": { count: 4, template: "1fr 1fr 1fr 1fr" },
};

function SlotPlaceholder({ label }: { label: string }) {
  return <div className="p1-columns__placeholder">{label}</div>;
}

/** Render a slot safely — a Puck SlotComponent in the editor or a static placeholder. */
function renderSlot(slot: unknown, label: string) {
  if (typeof slot === "function") {
    const Comp = slot as React.ComponentType;
    return <Comp />;
  }
  return <SlotPlaceholder label={label} />;
}

export function ColumnsRender({ distribution, gap, valign, tone, col1, col2, col3, col4 }: ColumnsProps) {
  const { count, template } = TEMPLATES[distribution ?? "1:1"];
  const slots = [col1, col2, col3, col4].slice(0, count);
  return (
    <div className="p1-columns" data-tone={tone}>
      <div
        className="p1-columns__grid"
        data-gap={gap}
        data-valign={valign}
        style={{ gridTemplateColumns: template }}
      >
        {slots.map((slot, i) => (
          <div key={i} className="p1-columns__col">
            {renderSlot(slot, `Column ${i + 1} — drop blocks here`)}
          </div>
        ))}
      </div>
    </div>
  );
}
