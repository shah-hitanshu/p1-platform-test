import * as React from "react";
import { type Slot } from "@puckeditor/core";
import "./container.css";

export interface ContainerProps {
  content: Slot;
  tone: "none" | "light" | "white";
  pad: "compact" | "regular" | "spacious";
  maxWidth: "narrow" | "standard" | "wide" | "full";
  align: "left" | "center";
  radius: "none" | "soft" | "round";
}

function SlotPlaceholder() {
  return (
    <div className="p1-container__placeholder">
      Drop blocks here, or add them in the inspector.
    </div>
  );
}

export function ContainerRender({ content, tone, pad, maxWidth, align, radius }: ContainerProps) {
  const Content = content as unknown;
  const hasBackground = tone !== "none";
  const inner =
    typeof Content === "function" ? (
      (() => {
        const Comp = Content as React.ComponentType;
        return <Comp />;
      })()
    ) : (
      <SlotPlaceholder />
    );
  return (
    <div className="p1-container">
      <div className="p1-container__outer">
        <div
          className="p1-container__box"
          data-tone={tone}
          data-pad={hasBackground ? pad : undefined}
          data-radius={hasBackground ? radius : undefined}
        >
          <div className="p1-container__inner" data-maxwidth={maxWidth} data-align={align}>
            {inner}
          </div>
        </div>
      </div>
    </div>
  );
}
