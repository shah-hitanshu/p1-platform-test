"use client";

import type { MouseEvent } from "react";

import { DatabaseIcon } from "../icons/database-icon";
import { useFieldBindTarget } from "./bind-context";
import styles from "./FieldBindControl.module.css";

/**
 * The data-binding control for whichever field the surrounding label belongs to.
 * A label outside a bindable field — and every label in a host without the field
 * connect plugin — draws nothing.
 */
export function FieldBindControl() {
  const target = useFieldBindTarget();
  if (!target) return null;

  const { bound, openConnect } = target;
  const open = (e: MouseEvent) => {
    e.stopPropagation();
    openConnect();
  };

  // The bound pill names itself by its own visible text; only the icon-only
  // button needs a name of its own.
  //
  // Puck renders inspector fields inside a <form>; a submit-typed button would
  // submit it.
  return bound ? (
    <button type="button" className={styles.pill} title="Edit binding" onClick={open}>
      <DatabaseIcon /> Bound
    </button>
  ) : (
    <button
      type="button"
      className="p1-field-label-action"
      title="Connect to data"
      aria-label="Connect to data"
      onClick={open}
    >
      <DatabaseIcon />
    </button>
  );
}
