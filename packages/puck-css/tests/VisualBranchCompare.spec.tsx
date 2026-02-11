/**
 * Visual Branch Compare Tests
 *
 * Tests for the visual side-by-side branch comparison with rendered Puck pages
 * and multi-document support.
 */

import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { VisualBranchCompare } from '../src/components/version-compare/VisualBranchCompare.js';
import type { DocumentDiffSummary } from '../src/utils/branchDiff.js';

// Mock Puck's Render component - simulate using the config's render functions
vi.mock('@puckeditor/core', () => ({
  Render: ({ data, config }: { data: unknown; config: { components: Record<string, { render: (props: Record<string, unknown>) => React.ReactNode }> } }) => {
    const puckData = data as { content: Array<{ type: string; props: Record<string, unknown> & { id: string } }> };
    return (
      <div data-testid="puck-render">
        {puckData.content.map((component) => {
          const componentConfig = config.components[component.type];
          if (componentConfig && componentConfig.render) {
            return (
              <div key={component.props.id}>
                {componentConfig.render(component.props)}
              </div>
            );
          }
          return (
            <div key={component.props.id} data-component-id={component.props.id}>
              {component.type}
            </div>
          );
        })}
      </div>
    );
  },
}));

// Sample Puck config for testing
const mockConfig = {
  components: {
    Heading: {
      label: 'Heading',
      render: ({ text }: { text: string }) => <h2>{text}</h2>,
    },
    Text: {
      label: 'Text',
      render: ({ content }: { content: string }) => <p>{content}</p>,
    },
  },
};

const sourceSnapshot = {
  content: [
    { type: 'Heading', props: { id: 'h1', text: 'Hello World' } },
    { type: 'Text', props: { id: 't1', content: 'Original text' } },
  ],
  root: { props: {} },
};

const targetSnapshot = {
  content: [
    { type: 'Heading', props: { id: 'h1', text: 'Hello World' } },
    { type: 'Text', props: { id: 't1', content: 'Modified text' } },
    { type: 'Text', props: { id: 't2', content: 'New component' } },
  ],
  root: { props: {} },
};

const singleDocuments: DocumentDiffSummary[] = [
  {
    documentId: 'doc-1',
    documentPath: 'homepage',
    sourceSnapshot,
    targetSnapshot,
  },
];

const multipleDocuments: DocumentDiffSummary[] = [
  {
    documentId: 'doc-1',
    documentPath: 'homepage',
    sourceSnapshot,
    targetSnapshot,
  },
  {
    documentId: 'doc-2',
    documentPath: 'about',
    sourceSnapshot: {
      content: [
        { type: 'Heading', props: { id: 'h2', text: 'About Us' } },
      ],
      root: { props: {} },
    },
    targetSnapshot: {
      content: [
        { type: 'Heading', props: { id: 'h2', text: 'About Us' } },
      ],
      root: { props: {} },
    },
  },
];

describe('VisualBranchCompare', () => {
  it('should render header with branch names', () => {
    render(
      <VisualBranchCompare
        sourceBranchName="feature-branch"
        targetBranchName="main"
        documents={singleDocuments}
        config={mockConfig}
        onClose={() => {}}
      />
    );

    expect(screen.getAllByText('feature-branch').length).toBeGreaterThan(0);
    expect(screen.getAllByText('main').length).toBeGreaterThan(0);
  });

  it('should render two preview panels with Source and Target labels', () => {
    render(
      <VisualBranchCompare
        sourceBranchName="feature-branch"
        targetBranchName="main"
        documents={singleDocuments}
        config={mockConfig}
        onClose={() => {}}
      />
    );

    expect(screen.getByText('Source branch')).toBeInTheDocument();
    expect(screen.getByText('Target branch')).toBeInTheDocument();
  });

  it('should render Puck content in both panels', () => {
    render(
      <VisualBranchCompare
        sourceBranchName="feature-branch"
        targetBranchName="main"
        documents={singleDocuments}
        config={mockConfig}
        onClose={() => {}}
      />
    );

    const renderAreas = screen.getAllByTestId('puck-render');
    expect(renderAreas).toHaveLength(2);
  });

  it('should call onClose when close button is clicked', () => {
    const onClose = vi.fn();
    render(
      <VisualBranchCompare
        sourceBranchName="feature-branch"
        targetBranchName="main"
        documents={singleDocuments}
        config={mockConfig}
        onClose={onClose}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /close/i }));
    expect(onClose).toHaveBeenCalled();
  });

  it('should show empty state when no changes between branches', () => {
    const noChangeDocs: DocumentDiffSummary[] = [
      {
        documentId: 'doc-1',
        documentPath: 'homepage',
        sourceSnapshot,
        targetSnapshot: sourceSnapshot,
      },
    ];

    render(
      <VisualBranchCompare
        sourceBranchName="feature-branch"
        targetBranchName="main"
        documents={noChangeDocs}
        config={mockConfig}
        onClose={() => {}}
      />
    );

    expect(screen.getByText(/no changes/i)).toBeInTheDocument();
  });

  it('should apply custom className', () => {
    const { container } = render(
      <VisualBranchCompare
        sourceBranchName="feature-branch"
        targetBranchName="main"
        documents={singleDocuments}
        config={mockConfig}
        onClose={() => {}}
        className="custom-class"
      />
    );

    expect(container.querySelector('.custom-class')).toBeInTheDocument();
  });

  it('should render arrow between branch names', () => {
    render(
      <VisualBranchCompare
        sourceBranchName="feature-branch"
        targetBranchName="main"
        documents={singleDocuments}
        config={mockConfig}
        onClose={() => {}}
      />
    );

    expect(screen.getByText('→')).toBeInTheDocument();
  });
});

describe('VisualBranchCompare - Document Selector', () => {
  it('should show document selector when multiple documents are provided', () => {
    render(
      <VisualBranchCompare
        sourceBranchName="feature-branch"
        targetBranchName="main"
        documents={multipleDocuments}
        config={mockConfig}
        onClose={() => {}}
      />
    );

    const select = screen.getByRole('combobox');
    expect(select).toBeInTheDocument();
  });

  it('should not show document selector with a single document', () => {
    render(
      <VisualBranchCompare
        sourceBranchName="feature-branch"
        targetBranchName="main"
        documents={singleDocuments}
        config={mockConfig}
        onClose={() => {}}
      />
    );

    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  });

  it('should show document paths with change counts in selector', () => {
    const { container } = render(
      <VisualBranchCompare
        sourceBranchName="feature-branch"
        targetBranchName="main"
        documents={multipleDocuments}
        config={mockConfig}
        onClose={() => {}}
      />
    );

    const options = container.querySelectorAll('option');
    expect(options.length).toBe(2);

    // First doc has changes, second does not
    expect(options[0].textContent).toContain('homepage');
    expect(options[0].textContent).toMatch(/\d+ change/);
    expect(options[1].textContent).toContain('about');
  });

  it('should switch displayed document when selector changes', () => {
    render(
      <VisualBranchCompare
        sourceBranchName="feature-branch"
        targetBranchName="main"
        documents={multipleDocuments}
        config={mockConfig}
        onClose={() => {}}
      />
    );

    const select = screen.getByRole('combobox');

    // Switch to second document (about page, no changes)
    fireEvent.change(select, { target: { value: '1' } });

    // Should show no changes for the about page
    expect(screen.getByText(/no changes/i)).toBeInTheDocument();
  });

  it('should default to first document with changes', () => {
    const docsWithChangesSecond: DocumentDiffSummary[] = [
      {
        documentId: 'doc-no-change',
        documentPath: 'unchanged-page',
        sourceSnapshot,
        targetSnapshot: sourceSnapshot,
      },
      {
        documentId: 'doc-changed',
        documentPath: 'changed-page',
        sourceSnapshot,
        targetSnapshot,
      },
    ];

    const { container } = render(
      <VisualBranchCompare
        sourceBranchName="feature-branch"
        targetBranchName="main"
        documents={docsWithChangesSecond}
        config={mockConfig}
        onClose={() => {}}
      />
    );

    const select = container.querySelector('select');
    expect(select).toBeTruthy();
    expect((select as HTMLSelectElement).value).toBe('1');
  });
});

describe('VisualBranchCompare - Diff Highlighting', () => {
  it('should mark added components with added indicator', () => {
    const { container } = render(
      <VisualBranchCompare
        sourceBranchName="feature-branch"
        targetBranchName="main"
        documents={singleDocuments}
        config={mockConfig}
        onClose={() => {}}
      />
    );

    const addedIndicators = container.querySelectorAll('[data-diff-type="added"]');
    expect(addedIndicators.length).toBeGreaterThan(0);
  });

  it('should mark modified components with modified indicator', () => {
    const { container } = render(
      <VisualBranchCompare
        sourceBranchName="feature-branch"
        targetBranchName="main"
        documents={singleDocuments}
        config={mockConfig}
        onClose={() => {}}
      />
    );

    const modifiedIndicators = container.querySelectorAll('[data-diff-type="modified"]');
    expect(modifiedIndicators.length).toBeGreaterThan(0);
  });
});

describe('VisualBranchCompare - Legend', () => {
  it('should show a legend explaining diff colors', () => {
    const { container } = render(
      <VisualBranchCompare
        sourceBranchName="feature-branch"
        targetBranchName="main"
        documents={singleDocuments}
        config={mockConfig}
        onClose={() => {}}
      />
    );

    const legend = container.querySelector('.visual-version-compare__legend');
    expect(legend).toBeInTheDocument();
    expect(container.querySelector('.visual-version-compare__legend-item--added')).toBeInTheDocument();
    expect(container.querySelector('.visual-version-compare__legend-item--modified')).toBeInTheDocument();
    expect(container.querySelector('.visual-version-compare__legend-item--removed')).toBeInTheDocument();
  });
});
