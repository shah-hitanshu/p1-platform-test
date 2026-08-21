import * as React from "react";
import type { ComponentConfig} from "@puckeditor/core";
import { type Slot } from "@puckeditor/core";

export interface ContainerProps {
  content: Slot;
  tone: "none" | "light" | "white";
  pad: "compact" | "regular" | "spacious";
  maxWidth: "narrow" | "standard" | "wide" | "full";
  align: "left" | "center";
  radius: "none" | "soft" | "round";
}

const TONE: Record<ContainerProps["tone"], string> = {
  none: "bg-transparent",
  light: "bg-p1-bg-light",
  white: "bg-p1-bg-default border border-p1-border",
};
const PAD: Record<ContainerProps["pad"], string> = {
  compact: "p-p1-lg",
  regular: "p-p1-xl",
  spacious: "p-p1-xl md:p-16",
};
const MAXW: Record<ContainerProps["maxWidth"], string> = {
  narrow: "max-w-3xl",
  standard: "max-w-5xl",
  wide: "max-w-6xl",
  full: "max-w-none",
};
const RADIUS: Record<ContainerProps["radius"], string> = {
  none: "rounded-none",
  soft: "rounded-p1-lg",
  round: "rounded-3xl",
};

export const ContainerBlock: ComponentConfig<ContainerProps> = {
  fields: {
    content: { type: "slot" },
    tone: {
      type: "select",
      options: [
        { label: "None", value: "none" },
        { label: "Light", value: "light" },
        { label: "White", value: "white" },
      ],
    },
    pad: {
      type: "select",
      options: [
        { label: "Compact", value: "compact" },
        { label: "Regular", value: "regular" },
        { label: "Spacious", value: "spacious" },
      ],
    },
    maxWidth: {
      type: "select",
      options: [
        { label: "Narrow", value: "narrow" },
        { label: "Standard", value: "standard" },
        { label: "Wide", value: "wide" },
        { label: "Full", value: "full" },
      ],
    },
    align: {
      type: "radio",
      options: [
        { label: "Left", value: "left" },
        { label: "Center", value: "center" },
      ],
    },
    radius: {
      type: "select",
      options: [
        { label: "None", value: "none" },
        { label: "Soft", value: "soft" },
        { label: "Round", value: "round" },
      ],
    },
  },
  defaultProps: {
    content: [],
    tone: "light",
    pad: "regular",
    maxWidth: "standard",
    align: "left",
    radius: "soft",
  },
  render: ({ content, tone, pad, maxWidth, align, radius }) => {
    const transparent = tone === "none";
    const Content = content as unknown;
    const inner =
      typeof Content === "function" ? (
        (() => {
          const Comp = Content as React.ComponentType;
          return <Comp />;
        })()
      ) : (
        <div className="rounded-p1-md border border-dashed border-p1-border p-p1-lg text-center text-sm text-p1-text-muted">
          Drop blocks here, or add them in the inspector.
        </div>
      );
    return (
      <div className="px-p1-lg py-p1-md">
        <div className="mx-auto max-w-7xl">
          <div className={`${TONE[tone]} ${transparent ? "" : `${PAD[pad]} ${RADIUS[radius]}`}`}>
            <div className={`${MAXW[maxWidth]} ${align === "center" ? "mx-auto" : ""}`}>{inner}</div>
          </div>
        </div>
      </div>
    );
  },
};
