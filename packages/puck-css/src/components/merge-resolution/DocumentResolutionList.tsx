import React, { useEffect, useRef, useCallback } from 'react';
import type {
  DocumentResolution,
  DocumentResolutionStrategy,
  DocumentChangeType,
} from '../../hooks/useMergeResolution.js';

export interface DiffCounts {
  added: number;
  removed: number;
  modified: number;
}

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
  diffCounts?: Map<string, DiffCounts>;
}

const baseClass = 'document-resolution-list';

const strategyLabels: Record<DocumentResolutionStrategy, string> = {
  'accept-draft': 'Draft',
  'accept-live': 'Live',
  'cherry-pick': 'Cherry-pick',
  unresolved: 'Unresolved',
};

const strategyStatusTypes: Record<DocumentResolutionStrategy, string> = {
  'accept-draft': 'success',
  'accept-live': 'info',
  'cherry-pick': 'warning',
  unresolved: 'critical',
};

const strategyKeyMap: Record<string, DocumentResolutionStrategy> = {
  '1': 'accept-draft',
  '2': 'accept-live',
  '3': 'cherry-pick',
};

const changeTypeLabels: Record<DocumentChangeType, string> = {
  conflicting: 'Conflict',
  'deleted-on-main': 'Deleted on Live',
  'draft-changed': 'Changed',
  'new-on-draft': 'New',
  'deleted-on-draft': 'Deleted',
};

const changeTypeStatusTypes: Record<DocumentChangeType, string> = {
  conflicting: 'critical',
  'deleted-on-main': 'critical',
  'draft-changed': 'info',
  'new-on-draft': 'success',
  'deleted-on-draft': 'disabled',
};

function StatusBadge({ statusType, label }: { statusType: string; label: string }) {
  return (
    <span className="pds-status-badge pds-status-badge--neutral">
      <span className={`pds-status-badge__status pds-status-badge__status--${statusType}`}>
        <span className="visually-hidden">Status: {label.toLowerCase()}</span>
      </span>
      <span className="pds-status-badge__label">{label}</span>
    </span>
  );
}

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
  diffCounts,
}: DocumentResolutionListProps): React.ReactElement {
  const listRef = useRef<HTMLUListElement>(null);
  const itemRefs = useRef<Map<number, HTMLLIElement>>(new Map());

  useEffect(() => {
    const item = itemRefs.current.get(currentIndex);
    if (item) {
      item.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
    }
  }, [currentIndex]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
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
      if (key === 'Enter') {
        e.preventDefault();
        onToggleDetail?.();
        return;
      }
      if (key in strategyKeyMap && !e.shiftKey) {
        e.preventDefault();
        const currentDoc = documents[currentIndex];
        if (currentDoc) {
          const strategy = strategyKeyMap[key];
          if (strategy) setStrategy(currentDoc.documentId, strategy);
        }
        return;
      }
      if (key === 'D' && e.shiftKey) {
        e.preventDefault();
        setRemainingStrategy('accept-draft');
        return;
      }
      if (key === 'L' && e.shiftKey) {
        e.preventDefault();
        setRemainingStrategy('accept-live');
      }
    },
    [documents, currentIndex, goToNext, goToPrevious, goToNextUnresolved, setStrategy, setRemainingStrategy, onToggleDetail],
  );

  return (
    <ul
      className={baseClass}
      onKeyDown={handleKeyDown}
      tabIndex={0}
      ref={listRef}
    >
      {documents.map((doc, index) => {
        const counts = diffCounts?.get(doc.documentId);
        const isSelected = index === currentIndex;
        const isConflict =
          doc.changeType === 'conflicting' || doc.changeType === 'deleted-on-main';

        return (
          <li
            key={doc.documentId}
            className={`${baseClass}__item${isSelected ? ` ${baseClass}__item--selected` : ''}`}
            aria-selected={isSelected}
            role="listitem"
            ref={(el) => {
              if (el) itemRefs.current.set(index, el);
            }}
            onClick={() => goToDocument(index)}
          >
            <div className={`${baseClass}__item-row`}>
              <span className={`${baseClass}__path`}>{doc.documentPath}</span>
              {isConflict ? (
                <StatusBadge
                  statusType={strategyStatusTypes[doc.strategy]}
                  label={strategyLabels[doc.strategy]}
                />
              ) : (
                <StatusBadge
                  statusType={changeTypeStatusTypes[doc.changeType]}
                  label={changeTypeLabels[doc.changeType]}
                />
              )}
            </div>

            {counts && (counts.added > 0 || counts.removed > 0 || counts.modified > 0) && (
              <div className={`${baseClass}__diff-counts`}>
                {counts.added > 0 && (
                  <span className={`${baseClass}__diff-badge ${baseClass}__diff-badge--added`}>
                    +{counts.added} added
                  </span>
                )}
                {counts.removed > 0 && (
                  <span className={`${baseClass}__diff-badge ${baseClass}__diff-badge--removed`}>
                    -{counts.removed} removed
                  </span>
                )}
                {counts.modified > 0 && (
                  <span className={`${baseClass}__diff-badge ${baseClass}__diff-badge--modified`}>
                    ~{counts.modified} modified
                  </span>
                )}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
