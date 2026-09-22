import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AgentBlockMarker } from '../src/collaboration/components/AgentBlockMarker.js';

describe('AgentBlockMarker', () => {
  it('draws the badge and names the agent', () => {
    const { container } = render(<AgentBlockMarker actorName="Acme Copywriter" />);

    expect(container.querySelector('.focus-region-agent__avatar')).toBeInTheDocument();
    expect(container.querySelector('.focus-region-agent__name')).toHaveTextContent(
      'Acme Copywriter',
    );
  });

  it('carries no banner and no control', () => {
    const { container } = render(<AgentBlockMarker actorName="Acme Copywriter" />);

    expect(container.querySelector('[role="status"]')).not.toBeInTheDocument();
    expect(container.querySelector('button')).not.toBeInTheDocument();
  });

  // Named here so a rename cannot quietly break the end-to-end suite.
  it('carries the handles an end-to-end test targets', () => {
    render(<AgentBlockMarker actorName="Acme Copywriter" />);

    expect(screen.getByTestId('agent-block-marker')).toBeInTheDocument();
    expect(screen.getByTestId('agent-block-marker-name')).toHaveTextContent('Acme Copywriter');
  });
});
