'use client';
import * as React from 'react';
// Type-only from lib/registry: it imports node:fs, and this is a client
// component, so a value import from there would reach the browser bundle.
import type { CatalogItem } from '../lib/registry';
import { registrationSnippet } from '../lib/registration-snippet';
import { previewNames } from '../lib/preview-names';

interface BlockCardProps {
  item: CatalogItem;
}

// One <dialog> per card section. handleClick compares the click against the
// dialog's own box, so a click on the backdrop closes it but one inside doesn't.
function useDialog() {
  const ref = React.useRef<HTMLDialogElement>(null);
  const [open, setOpen] = React.useState(false);

  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open) el.showModal();
    else if (el.open) el.close();
  }, [open]);

  function handleClick(e: React.MouseEvent<HTMLDialogElement>) {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return;
    if (e.clientX < rect.left || e.clientX > rect.right ||
        e.clientY < rect.top  || e.clientY > rect.bottom) {
      setOpen(false);
    }
  }

  return { ref, open, setOpen, handleClick };
}

export function BlockCard({ item }: BlockCardProps) {
  const hasPreview = previewNames.includes(item.name);
  const preview = useDialog();
  const code = useDialog();

  const [copied, setCopied] = React.useState<'cmd' | 'agent' | 'reg' | null>(null);

  const installCmd = `pnpm dlx shadcn@latest add @p1/${item.name}`;
  // The registration lines are served with the item, so the catalog and the CLI
  // can never disagree about the component key or the category.
  const registerDocs = registrationSnippet(item.docs);
  const agentPrompt = `Add the P1 ${item.title ?? item.name} block to this project and register it in the Puck config.`;

  function copy(text: string, kind: 'cmd' | 'agent' | 'reg') {
    navigator.clipboard
      .writeText(text)
      .then(() => {
        setCopied(kind);
        setTimeout(() => setCopied(null), 1500);
      })
      .catch(() => {});
  }

  return (
    <>
      <article className="p1-block-card">
        {/* Card bar: tag + title on left, "Get code" on right */}
        <header className="p1-block-card__bar">
          <div className="p1-block-card__bar-left">
            {item.categories?.[0] && (
              <span className="p1-tag p1-block-card__tag" data-category={item.categories[0]}>{item.categories[0]}</span>
            )}
            <h2 className="p1-block-card__title">{item.title ?? item.name}</h2>
          </div>
          <button
            className="p1-block-card__get-code"
            onClick={() => code.setOpen(true)}
            type="button"
          >
            Get code
          </button>
        </header>

        {/* Large preview thumbnail — click to fullscreen */}
        {hasPreview ? (
          <button
            className="p1-block-card__preview"
            onClick={() => preview.setOpen(true)}
            aria-label={`Open full preview of ${item.title ?? item.name}`}
            type="button"
          >
            <iframe
              src={`/preview/${item.name}`}
              title={`Preview of ${item.title ?? item.name}`}
              scrolling="no"
              tabIndex={-1}
              aria-hidden="true"
              loading="lazy"
            />
          </button>
        ) : (
          <div className="p1-block-card__no-preview">No preview</div>
        )}
      </article>

      {/* Full-size preview modal */}
      {hasPreview && (
        <dialog
          ref={preview.ref}
          className="p1-preview-dialog"
          onClick={preview.handleClick}
          onClose={() => preview.setOpen(false)}
        >
          <div className="p1-preview-dialog__inner">
            <div className="p1-preview-dialog__toolbar">
              <span className="p1-preview-dialog__title">{item.title ?? item.name}</span>
              <button
                className="p1-preview-dialog__close"
                onClick={() => preview.setOpen(false)}
                type="button"
                aria-label="Close preview"
              >
                ✕
              </button>
            </div>
            <div className="p1-preview-dialog__frame">
              {preview.open && (
                <iframe
                  src={`/preview/${item.name}`}
                  title={`Full preview of ${item.title ?? item.name}`}
                />
              )}
            </div>
          </div>
        </dialog>
      )}

      {/* "Get code" modal */}
      <dialog
        ref={code.ref}
        className="p1-code-dialog"
        onClick={code.handleClick}
        onClose={() => code.setOpen(false)}
      >
        <div className="p1-code-dialog__inner">
          <div className="p1-code-dialog__header">
            <div>
              <h3 className="p1-code-dialog__title">{item.title ?? item.name}</h3>
              {item.categories?.[0] && (
                <span className="p1-tag p1-code-dialog__tag" data-category={item.categories[0]}>
                  {item.categories[0]}
                </span>
              )}
            </div>
            <button
              className="p1-code-dialog__close"
              onClick={() => code.setOpen(false)}
              type="button"
              aria-label="Close"
            >
              ✕
            </button>
          </div>
          {item.description && (
            <p className="p1-code-dialog__desc">{item.description}</p>
          )}
          <div className="p1-code-dialog__cmd-label">Install</div>
          <div className="p1-code-dialog__cmd">
            <code className="p1-code-dialog__cmd-code">{installCmd}</code>
            <button
              className="p1-code-dialog__copy"
              onClick={() => copy(installCmd, 'cmd')}
              type="button"
            >
              {copied === 'cmd' ? 'Copied!' : 'Copy'}
            </button>
          </div>
          {registerDocs && (
            <>
              <div className="p1-code-dialog__cmd-label">Then register it</div>
              <div className="p1-code-dialog__docs">
                <pre className="p1-code-dialog__docs-code">{registerDocs}</pre>
                <button
                  className="p1-code-dialog__copy"
                  onClick={() => copy(registerDocs, 'reg')}
                  type="button"
                >
                  {copied === 'reg' ? 'Copied!' : 'Copy'}
                </button>
              </div>
            </>
          )}
          <button
            className="p1-code-dialog__agent"
            onClick={() => copy(agentPrompt, 'agent')}
            type="button"
            title="Copy a prompt for an AI agent"
          >
            {copied === 'agent' ? 'Copied!' : 'Copy for agent'}
          </button>
        </div>
      </dialog>
    </>
  );
}
