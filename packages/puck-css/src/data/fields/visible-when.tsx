"use client";

import { type ReactElement, type ReactNode } from "react";
import { createUsePuck } from "@puckeditor/core";

const usePuckState = createUsePuck();

/**
 * Render paths default `show*` props to true, so documents saved before a
 * toggle existed have no stored value and must still see the dependent field.
 * Only an explicit `false` hides it.
 */
export function useVisibleWhenProp(propName?: string): boolean {
  const selectedItem = usePuckState((s) => s.selectedItem) as {
    props?: Record<string, unknown>;
  } | null;
  if (!propName) return true;
  return selectedItem?.props?.[propName] !== false;
}

export function VisibleWhenProp({
  propName,
  children,
}: {
  propName?: string;
  children: ReactNode;
}): ReactElement | null {
  const visible = useVisibleWhenProp(propName);
  return visible ? <>{children}</> : null;
}
