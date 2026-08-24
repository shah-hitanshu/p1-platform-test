import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

let panelOpen = false;

vi.mock('@pantheon-systems/puck-css', () => ({
  useAIPanelOpen: () => panelOpen,
}));
vi.mock('../src/components/panel/ChatPanel.js', () => ({
  ChatPanel: () => <div data-testid="chat-panel" />,
}));

const { AIFieldsOverride } = await import('../src/components/panel/AIFieldsOverride.js');

const options = { agentUrl: 'http://agent.test' };

describe('AIFieldsOverride', () => {
  // `children` is the inspector; dropping it would leave the editor with no field list.
  it('renders the inspector while the panel is closed', () => {
    panelOpen = false;
    render(
      <AIFieldsOverride options={options}>
        <div data-testid="inspector" />
      </AIFieldsOverride>,
    );

    expect(screen.getByTestId('inspector')).toBeTruthy();
    expect(screen.queryByTestId('chat-panel')).toBeNull();
  });

  it('replaces the inspector with the panel while open', () => {
    panelOpen = true;
    render(
      <AIFieldsOverride options={options}>
        <div data-testid="inspector" />
      </AIFieldsOverride>,
    );

    expect(screen.getByTestId('chat-panel')).toBeTruthy();
    expect(screen.queryByTestId('inspector')).toBeNull();
  });
});
