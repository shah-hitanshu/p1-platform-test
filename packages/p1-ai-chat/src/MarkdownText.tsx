import React from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkBreaks from 'remark-breaks';
import remarkGfm from 'remark-gfm';

/**
 * The seam between the panel and `react-markdown`: every element a model can emit, sized for
 * a ~300px column.
 */
const COMPONENTS: Components = {
  p: ({ children }) => <p style={{ margin: '0 0 8px 0', lineHeight: 1.6 }}>{children}</p>,
  pre: ({ children }) => <pre style={{ background: 'var(--pds-color-surface-default-secondary)', padding: '8px', borderRadius: 4, overflow: 'auto', fontSize: 12, margin: '0 0 8px 0' }}>{children}</pre>,
  code: ({ children, className }) => className
    ? <code className={className}>{children}</code>
    : <code style={{ background: 'var(--pds-color-surface-default-secondary)', padding: '1px 4px', borderRadius: 3, fontSize: 12, fontFamily: 'monospace' }}>{children}</code>,
  ul: ({ children }) => <ul style={{ margin: '0 0 8px 0', paddingLeft: 20 }}>{children}</ul>,
  ol: ({ children }) => <ol style={{ margin: '0 0 8px 0', paddingLeft: 20 }}>{children}</ol>,
  li: ({ children }) => <li style={{ marginBottom: 2 }}>{children}</li>,
  h1: ({ children }) => <h1 style={{ fontSize: 16, fontWeight: 600, margin: '0 0 8px 0' }}>{children}</h1>,
  h2: ({ children }) => <h2 style={{ fontSize: 15, fontWeight: 600, margin: '0 0 8px 0' }}>{children}</h2>,
  h3: ({ children }) => <h3 style={{ fontSize: 14, fontWeight: 600, margin: '0 0 8px 0' }}>{children}</h3>,
  strong: ({ children }) => <strong style={{ fontWeight: 600 }}>{children}</strong>,
  // New tab, since following a link in place abandons an in-progress edit — except
  // same-page anchors, which a GFM footnote uses to reach its note.
  a: ({ children, href }) => (
    <a
      href={href}
      {...(href?.startsWith('#') ? {} : { target: '_blank', rel: 'noopener noreferrer' })}
      style={{ textDecoration: 'underline' }}
    >
      {children}
    </a>
  ),
  blockquote: ({ children }) => <blockquote style={{ borderLeft: '3px solid var(--pds-color-border-separator)', paddingLeft: 8, margin: '0 0 8px 0', color: 'var(--pds-color-foreground-default-secondary)' }}>{children}</blockquote>,
  // Cells wrap to fit the panel; the scroll container is the fallback for a table too wide
  // even wrapped.
  table: ({ children }) => (
    <div style={{ overflowX: 'auto', maxWidth: '100%', margin: '0 0 10px 0' }}>
      <table style={{ borderCollapse: 'collapse', fontSize: 12, width: '100%' }}>
        {children}
      </table>
    </div>
  ),
  th: ({ children, style }) => (
    <th style={{ textAlign: style?.textAlign ?? 'left', fontWeight: 600, whiteSpace: 'nowrap', padding: '0 10px 4px 0', borderBottom: '1px solid var(--pds-color-border-default)', verticalAlign: 'bottom' }}>
      {children}
    </th>
  ),
  // `break-word` overrides the bubble's inherited `anywhere`, which would break cells
  // mid-word down to a few characters per column.
  td: ({ children, style }) => (
    <td style={{ textAlign: style?.textAlign ?? 'left', padding: '5px 10px 5px 0', borderBottom: '1px solid var(--pds-color-border-separator)', verticalAlign: 'top', overflowWrap: 'break-word', lineHeight: 1.45 }}>
      {children}
    </td>
  ),
  del: ({ children }) => <del style={{ color: 'var(--pds-color-foreground-default-secondary)' }}>{children}</del>,
  hr: () => <hr style={{ border: 0, borderTop: '1px solid var(--pds-color-border-separator)', margin: '0 0 8px 0' }} />,
};

/** A run of assistant prose, rendered as markdown. */
export function MarkdownText({ text }: { text: string }): React.ReactElement {
  return (
    // Absorbs the trailing margin of the last block, which would otherwise double the gap
    // the turn already sets between its parts.
    <div style={{ marginBottom: -8 }}>
      <ReactMarkdown
        // breaks: honour a single newline, which markdown otherwise soft-wraps into one
        // paragraph, running the model's "**Q:** …\n**A:** …" onto one line.
        remarkPlugins={[remarkGfm, remarkBreaks]}
        components={COMPONENTS}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}
