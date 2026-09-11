"use client";

import React from "react";

import styles from "./editor-message.module.css";

/**
 * The full-page panel the editor shows in place of the canvas when there is
 * nothing to edit — nothing configured, or nothing loadable.
 */
export function EditorMessage({
  testId,
  title,
  detail,
  hint,
}: {
  testId: string;
  title: string;
  detail: string;
  hint?: string;
}) {
  return (
    <div className={styles.message} data-testid={testId}>
      <h3 className={styles.title}>{title}</h3>
      <p className={styles.detail}>{detail}</p>
      {hint && <p className={styles.hint}>{hint}</p>}
    </div>
  );
}
