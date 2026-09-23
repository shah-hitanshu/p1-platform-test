'use client';
import * as React from 'react';
import { Check, Copy } from 'lucide-react';

interface CopyCommandProps {
  command: string;
  className?: string;
  label?: string;
}

// Dark pill: a command (or, on the detail page, a registration snippet)
// beside a copy button. Shared by the home hero, the detail page's install
// box, and its "register it" box, so the three never drift in style.
export function CopyCommand({ command, className, label }: CopyCommandProps) {
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
    <div className={`p1-cmd-box ${className ?? ''}`.trim()}>
      <code className="p1-cmd-box__code">{command}</code>
      <button
        className="p1-cmd-box__copy"
        onClick={copy}
        type="button"
        aria-label={label ?? 'Copy to clipboard'}
      >
        {copied ? <Check size={14} /> : <Copy size={14} />}
      </button>
    </div>
  );
}
