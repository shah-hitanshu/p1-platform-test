import { vi } from 'vitest';

const puckState = () => ({
  appState: { data: { content: [], root: { props: {} }, zones: {} }, ui: {} },
  config: { components: {} },
  dispatch: vi.fn(),
  refreshPermissions: vi.fn().mockResolvedValue(undefined),
  selectedItem: null,
});

export const createUsePuck =
  () =>
  (selector?: (state: ReturnType<typeof puckState>) => unknown) => {
    const state = puckState();
    return selector ? selector(state) : state;
  };

export const usePuck = () => ({
  dispatch: vi.fn(),
  refreshPermissions: vi.fn().mockResolvedValue(undefined),
});

export const Render = ({ config: _config, data: _data }: { config: unknown; data: unknown }) => null;

export type Config = Record<string, unknown>;
export type Data = { content: unknown[]; root: { props: Record<string, unknown> }; zones: Record<string, unknown> };
export type UiState = Record<string, unknown>;
export type Plugin = { type: string };
