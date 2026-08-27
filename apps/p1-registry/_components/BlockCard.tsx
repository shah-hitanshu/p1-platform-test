'use client';
import * as React from 'react';
import type { CatalogItem } from '../lib/registry';
import { previewNames } from '../lib/preview-map';
import { AddCommand } from './AddCommand';

interface BlockCardProps {
  item: CatalogItem;
}

export function BlockCard({ item }: BlockCardProps) {
  const hasPreview = (previewNames as readonly string[]).includes(item.name);
  const [open, setOpen] = React.useState(false);
  const dialogRef = React.useRef<HTMLDialogElement>(null);

  React.useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;
    if (open) {
      el.showModal();
    } else {
      el.close();
    }
  }, [open]);

  // Close on backdrop click
  function handleDialogClick(e: React.MouseEvent<HTMLDialogElement>) {
    const rect = dialogRef.current?.getBoundingClientRect();
    if (!rect) return;
    if (
      e.clientX < rect.left || e.clientX > rect.right ||
      e.clientY < rect.top || e.clientY > rect.bottom
    ) {
      setOpen(false);
    }
  }

  return (
    <>
      <article className="p1-block-card">
        {hasPreview && (
          <button
            className="p1-block-card__preview"
            onClick={() => setOpen(true)}
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
        )}
        <header className="p1-block-card__header">
          {item.categories?.[0] && (
            <span className="p1-block-card__tag">{item.categories[0]}</span>
          )}
          <h2 className="p1-block-card__title">{item.title ?? item.name}</h2>
          {item.description && (
            <p className="p1-block-card__desc">{item.description}</p>
          )}
        </header>
        <footer className="p1-block-card__footer">
          <AddCommand name={item.name} title={item.title ?? item.name} />
        </footer>
      </article>

      {/* Full-size preview modal — only rendered for blocks that have a /preview page */}
      {hasPreview && (
        <dialog
          ref={dialogRef}
          className="p1-preview-dialog"
          onClick={handleDialogClick}
          onClose={() => setOpen(false)}
        >
          <div className="p1-preview-dialog__inner">
            <div className="p1-preview-dialog__toolbar">
              <span className="p1-preview-dialog__title">{item.title ?? item.name}</span>
              <button
                className="p1-preview-dialog__close"
                onClick={() => setOpen(false)}
                type="button"
                aria-label="Close preview"
              >
                ✕
              </button>
            </div>
            <div className="p1-preview-dialog__frame">
              {open && (
                <iframe
                  src={`/preview/${item.name}`}
                  title={`Full preview of ${item.title ?? item.name}`}
                />
              )}
            </div>
          </div>
        </dialog>
      )}
    </>
  );
}
