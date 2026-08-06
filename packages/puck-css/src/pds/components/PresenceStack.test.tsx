/**
 * Tests for <PresenceStack> component.
 *
 * Validates PDS Avatar rendering up to maxVisible, overflow badge display,
 * empty state, and per-avatar tooltip/title accessibility.
 */

import { describe, it, expect } from 'vitest';
import React from 'react';
import { render, screen } from '@testing-library/react';
import type { ActorPresence } from '@pantheon-systems/css-client';
import { PresenceStack } from './PresenceStack.js';

// =============================================================================
// Mock Data
// =============================================================================

function makeActor(overrides: Partial<ActorPresence> = {}): ActorPresence {
  const id = overrides.id ?? 'actor-1';
  return {
    id,
    actorId: overrides.actorId ?? id,
    actorType: overrides.actorType ?? 'user',
    role: overrides.role ?? 'human',
    name: overrides.name ?? `Actor ${id}`,
    state: overrides.state ?? 'active',
    lastActivityAt: overrides.lastActivityAt ?? new Date().toISOString(),
    joinedAt: overrides.joinedAt ?? new Date().toISOString(),
    ...overrides,
  };
}

const threeActors: ActorPresence[] = [
  makeActor({ id: 'actor-1', name: 'Alice' }),
  makeActor({ id: 'actor-2', name: 'Bob', actorType: 'agent', role: 'agent' }),
  makeActor({ id: 'actor-3', name: 'Carol' }),
];

const fiveActors: ActorPresence[] = [
  ...threeActors,
  makeActor({ id: 'actor-4', name: 'Dave' }),
  makeActor({ id: 'actor-5', name: 'Eve' }),
];

describe('PresenceStack', () => {
  it('renders one avatar per actor when count equals maxVisible', () => {
    render(<PresenceStack actors={threeActors} maxVisible={3} />);

    const avatars = screen.getAllByTestId('presence-avatar');
    expect(avatars).toHaveLength(3);
  });

  it('renders one avatar per actor when count is below maxVisible', () => {
    render(<PresenceStack actors={threeActors} maxVisible={5} />);

    const avatars = screen.getAllByTestId('presence-avatar');
    expect(avatars).toHaveLength(3);
  });

  it('renders only maxVisible avatars when actors.length exceeds maxVisible', () => {
    render(<PresenceStack actors={fiveActors} maxVisible={3} />);

    const avatars = screen.getAllByTestId('presence-avatar');
    expect(avatars).toHaveLength(3);
  });

  it('renders overflow badge with "+N" when actors.length > maxVisible', () => {
    render(<PresenceStack actors={fiveActors} maxVisible={3} />);

    const overflow = screen.getByTestId('presence-overflow');
    expect(overflow).toBeDefined();
    expect(overflow.textContent).toContain('+2');
  });

  it('does not render overflow badge when actors.length equals maxVisible', () => {
    render(<PresenceStack actors={threeActors} maxVisible={3} />);

    expect(screen.queryByTestId('presence-overflow')).toBeNull();
  });

  it('does not render overflow badge when actors.length is below maxVisible', () => {
    render(<PresenceStack actors={threeActors} maxVisible={5} />);

    expect(screen.queryByTestId('presence-overflow')).toBeNull();
  });

  it('renders nothing (or an empty container) when actors is empty', () => {
    const { container } = render(<PresenceStack actors={[]} maxVisible={3} />);

    expect(screen.queryByTestId('presence-avatar')).toBeNull();
    expect(screen.queryByTestId('presence-overflow')).toBeNull();
    const avatars = container.querySelectorAll('[data-testid="presence-avatar"]');
    expect(avatars.length).toBe(0);
  });

  it('each avatar wrapper has a title with the actor name', () => {
    render(<PresenceStack actors={threeActors} maxVisible={3} />);

    const names = ['Alice', 'Bob', 'Carol'];
    names.forEach((name) => {
      expect(screen.getByTitle(name)).toBeTruthy();
    });
  });

  it('uses default maxVisible of 3 when prop is omitted', () => {
    render(<PresenceStack actors={fiveActors} />);

    const avatars = screen.getAllByTestId('presence-avatar');
    expect(avatars.length).toBeLessThanOrEqual(3);
    expect(screen.getByTestId('presence-overflow')).toBeDefined();
  });

  it('renders PDS Avatar with user fallback when no profile image', () => {
    render(<PresenceStack actors={[makeActor({ id: 'no-img', name: 'NoImage' })]} />);

    const avatar = screen.getByTestId('presence-avatar');
    expect(avatar.querySelector('.pds-avatar__user-icon')).toBeTruthy();
  });

  it('renders PDS Avatar with image when actor has an avatar URL', () => {
    const actorWithImage = makeActor({ id: 'with-img', name: 'HasImage', avatar: 'https://example.com/photo.jpg' });
    render(<PresenceStack actors={[actorWithImage]} />);

    const avatar = screen.getByTestId('presence-avatar');
    const img = avatar.querySelector('.pds-avatar__image') as HTMLImageElement;
    expect(img).toBeTruthy();
    expect(img.src).toBe('https://example.com/photo.jpg');
  });

  it('sets referrerPolicy="no-referrer" on avatar image for Google OAuth URLs', () => {
    const actorWithImage = makeActor({ id: 'google-user', avatar: 'https://lh3.googleusercontent.com/a/photo' });
    render(<PresenceStack actors={[actorWithImage]} />);

    const avatar = screen.getByTestId('presence-avatar');
    const img = avatar.querySelector('.pds-avatar__image') as HTMLImageElement;
    expect(img).toBeTruthy();
    expect(img.getAttribute('referrerpolicy')).toBe('no-referrer');
  });
});
