import type { ComponentConfig } from "@puckeditor/core";
import { Btn, type BtnVariant } from "@/registry/p1/internal/btn";

export interface ButtonProps {
  label: string;
  href: string;
  variant: BtnVariant;
  align: "left" | "center";
}

export const ButtonBlock: ComponentConfig<ButtonProps> = {
  fields: {
    label: { type: "text", contentEditable: true, visible: false },
    href: { type: "text" },
    variant: {
      type: "select",
      options: [
        { label: "Primary", value: "primary" },
        { label: "Secondary", value: "secondary" },
        { label: "Yellow", value: "yellow" },
        { label: "Purple", value: "purple" },
      ],
    },
    align: {
      type: "radio",
      options: [
        { label: "Left", value: "left" },
        { label: "Center", value: "center" },
      ],
    },
  },
  defaultProps: { label: "Get started", href: "#", variant: "primary", align: "left" },
  render: ({ label, href, variant, align }) => (
    <div className={`mx-auto flex max-w-6xl px-p1-lg py-p1-sm ${align === "center" ? "justify-center" : "justify-start"}`}>
      <Btn variant={variant} href={href || undefined}>
        {label}
      </Btn>
    </div>
  ),
};
