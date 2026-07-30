import { describe, it, expect } from "vitest";
import type { DraftRequest, DraftRequestChannel } from "@pantheon-systems/p1-ai-chat";
import { createGenerateWithAIHandler } from "../lib/chatbot-flag/ai-generate";

/**
 * A recording stand-in for the request channel. The real channel is unit-tested in
 * `p1-ai-chat`; here we only assert what the handler publishes. Using a fake also
 * keeps this test from importing the package's runtime (which pulls in CSS).
 */
function fakeChannel(): { channel: DraftRequestChannel; published: DraftRequest[] } {
  const published: DraftRequest[] = [];
  const channel: DraftRequestChannel = {
    publish: (request) => {
      published.push(request);
    },
    subscribe: () => () => {},
    getLatest: () => published[published.length - 1] ?? null,
    clearLatest: () => {},
  };
  return { channel, published };
}

describe("createGenerateWithAIHandler", () => {
  it("returns undefined when the chatbot is disabled (leaves the modal tile a placeholder)", () => {
    const { channel } = fakeChannel();
    expect(createGenerateWithAIHandler(channel, false)).toBeUndefined();
  });

  it("publishes the brief + page path onto the channel when enabled", () => {
    const { channel, published } = fakeChannel();

    const handler = createGenerateWithAIHandler(channel, true);
    // Narrowed with a throw rather than a `!`: the return type is optional because the
    // handler is undefined when the chatbot is disabled, and the lint rule forbids
    // asserting that away. This keeps the "must be defined when enabled" claim asserted.
    if (!handler) throw new Error("handler must be defined when the chatbot is enabled");
    handler("a launch page", { path: "launch" });

    // `newPage` tells the agent the page was just created empty, so it drafts instead of
    // opening with a clarifying question (PCC-3440, confirmed with Chris). It travels in
    // the request rather than appended to the brief, so the transcript keeps showing only
    // what the user wrote.
    expect(published).toEqual([
      { brief: "a launch page", documentPath: "launch", newPage: true },
    ]);
  });

  it("maps page.path to the request documentPath so the agent targets the new page", () => {
    const { channel, published } = fakeChannel();
    const handler = createGenerateWithAIHandler(channel, true);
    if (!handler) throw new Error("handler must be defined when the chatbot is enabled");

    handler("draft", { path: "resources/guide" });

    expect(published[0]).toEqual({
      brief: "draft",
      documentPath: "resources/guide",
      newPage: true,
    });
  });
});
