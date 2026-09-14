"use client";

import { createContext, useContext, type ReactNode } from "react";

/** What the label row needs to draw a field's data-binding control. */
export interface FieldBindTarget {
  /** The field's value is a binding rather than typed content. */
  bound: boolean;
  openConnect: () => void;
}

const FieldBindContext = createContext<FieldBindTarget | null>(null);

export function FieldBindProvider({
  target,
  children,
}: {
  target: FieldBindTarget | null;
  children: ReactNode;
}) {
  return <FieldBindContext.Provider value={target}>{children}</FieldBindContext.Provider>;
}

/**
 * The binding control the surrounding field offers, or null where the field
 * connect plugin is not installed and no field can be bound.
 */
export function useFieldBindTarget(): FieldBindTarget | null {
  return useContext(FieldBindContext);
}
