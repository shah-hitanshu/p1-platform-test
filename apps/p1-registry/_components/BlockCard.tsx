'use client';
import * as React from 'react';
import type { CatalogItem } from '../lib/registry';
import { previewNames } from '../lib/preview-names';

interface BlockCardProps {
  item: CatalogItem;
}

export function BlockCard({ item }: BlockCardProps) {
  const hasPreview = (previewNames as readonly string[]).includes(item.name);
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

  const installCmd = `pnpm dlx shadcn@latest add @p1/${item.name}`;

  function copyCmd() {
    navigator.clipboard.writeText(installCmd).catch(() => {});
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
              onClick={copyCmd}
              type="button"
            >
              Copy
            </button>
          </div>
        </div>
      </dialog>
    </>
  );
}
