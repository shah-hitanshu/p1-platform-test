'use client';
import * as React from 'react';

interface DetailTabsProps {
  hasPreview: boolean;
  previewSrc: string;
  title: string;
  code: string;
}

export function DetailTabs({ hasPreview, previewSrc, title, code }: DetailTabsProps) {
  const [tab, setTab] = React.useState<'preview' | 'code'>(hasPreview ? 'preview' : 'code');

  return (
    <>
      <div className="p1-detail-tabs">
        <button
          className="p1-detail-tabs__btn"
          data-active={tab === 'preview' ? 'true' : undefined}
          onClick={() => setTab('preview')}
          type="button"
        >
          Preview
        </button>
        <button
          className="p1-detail-tabs__btn"
          data-active={tab === 'code' ? 'true' : undefined}
          onClick={() => setTab('code')}
          type="button"
        >
          Code
        </button>
      </div>

      {tab === 'preview' &&
        (hasPreview ? (
          <div className="p1-detail-preview">
            <iframe src={previewSrc} title={`Preview of ${title}`} />
          </div>
        ) : (
          <div className="p1-block-card__no-preview">No preview available</div>
        ))}

      {tab === 'code' && (
        <pre className="p1-detail-code">
          <code>{code || 'No source available.'}</code>
        </pre>
      )}
    </>
  );
}
