'use client';
import * as React from 'react';

interface AddCommandProps {
  name: string;
  title: string;
}

export function AddCommand({ name, title }: AddCommandProps) {
  const [copied, setCopied] = React.useState<'cmd' | 'agent' | null>(null);

  const shellCmd = `pnpm dlx shadcn@latest add @p1/${name}`;
  const agentPrompt = `Add the P1 ${title} block to this project and register it in the Puck config.`;

  const copy = (text: string, kind: 'cmd' | 'agent') => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(kind);
      setTimeout(() => setCopied(null), 1500);
    });
  };

  return (
    <div className="p1-add-command">
      <button
        className="p1-add-command__btn"
        onClick={() => copy(shellCmd, 'cmd')}
        title="Copy install command"
      >
        <code>{shellCmd}</code>
        <span className="p1-add-command__badge">
          {copied === 'cmd' ? 'Copied!' : 'Copy'}
        </span>
      </button>
      <button
        className="p1-add-command__agent"
        onClick={() => copy(agentPrompt, 'agent')}
        title="Copy prompt for an AI agent"
      >
        {copied === 'agent' ? 'Copied!' : 'Copy for agent'}
      </button>
    </div>
  );
}
