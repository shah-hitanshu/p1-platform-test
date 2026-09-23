'use client';
import * as React from 'react';
import Link from 'next/link';
import { Check, ChevronRight, Copy } from 'lucide-react';

interface RelatedBlock {
  name: string;
  title?: string;
}

interface DetailSidebarProps {
  installCommand: string;
  registerDocs: string;
  agentPrompt: string;
  related?: RelatedBlock;
}

export function DetailSidebar({ installCommand, registerDocs, agentPrompt, related }: DetailSidebarProps) {
  const [copied, setCopied] = React.useState<'cmd' | 'reg' | 'agent' | null>(null);

  function copy(text: string, kind: 'cmd' | 'reg' | 'agent') {
    navigator.clipboard
      .writeText(text)
      .then(() => {
        setCopied(kind);
        setTimeout(() => setCopied(null), 1500);
      })
      .catch(() => {});
  }

  return (
    <div className="p1-detail-side">
      <div className="p1-detail-side__section">
        <div className="p1-detail-side__label">Install</div>
        <div className="p1-cmd-box p1-cmd-box--full">
          <code className="p1-cmd-box__code">{installCommand}</code>
          <button
            className="p1-cmd-box__copy"
            onClick={() => copy(installCommand, 'cmd')}
            type="button"
            aria-label="Copy install command"
          >
            {copied === 'cmd' ? <Check size={14} /> : <Copy size={14} />}
          </button>
        </div>
      </div>

      {registerDocs && (
        <div className="p1-detail-side__section">
          <div className="p1-detail-side__label">Then register it</div>
          <div className="p1-register-box">
            <pre>{registerDocs}</pre>
            <button
              className="p1-cmd-box__copy"
              onClick={() => copy(registerDocs, 'reg')}
              type="button"
              aria-label="Copy registration snippet"
            >
              {copied === 'reg' ? <Check size={14} /> : <Copy size={14} />}
            </button>
          </div>
          <button
            className="p1-copy-agent"
            onClick={() => copy(agentPrompt, 'agent')}
            type="button"
            title="Copy a prompt for an AI agent"
          >
            {copied === 'agent' ? 'Copied!' : 'Copy for agent'}
          </button>
        </div>
      )}

      {related && (
        <div className="p1-detail-side__section">
          <div className="p1-detail-side__label">Related</div>
          <Link href={`/blocks/${related.name}`} className="p1-related-card">
            <span>{related.title ?? related.name}</span>
            <ChevronRight aria-hidden="true" />
          </Link>
        </div>
      )}
    </div>
  );
}
