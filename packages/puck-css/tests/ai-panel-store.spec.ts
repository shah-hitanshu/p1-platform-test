import { describe, it, expect, vi, beforeEach } from 'vitest';
import { aiPanelStore } from '../src/editor/aiPanelStore.js';

beforeEach(() => {
  // Singleton: state survives between tests.
  aiPanelStore.close();
});

describe('aiPanelStore', () => {
  it('starts closed, so the inspector is what the rail shows by default', () => {
    expect(aiPanelStore.isOpen()).toBe(false);
  });

  it('notifies subscribers when the state changes', () => {
    const listener = vi.fn();
    aiPanelStore.subscribe(listener);

    aiPanelStore.open();
    expect(aiPanelStore.isOpen()).toBe(true);
    expect(listener).toHaveBeenCalledTimes(1);

    aiPanelStore.close();
    expect(aiPanelStore.isOpen()).toBe(false);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  // useSyncExternalStore re-reads on every notification, so a no-op notify re-renders for nothing.
  it('stays quiet when asked for the state it is already in', () => {
    const listener = vi.fn();
    aiPanelStore.subscribe(listener);

    aiPanelStore.close();
    expect(listener).not.toHaveBeenCalled();

    aiPanelStore.open();
    aiPanelStore.open();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('toggles from whichever state it is in', () => {
    aiPanelStore.toggle();
    expect(aiPanelStore.isOpen()).toBe(true);
    aiPanelStore.toggle();
    expect(aiPanelStore.isOpen()).toBe(false);
  });

  it('stops notifying an unsubscribed listener', () => {
    const listener = vi.fn();
    const unsubscribe = aiPanelStore.subscribe(listener);

    unsubscribe();
    aiPanelStore.open();

    expect(listener).not.toHaveBeenCalled();
  });

  // Happens by construction: opening the panel unmounts the inspector that subscribed.
  it('still notifies the remaining listeners when one unsubscribes mid-notification', () => {
    const second = vi.fn();
    const unsubscribeFirst = aiPanelStore.subscribe(() => unsubscribeFirst());
    aiPanelStore.subscribe(second);

    expect(() => aiPanelStore.open()).not.toThrow();
    expect(second).toHaveBeenCalledTimes(1);
  });
});
