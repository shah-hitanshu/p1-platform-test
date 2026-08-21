import "./button.css";
import { Btn } from "@/registry/p1/internal/btn";

export interface ButtonProps {
  label: string;
  href: string;
  variant: "primary" | "secondary" | "yellow" | "purple";
  align: "left" | "center";
}

export function Button({ label, href, variant, align }: ButtonProps) {
  return (
    <div className="p1-button p1-block" data-align={align}>
      <Btn href={href} variant={variant}>
        {label}
      </Btn>
    </div>
  );
}
