import "./spacer.css";

export interface SpacerProps {
  size: "xs" | "sm" | "md" | "lg" | "xl";
}

export function Spacer({ size }: SpacerProps) {
  return <div className="p1-spacer" data-size={size} aria-hidden="true" />;
}
