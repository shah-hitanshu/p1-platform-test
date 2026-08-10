/**
 * buildLiveThumbnailDrawer
 *
 * Builds a Puck `drawer` override that replaces the default component list
 * with a visual, thumbnail-driven sidebar:
 *
 *   - components are grouped into collapsible category sections
 *     (from `config.categories`, plus an "Other" bucket for anything
 *     uncategorized);
 *   - the first category is expanded by default, the rest collapsed, so the
 *     initial paint mounts as few live previews as possible;
 *   - each category renders a 2-column grid of ThumbnailCards, each wrapped in
 *     Puck's <Drawer.Item> so it stays draggable onto the canvas.
 *
 * Pass the result to useP1Editor's `additionalOverrides`.
 */

import React from 'react';
import { Drawer } from '@puckeditor/core';
import { Icon } from '@pantheon-systems/pds-toolkit-react';
import { PanelShell } from '../components/PanelShell.js';
import type { PuckOverrides } from '../plugin/index.js';
import { useP1Puck } from '../../core/P1PuckContext.js';
import { PreviewPanelOverlay } from '../components/PreviewPanelOverlay.js';
import { CollapsibleSectionHeader } from '../components/CollapsibleSectionHeader.js';
import { ThumbnailCard, DEFAULT_THUMBNAIL_HEIGHT } from './ThumbnailCard.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type RenderConfig = any;

export interface LiveThumbnailDrawerOptions {
  /** Zoom factor for each preview. */
  scale?: number;
  /** Height of each preview area, in pixels. */
  cardHeight?: number;
  /** Optional callback to close/collapse the blocks panel. */
  onClose?: () => void;
}

const OTHER_KEY = '__other';

interface Section {
  key: string;
  title: string;
  names: string[];
}

function computeSections(config: RenderConfig): Section[] {
  const categories: Record<string, { title?: string; components?: string[] }> =
    config?.categories ?? {};
  const components: Record<string, { label?: string }> = config?.components ?? {};

  const categorized = new Set<string>();
  const sections: Section[] = [];

  for (const [key, category] of Object.entries(categories)) {
    const names = (category.components ?? []).filter((name) => name in components);
    names.forEach((name) => categorized.add(name));
    if (names.length) sections.push({ key, title: category.title ?? key, names });
  }

  const uncategorized = Object.keys(components).filter((name) => !categorized.has(name));
  if (uncategorized.length) {
    sections.push({ key: OTHER_KEY, title: 'Other', names: uncategorized });
  }

  return sections;
}

// ─── Drawer ─────────────────────────────────────────────────────────────────

function LiveThumbnailDrawer({
  config,
  options,
}: {
  config: RenderConfig;
  options: LiveThumbnailDrawerOptions;
}) {
  const { isViewingHistoricalVersion, viewingVersion, returnToLatest } = useP1Puck();
  const sections = React.useMemo(() => computeSections(config), [config]);

  const [expanded, setExpanded] = React.useState<Record<string, boolean>>(() => {
    const first = sections[0];
    return first ? { [first.key]: true } : {};
  });

  const toggle = (key: string) =>
    setExpanded((prev) => ({ ...prev, [key]: !prev[key] }));

  const allOpen = sections.length > 0 && sections.every((s) => !!expanded[s.key]);

  const toggleAll = () => {
    if (allOpen) {
      setExpanded({});
    } else {
      setExpanded(Object.fromEntries(sections.map((s) => [s.key, true])));
    }
  };

  const components: Record<string, { label?: string }> = config?.components ?? {};

  return (
    <PreviewPanelOverlay
      isViewingHistoricalVersion={isViewingHistoricalVersion}
      versionNumber={viewingVersion?.versionNumber ?? undefined}
      onExitPreview={returnToLatest}
    >
    <PanelShell title="Blocks" onCollapse={options.onClose}>
        {/* Toolbar: category count + expand/collapse all */}
        {sections.length > 0 && (
          <div className="p1-blocks-drawer__toolbar">
            <span className="p1-blocks-drawer__toolbar-label">
              {sections.length} {sections.length === 1 ? 'category' : 'categories'}
            </span>
            <button
              type="button"
              className="p1-blocks-drawer__expand-btn"
              onClick={toggleAll}
              aria-label={allOpen ? 'Collapse all categories' : 'Expand all categories'}
            >
              <Icon iconName={allOpen ? 'angleUp' : 'angleDown'} size="s" />
              {allOpen ? 'Collapse all' : 'Expand all'}
            </button>
          </div>
        )}

        {/* Category sections */}
        {sections.map((section) => {
          const open = !!expanded[section.key];
          const btnId = `p1-cat-btn-${section.key}`;
          const gridId = `p1-cat-grid-${section.key}`;
          return (
            <section key={section.key} aria-labelledby={btnId}>
              <CollapsibleSectionHeader
                id={btnId}
                controlsId={gridId}
                title={section.title}
                count={section.names.length}
                open={open}
                onToggle={() => toggle(section.key)}
              />
              {open && (
                <Drawer>
                  <div id={gridId} className="p1-blocks-drawer__grid">
                    {section.names.map((name) => (
                      <Drawer.Item key={name} name={name}>
                        {() => (
                          <ThumbnailCard
                            config={config}
                            name={name}
                            label={components[name]?.label}
                            scale={options.scale}
                            height={options.cardHeight ?? DEFAULT_THUMBNAIL_HEIGHT}
                          />
                        )}
                      </Drawer.Item>
                    ))}
                  </div>
                </Drawer>
              )}
            </section>
          );
        })}
    </PanelShell>
    </PreviewPanelOverlay>
  );
}

/**
 * Returns a `drawer` override rendering the visual thumbnail sidebar for the
 * given Puck config.
 */
export function buildLiveThumbnailDrawer(
  config: RenderConfig,
  options: LiveThumbnailDrawerOptions = {},
): Partial<PuckOverrides> {
  return {
    drawer: () => <LiveThumbnailDrawer config={config} options={options} />,
  };
}
