'use client';
import * as React from 'react';

interface QuickChipProps {
  label: string;
  command: string;
}

// The "ONE" / "ALL" install shortcuts on the blocks list page — a bordered
// chip that copies its own command when clicked, no separate copy button.
export function QuickChip({ label, command }: QuickChipProps) {
  const [copied, setCopied] = React.useState(false);

  function copy() {
    navigator.clipboard
      .writeText(command)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => {});
  }

  return (
    <button className="p1-quick-chip" onClick={copy} type="button">
      <span className="p1-quick-chip__label">{label}</span>
      <span className="p1-quick-chip__code">{copied ? 'Copied!' : command}</span>
    </button>
  );
}
