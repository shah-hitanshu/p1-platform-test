/**
 * JSON Diff Viewer Component
 *
 * Displays two JSON documents side-by-side with diff highlighting.
 * Shows which properties were added, removed, or changed between versions.
 */

import type { DiffOperation } from '../types';
import './JsonDiffViewer.css';

interface JsonDiffViewerProps {
  sourceData: Record<string, unknown> | null;
  targetData: Record<string, unknown> | null;
  diffOperations: DiffOperation[];
  sourceLabel?: string;
  targetLabel?: string;
}

/**
 * Creates a set of all paths that are affected by diff operations
 */
function getAffectedPaths(operations: DiffOperation[]): Map<string, DiffOperation['op']> {
  const paths = new Map<string, DiffOperation['op']>();
  for (const op of operations) {
    paths.set(op.path, op.op);
  }
  return paths;
}

/**
 * Determines if a path is affected by any operation (including parent paths)
 */
function getOperationType(path: string, affectedPaths: Map<string, DiffOperation['op']>): DiffOperation['op'] | null {
  // Check exact path
  if (affectedPaths.has(path)) {
    return affectedPaths.get(path) ?? null;
  }

  // Check if any child path is affected
  for (const [affectedPath] of affectedPaths) {
    if (affectedPath.startsWith(path + '/')) {
      return 'replace'; // Has child changes
    }
  }

  return null;
}

interface JsonLineProps {
  content: string;
  path: string;
  affectedPaths: Map<string, DiffOperation['op']>;
  side: 'source' | 'target';
}

/**
 * Renders a single line of JSON with appropriate highlighting
 */
function JsonLine({ content, path, affectedPaths, side }: JsonLineProps) {
  const opType = getOperationType(path, affectedPaths);

  let className = 'json-line';
  if (opType === 'add' && side === 'target') {
    className += ' diff-added';
  } else if (opType === 'remove' && side === 'source') {
    className += ' diff-removed';
  } else if (opType === 'replace') {
    className += ' diff-changed';
  }

  return <div className={className}>{content}</div>;
}

/**
 * Recursively renders JSON with diff highlighting
 */
function renderJsonWithPaths(
  data: unknown,
  affectedPaths: Map<string, DiffOperation['op']>,
  side: 'source' | 'target',
  currentPath: string = '',
  indent: number = 0
): React.ReactNode[] {
  const lines: React.ReactNode[] = [];
  const indentStr = '  '.repeat(indent);

  if (data === null) {
    lines.push(
      <JsonLine
        key={currentPath || 'null'}
        content={`${indentStr}null`}
        path={currentPath}
        affectedPaths={affectedPaths}
        side={side}
      />
    );
  } else if (typeof data === 'object' && !Array.isArray(data)) {
    const obj = data as Record<string, unknown>;
    const keys = Object.keys(obj);

    if (keys.length === 0) {
      lines.push(
        <JsonLine
          key={currentPath || 'empty'}
          content={`${indentStr}{}`}
          path={currentPath}
          affectedPaths={affectedPaths}
          side={side}
        />
      );
    } else {
      lines.push(
        <JsonLine
          key={`${currentPath}-open`}
          content={`${indentStr}{`}
          path={currentPath}
          affectedPaths={affectedPaths}
          side={side}
        />
      );

      keys.forEach((key, index) => {
        const propPath = `${currentPath}/${key}`;
        const value = obj[key];
        const isLast = index === keys.length - 1;

        if (typeof value === 'object' && value !== null) {
          lines.push(
            <JsonLine
              key={`${propPath}-key`}
              content={`${'  '.repeat(indent + 1)}"${key}":`}
              path={propPath}
              affectedPaths={affectedPaths}
              side={side}
            />
          );
          lines.push(...renderJsonWithPaths(value, affectedPaths, side, propPath, indent + 1));
          if (!isLast) {
            lines.push(
              <div key={`${propPath}-comma`} className="json-line">,</div>
            );
          }
        } else {
          const valueStr = JSON.stringify(value);
          lines.push(
            <JsonLine
              key={propPath}
              content={`${'  '.repeat(indent + 1)}"${key}": ${valueStr}${isLast ? '' : ','}`}
              path={propPath}
              affectedPaths={affectedPaths}
              side={side}
            />
          );
        }
      });

      lines.push(
        <JsonLine
          key={`${currentPath}-close`}
          content={`${indentStr}}`}
          path={currentPath}
          affectedPaths={affectedPaths}
          side={side}
        />
      );
    }
  } else if (Array.isArray(data)) {
    if (data.length === 0) {
      lines.push(
        <JsonLine
          key={currentPath || 'empty-array'}
          content={`${indentStr}[]`}
          path={currentPath}
          affectedPaths={affectedPaths}
          side={side}
        />
      );
    } else {
      lines.push(
        <JsonLine
          key={`${currentPath}-open`}
          content={`${indentStr}[`}
          path={currentPath}
          affectedPaths={affectedPaths}
          side={side}
        />
      );

      data.forEach((item, index) => {
        const itemPath = `${currentPath}/${index}`;
        const isLast = index === data.length - 1;

        if (typeof item === 'object' && item !== null) {
          lines.push(...renderJsonWithPaths(item, affectedPaths, side, itemPath, indent + 1));
          if (!isLast) {
            lines.push(
              <div key={`${itemPath}-comma`} className="json-line">,</div>
            );
          }
        } else {
          const valueStr = JSON.stringify(item);
          lines.push(
            <JsonLine
              key={itemPath}
              content={`${'  '.repeat(indent + 1)}${valueStr}${isLast ? '' : ','}`}
              path={itemPath}
              affectedPaths={affectedPaths}
              side={side}
            />
          );
        }
      });

      lines.push(
        <JsonLine
          key={`${currentPath}-close`}
          content={`${indentStr}]`}
          path={currentPath}
          affectedPaths={affectedPaths}
          side={side}
        />
      );
    }
  } else {
    lines.push(
      <JsonLine
        key={currentPath || 'primitive'}
        content={`${indentStr}${JSON.stringify(data)}`}
        path={currentPath}
        affectedPaths={affectedPaths}
        side={side}
      />
    );
  }

  return lines;
}

export function JsonDiffViewer({
  sourceData,
  targetData,
  diffOperations,
  sourceLabel = 'Source',
  targetLabel = 'Target',
}: JsonDiffViewerProps) {
  const affectedPaths = getAffectedPaths(diffOperations);

  const hasSource = sourceData !== null;
  const hasTarget = targetData !== null;

  // Handle deleted documents
  if (!hasSource && !hasTarget) {
    return (
      <div className="json-diff-viewer">
        <div className="diff-empty">No content to compare</div>
      </div>
    );
  }

  return (
    <div className="json-diff-viewer">
      <div className="diff-legend">
        <span className="legend-item legend-added">Added</span>
        <span className="legend-item legend-removed">Removed</span>
        <span className="legend-item legend-changed">Changed</span>
      </div>

      <div className="diff-container">
        <div className="diff-pane source-pane">
          <div className="diff-header">{sourceLabel}</div>
          <div className="diff-content">
            {hasSource ? (
              <pre className="diff-json">
                {renderJsonWithPaths(sourceData, affectedPaths, 'source')}
              </pre>
            ) : (
              <div className="diff-deleted-notice">Document deleted</div>
            )}
          </div>
        </div>

        <div className="diff-pane target-pane">
          <div className="diff-header">{targetLabel}</div>
          <div className="diff-content">
            {hasTarget ? (
              <pre className="diff-json">
                {renderJsonWithPaths(targetData, affectedPaths, 'target')}
              </pre>
            ) : (
              <div className="diff-deleted-notice">Document deleted</div>
            )}
          </div>
        </div>
      </div>

      {diffOperations.length > 0 && (
        <div className="diff-summary">
          {diffOperations.length} change{diffOperations.length !== 1 ? 's' : ''} detected
        </div>
      )}
    </div>
  );
}
