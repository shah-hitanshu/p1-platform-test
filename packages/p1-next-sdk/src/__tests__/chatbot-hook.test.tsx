// @vitest-environment jsdom
/**
 * An application wires this result through without branching on it, so "off" has to be
 * expressible as values: no plugins, no handler, and a canvas key suffix that still
 * changes if availability does.
 */
import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  state: { flags: {} as Record<string, unknown> },
  plugin: { name: "ai-chat" },
  createAIChatPlugin: vi.fn(),
}));

vi.mock("launchdarkly-react-client-sdk", () => ({
  useFlags: () => h.state.flags,
}));

vi.mock("@pantheon-systems/p1-ai-chat", () => ({
  createAIChatPlugin: (...args: unknown[]) => {
    h.createAIChatPlugin(...args);
    return h.plugin;
  },
  createDraftRequestChannel: () => ({ publish: vi.fn(), subscribe: vi.fn() }),
}));

import { useP1Chatbot } from "../chatbot/useP1Chatbot";

const chatbot = () =>
  renderHook(() => useP1Chatbot({ onPageCreated: () => {} })).result.current;

beforeEach(() => {
  h.createAIChatPlugin.mockClear();
  h.state.flags = {};
  vi.stubEnv("NEXT_PUBLIC_AGENT_URL", "https://agent.example.com");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("useP1Chatbot", () => {
  it("contributes nothing while the rollout flag is off", () => {
    const result = chatbot();

    expect(result.plugins).toEqual([]);
    expect(result.pluginOptions.onGenerateWithAI).toBeUndefined();
    expect(result.pluginOptions.showAIPanelToggle).toBe(false);
    expect(result.editorKeySuffix).toBe("-no-ai");
    expect(h.createAIChatPlugin).not.toHaveBeenCalled();
  });

  it("mounts the chat plugin once the flag is on", () => {
    h.state.flags = { "p1-chatbot": true };

    const result = chatbot();

    expect(result.plugins).toEqual([h.plugin]);
    expect(result.pluginOptions.onGenerateWithAI).toBeTypeOf("function");
    expect(result.pluginOptions.showAIPanelToggle).toBe(true);
    expect(result.editorKeySuffix).toBe("-ai");
    expect(h.createAIChatPlugin).toHaveBeenCalledWith(
      expect.objectContaining({ agentUrl: "https://agent.example.com" }),
    );
  });

  // An unconfigured site reaches the production agent, which is the plugin's own default
  // — so the hook passes the variable through rather than treating unset as "no chatbot".
  it("leaves an unconfigured agent URL for the plugin to default", () => {
    h.state.flags = { "p1-chatbot": true };
    vi.stubEnv("NEXT_PUBLIC_AGENT_URL", undefined);

    const result = chatbot();

    expect(result.plugins).toEqual([h.plugin]);
    expect(result.editorKeySuffix).toBe("-ai");
    expect(h.createAIChatPlugin).toHaveBeenCalledWith(
      expect.objectContaining({ agentUrl: undefined }),
    );
  });
});
