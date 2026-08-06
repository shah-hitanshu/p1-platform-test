/**
 * Tests for <PresenceStack> component.
 *
 * Covers the contract only — how many avatars render, the overflow badge and
 * its name list, and the image → initials → icon fallback order. Pure styling
 * (overlap, rings, paint order) is verified visually, not here.
 */

import { describe, it, expect } from 'vitest';
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
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
  it('lets no avatar branch pick its own PDS size', () => {
    render(
      <PresenceStack
        actors={[
          makeActor({ id: 'a', name: 'Alice', avatar: 'https://example.com/a.jpg' }),
          makeActor({ id: 'b', name: 'Bob' }),
          makeActor({ id: 'c', name: '' }),
        ]}
      />,
    );

    const avatars = screen.getAllByTestId('presence-avatar');
    expect(avatars).toHaveLength(3);
    for (const el of avatars) {
      expect(el.className).not.toMatch(/pds-avatar--(xs|m|l)\b/);
    }
  });

  it('skips the tooltip wrapper for an actor with no resolved name', () => {
    const named = render(<PresenceStack actors={[makeActor({ id: 'n', name: 'Alice' })]} />);
    expect(named.container.querySelector('span[title]')?.getAttribute('title')).toBe('Alice');
    named.unmount();

    // An empty name would otherwise render the wrapper with title=""
    const unnamed = render(<PresenceStack actors={[makeActor({ id: 'u', name: '' })]} />);
    expect(unnamed.container.querySelector('span[title]')).toBeNull();
    expect(screen.getByTestId('presence-avatar')).toBeDefined();
  });

  it('skips the tooltip on the +N badge when no hidden actor has a name', () => {
    const unnamed = [
      makeActor({ id: 'u1', name: '' }),
      makeActor({ id: 'u2', name: '' }),
      makeActor({ id: 'u3', name: '' }),
    ];

    const some = render(
      <PresenceStack actors={[makeActor({ id: 'n', name: 'Alice' }), ...unnamed]} maxVisible={1} />,
    );
    expect(screen.getByTestId('presence-overflow').textContent).toBe('+3');
    // every hidden actor is unnamed, so hiddenNames is '' -> no title wrapper on the
    // badge. Scoped to the overflow wrapper: the visible actor has its own tooltip.
    expect(
      screen.getByTestId('presence-overflow-wrapper').querySelector('span[title]'),
    ).toBeNull();
    some.unmount();

    render(<PresenceStack actors={[...unnamed, makeActor({ id: 'z', name: 'Zoe' })]} maxVisible={1} />);
    expect(screen.getByTestId('presence-overflow').closest('span[title]')?.getAttribute('title'))
      .toBe('Zoe');
  });


  it('emits the badge first and the actors reversed, with no inline z-index', () => {
    const { container } = render(<PresenceStack actors={fiveActors} maxVisible={3} />);

    const wrappers = [...container.querySelectorAll('[data-testid$="-wrapper"]')];
    expect(wrappers[0]?.getAttribute('data-testid')).toBe('presence-overflow-wrapper');
    expect(wrappers.slice(1).map((w) => w.textContent)).toEqual(['C', 'B', 'A']);
    for (const w of wrappers) expect(w.getAttribute('style')).toBeNull();
  });

  it('renders at most maxVisible avatars', () => {
    const { unmount } = render(<PresenceStack actors={threeActors} maxVisible={3} />);
    expect(screen.getAllByTestId('presence-avatar')).toHaveLength(3);
    unmount();

    render(<PresenceStack actors={fiveActors} maxVisible={3} />);
    expect(screen.getAllByTestId('presence-avatar')).toHaveLength(3);
  });

  it('defaults maxVisible to 3', () => {
    render(<PresenceStack actors={fiveActors} />);

    expect(screen.getAllByTestId('presence-avatar')).toHaveLength(3);
  });

  it('shows a "+N" badge only when actors exceed maxVisible', () => {
    const { unmount } = render(<PresenceStack actors={threeActors} maxVisible={3} />);
    expect(screen.queryByTestId('presence-overflow')).toBeNull();
    unmount();

    render(<PresenceStack actors={fiveActors} maxVisible={3} />);
    expect(screen.getByTestId('presence-overflow').textContent).toContain('+2');
  });

  it('lists only the hidden collaborators in the overflow tooltip', () => {
    render(<PresenceStack actors={fiveActors} maxVisible={3} />);

    expect(screen.getByTitle('Dave, Eve')).toBeTruthy();
    expect(screen.queryByTitle(/Alice, Bob, Carol/)).toBeNull();
  });

  it('renders nothing when actors is empty', () => {
    render(<PresenceStack actors={[]} maxVisible={3} />);

    expect(screen.queryByTestId('presence-avatar')).toBeNull();
    expect(screen.queryByTestId('presence-overflow')).toBeNull();
  });

  it('gives each avatar a tooltip with the actor name', () => {
    render(<PresenceStack actors={threeActors} maxVisible={3} />);

    ['Alice', 'Bob', 'Carol'].forEach((name) => {
      expect(screen.getByTitle(name)).toBeTruthy();
    });
  });

  // Image → initials → icon. Initials come from the prototype, which labels
  // collaborators "MR / NB / OK"; the signed-in user keeps the generic icon.
  it('falls back from profile image to initials to the PDS user icon', () => {
    const withImage = render(
      <PresenceStack
        actors={[makeActor({ name: 'Marco Reyes', avatar: 'https://example.com/m.jpg' })]}
      />,
    );
    let avatar = screen.getByTestId('presence-avatar');
    const img = avatar.querySelector('.pds-avatar__image') as HTMLImageElement;
    expect(img.src).toBe('https://example.com/m.jpg');
    // Google OAuth avatars 403 without this.
    expect(img.getAttribute('referrerpolicy')).toBe('no-referrer');
    expect(avatar.textContent).toBe('');
    withImage.unmount();

    const withName = render(<PresenceStack actors={[makeActor({ name: 'Marco Reyes' })]} />);
    avatar = screen.getByTestId('presence-avatar');
    expect(avatar.textContent).toBe('MR');
    expect(avatar.style.backgroundColor).not.toBe('');
    withName.unmount();

    render(<PresenceStack actors={[makeActor({ name: '   ' })]} />);
    expect(
      screen.getByTestId('presence-avatar').querySelector('.pds-avatar__user-icon'),
    ).toBeTruthy();
  });

  // A dead avatar URL (expired Google link, 404, CORS refusal) must re-enter
  // the fallback chain. PDS <Avatar> does this itself, but the image branch is
  // hand-rolled — without an onError it would render a broken image box.
  it('falls back to initials when the profile image fails to load', () => {
    const withAvatar = (url: string) => (
      <PresenceStack actors={[makeActor({ id: 'a', name: 'Marco Reyes', avatar: url })]} />
    );
    const { rerender } = render(withAvatar('https://example.com/gone.jpg'));

    fireEvent.error(screen.getByAltText('Marco Reyes'));

    const avatar = screen.getByTestId('presence-avatar');
    expect(avatar.textContent).toBe('MR');
    expect(avatar.querySelector('img')).toBeNull();

    // A different URL is a fresh attempt — the failure must not stick to the
    // actor, or a corrected profile photo would never appear.
    rerender(withAvatar('https://example.com/new.jpg'));
    expect(screen.getByAltText('Marco Reyes')).toBeTruthy();
  });

  // Off by default so other consumers of the stack are unaffected.
  it('renders a live dot per visible avatar only when showActiveDot is set', () => {
    const { unmount } = render(<PresenceStack actors={threeActors} maxVisible={3} />);
    expect(screen.queryByTestId('presence-active-dot')).toBeNull();
    unmount();

    render(<PresenceStack actors={fiveActors} maxVisible={3} showActiveDot />);
    expect(screen.getAllByTestId('presence-active-dot')).toHaveLength(3);
  });

  // The dot means "live", so it has to come from each actor's own ActorState.
  // A room-level flag marked idle collaborators live alongside the active one.
  // Idle actors are still present, so they get the hollow grey variant.
  it('draws the filled dot for live actors and the idle variant for the rest', () => {
    const mixed = [
      makeActor({ id: 'a', name: 'Active', state: 'active' }),
      makeActor({ id: 'i', name: 'Idle', state: 'idle' }),
      makeActor({ id: 'e', name: 'Editing', state: 'editing' }),
    ];

    const { unmount } = render(<PresenceStack actors={mixed} maxVisible={3} showActiveDot />);
    expect(screen.getAllByTestId('presence-avatar')).toHaveLength(3);
    expect(screen.getAllByTestId('presence-active-dot')).toHaveLength(2);
    expect(screen.getAllByTestId('presence-idle-dot')).toHaveLength(1);
    unmount();

    // showActiveDot off suppresses both variants.
    render(<PresenceStack actors={mixed} maxVisible={3} />);
    expect(screen.queryByTestId('presence-active-dot')).toBeNull();
    expect(screen.queryByTestId('presence-idle-dot')).toBeNull();
  });
});
