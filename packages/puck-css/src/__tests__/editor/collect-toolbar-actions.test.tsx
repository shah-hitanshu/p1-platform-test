/**
 * Toolbar actions contributed by feature plugins
 *
 * A feature places a control in the editor toolbar by declaring `toolbarActions`,
 * so the toolbar itself stays ignorant of which features exist.
 */

import { describe, it, expect } from 'vitest';
import React from 'react';
import { render, screen, cleanup } from '@testing-library/react';
import type { P1Client } from '@pantheon-systems/css-client';
import { collectToolbarActions, resolveActivePlugins } from '../../editor/composePlugins.js';
import type { P1FeaturePlugin, P1FeaturePluginDeps } from '../../core/plugin-types.js';

const deps: P1FeaturePluginDeps = {
  client: {} as P1Client,
  siteId: 'site-1',
  branchId: 'branch-1',
  userId: 'user-1',
  config: {} as P1FeaturePluginDeps['config'],
};

function pluginWithAction(name: string, label: string, priority?: number): P1FeaturePlugin {
  return {
    name,
    priority,
    toolbarActions: () => <button type="button">{label}</button>,
  };
}

describe('collectToolbarActions', () => {
  it('collects the actions every plugin contributes', () => {
    const actions = collectToolbarActions(
      [pluginWithAction('localization', 'Locales'), pluginWithAction('other', 'Other')],
      deps,
    );

    expect(actions).toHaveLength(2);
  });

  it('skips plugins that contribute no toolbar action', () => {
    const actions = collectToolbarActions(
      [{ name: 'silent' }, pluginWithAction('localization', 'Locales')],
      deps,
    );

    expect(actions).toHaveLength(1);
  });

  it('passes the editor context to each contributor', () => {
    let received: P1FeaturePluginDeps | null = null;
    collectToolbarActions(
      [{ name: 'localization', toolbarActions: (d) => { received = d; return null; } }],
      deps,
    );

    expect(received).toBe(deps);
  });

  it('drops a contributor that renders nothing, so the toolbar spaces only real controls', () => {
    const actions = collectToolbarActions(
      [
        { name: 'empty', toolbarActions: () => null },
        pluginWithAction('localization', 'Locales'),
      ],
      deps,
    );

    expect(actions).toHaveLength(1);
  });

  it('returns the same array when nothing contributes, so the toolbar does not remount', () => {
    const first = collectToolbarActions([{ name: 'silent' }], deps);
    const second = collectToolbarActions([{ name: 'other' }], deps);

    expect(first).toBe(second);
  });

  it('orders actions by plugin priority', () => {
    cleanup();
    const ordered = resolveActivePlugins(
      [pluginWithAction('late', 'Late', 90), pluginWithAction('early', 'Early', 10)],
      {} as P1FeaturePluginDeps['config'],
    );
    const actions = collectToolbarActions(ordered, deps);

    render(<>{actions.map((a, i) => <React.Fragment key={i}>{a}</React.Fragment>)}</>);

    const rendered = screen.getAllByRole('button').map((b) => b.textContent);
    expect(rendered).toEqual(['Early', 'Late']);
    cleanup();
  });
});
