'use client';
import * as React from 'react';

interface ThemePanelProps {
  cssText: string;
}

export function ThemePanel({ cssText }: ThemePanelProps) {
  const [copied, setCopied] = React.useState(false);

  const copy = () => {
    navigator.clipboard.writeText(cssText).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <section className="p1-theme-panel">
      <div className="p1-theme-panel__toolbar">
        <h2 className="p1-theme-panel__heading">p1-tokens.css</h2>
        <button className="p1-theme-panel__copy" onClick={copy}>
          {copied ? 'Copied!' : 'Copy all'}
        </button>
      </div>
      <pre className="p1-theme-panel__code">
        <code>{cssText}</code>
      </pre>
      <p className="p1-theme-panel__hint">
        This file installs into your project as <code>app/p1-tokens.css</code>. Override
        any <code>--p1-*</code> variable to retheme every block at once.
      </p>
    </section>
  );
}
