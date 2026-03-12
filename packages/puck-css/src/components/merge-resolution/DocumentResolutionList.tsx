/**
 * DocumentResolutionList Component
 *
 * Scrollable list of documents with strategy badges and keyboard navigation.
 */

import React, { useEffect, useRef, useCallback } from 'react';
import type { DocumentResolution, DocumentResolutionStrategy } from '../../hooks/useMergeResolution.js';

export interface DocumentResolutionListProps {
  documents: DocumentResolution[];
  currentIndex: number;
  goToNext: () => void;
  goToPrevious: () => void;
  goToNextUnresolved: () => void;
  goToDocument: (index: number) => void;
  setStrategy: (documentId: string, strategy: DocumentResolutionStrategy) => void;
  setRemainingStrategy: (strategy: 'accept-draft' | 'accept-live') => void;
  onToggleDetail?: () => void;
}

const baseClass = 'document-resolution-list';

const ulStyle: React.CSSProperties = {
  listStyle: 'none',
  margin: 0,
  padding: 0,
  outline: 'none',
};

const liBaseStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  padding: '10px 12px',
  cursor: 'pointer',
  borderBottom: '1px solid #f0f0f0',
  transition: 'background-color 0.15s',
  borderLeft: '3px solid transparent',
};

const liSelectedStyle: React.CSSProperties = {
  ...liBaseStyle,
  background: '#e8f4fd',
  borderLeft: '3px solid #0066cc',
};

const pathStyle: React.CSSProperties = {
  fontSize: '14px',
  color: '#333',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  flex: 1,
  marginRight: '8px',
};

const badgeBaseStyle: React.CSSProperties = {
  fontSize: '11px',
  fontWeight: 600,
  padding: '2px 8px',
  borderRadius: '10px',
  whiteSpace: 'nowrap',
  textTransform: 'uppercase',
};

const badgeColors: Record<DocumentResolutionStrategy, React.CSSProperties> = {
  'accept-draft': { background: '#d4edda', color: '#155724' },
  'accept-live': { background: '#cce5ff', color: '#004085' },
  'cherry-pick': { background: '#fff3cd', color: '#856404' },
  'crdt-preview': { background: '#e2d5f1', color: '#5a2d82' },
  unresolved: { background: '#f8d7da', color: '#721c24' },
};

const strategyLabels: Record<DocumentResolutionStrategy, string> = {
  'accept-draft': 'Draft',
  'accept-live': 'Live',
  'cherry-pick': 'Cherry-pick',
  'crdt-preview': 'CRDT',
  unresolved: 'Unresolved',
};

const strategyKeyMap: Record<string, DocumentResolutionStrategy> = {
  '1': 'accept-draft',
  '2': 'accept-live',
  '3': 'cherry-pick',
  '4': 'crdt-preview',
};

export function DocumentResolutionList({
  documents,
  currentIndex,
  goToNext,
  goToPrevious,
  goToNextUnresolved,
  goToDocument,
  setStrategy,
  setRemainingStrategy,
  onToggleDetail,
}: DocumentResolutionListProps): React.ReactElement {
  const listRef = useRef<HTMLUListElement>(null);
  const itemRefs = useRef<Map<number, HTMLLIElement>>(new Map());

  // Auto-scroll selected item into view
  useEffect(() => {
    const item = itemRefs.current.get(currentIndex);
    if (item) {
      item.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
    }
  }, [currentIndex]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      // Guard: don't fire when input/textarea/contentEditable is focused
      const target = e.target as HTMLElement;
      if (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.tagName === 'SELECT' ||
        target.isContentEditable
      ) {
        return;
      }

      const key = e.key;

      // Navigation
      if (key === 'ArrowDown' || key === 'j') {
        e.preventDefault();
        goToNext();
        return;
      }
      if (key === 'ArrowUp' || key === 'k') {
        e.preventDefault();
        goToPrevious();
        return;
      }
      if (key === 'n') {
        e.preventDefault();
        goToNextUnresolved();
        return;
      }

      // Toggle detail view
      if (key === 'Enter') {
        e.preventDefault();
        onToggleDetail?.();
        return;
      }

      // Strategy shortcuts
      if (key in strategyKeyMap && !e.shiftKey) {
        e.preventDefault();
        const currentDoc = documents[currentIndex];
        if (currentDoc) {
          const strategy = strategyKeyMap[key];
          if (strategy) {
            setStrategy(currentDoc.documentId, strategy);
          }
        }
        return;
      }

      // Bulk actions
      if (key === 'D' && e.shiftKey) {
        e.preventDefault();
        setRemainingStrategy('accept-draft');
        return;
      }
      if (key === 'L' && e.shiftKey) {
        e.preventDefault();
        setRemainingStrategy('accept-live');
        return;
      }
    },
    [
      documents,
      currentIndex,
      goToNext,
      goToPrevious,
      goToNextUnresolved,
      setStrategy,
      setRemainingStrategy,
      onToggleDetail,
    ]
  );

  return (
    <ul
      className={baseClass}
      style={ulStyle}
      onKeyDown={handleKeyDown}
      tabIndex={0}
      ref={listRef}
    >
      {documents.map((doc, index) => (
        <li
          key={doc.documentId}
          className={`${baseClass}__item ${index === currentIndex ? `${baseClass}__item--selected` : ''}`}
          style={index === currentIndex ? liSelectedStyle : liBaseStyle}
          aria-selected={index === currentIndex}
          role="listitem"
          ref={(el) => {
            if (el) {
              itemRefs.current.set(index, el);
            }
          }}
          onClick={() => goToDocument(index)}
        >
          <span className={`${baseClass}__path`} style={pathStyle}>{doc.documentPath}</span>
          <span
            className={`${baseClass}__badge ${baseClass}__badge--${doc.strategy}`}
            style={{ ...badgeBaseStyle, ...badgeColors[doc.strategy] }}
          >
            {strategyLabels[doc.strategy]}
          </span>
        </li>
      ))}
    </ul>
  );
}
