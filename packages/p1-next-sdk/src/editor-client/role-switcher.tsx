"use client";

import React from "react";
import type { ContentRole } from "@pantheon-systems/puck-css";

import styles from "./role-switcher.module.css";

// Exhaustive by construction: a role added to ContentRole fails the build here
// rather than quietly leaving the picker one short, which is what the
// hand-written list this replaced had already done.
const ROLE_LABELS: Record<ContentRole, string> = {
  admin: "Admin",
  editor: "Editor",
  author: "Author",
  "junior-editor": "Junior editor",
};

const ROLES = Object.keys(ROLE_LABELS) as ContentRole[];

/**
 * Re-renders the editor as another content role, so role-gated affordances can
 * be checked without a second account. A development affordance — the caller
 * decides whether it appears.
 */
export function RoleSwitcher({
  currentRole,
  onRoleChange,
}: {
  currentRole: ContentRole;
  onRoleChange: (role: ContentRole) => void;
}) {
  return (
    <div className={styles.panel} data-testid="p1-role-switcher">
      <span className={styles.label}>Role:</span>
      <select
        className={styles.select}
        aria-label="Content role"
        value={currentRole}
        onChange={(e) => onRoleChange(e.target.value as ContentRole)}
      >
        {ROLES.map((role) => (
          <option key={role} value={role}>
            {ROLE_LABELS[role]}
          </option>
        ))}
      </select>
    </div>
  );
}
