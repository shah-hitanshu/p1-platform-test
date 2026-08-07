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

  it("asks for the page to be created, with the title and path the dialog collected", () => {
    const { channel, published } = fakeChannel();

    const handler = createGenerateWithAIHandler(channel, true);
    // Narrowed with a throw rather than a `!`: the return type is optional because the
    // handler is undefined when the chatbot is disabled, and the lint rule forbids
    // asserting that away. This keeps the "must be defined when enabled" claim asserted.
    if (!handler) throw new Error("handler must be defined when the chatbot is enabled");
    handler("a launch page", { path: "launch", title: "Launch" });

    // `create-page`, not `fill-page`: nothing exists yet, because the template the page starts
    // from is settled in the chat first and can only be applied as the page is created.
    expect(published).toEqual([
      { kind: "create-page", brief: "a launch page", page: { path: "launch", title: "Launch" } },
    ]);
  });

  it("keeps the nested path the dialog built from a template's route", () => {
    const { channel, published } = fakeChannel();
    const handler = createGenerateWithAIHandler(channel, true);
    if (!handler) throw new Error("handler must be defined when the chatbot is enabled");

    handler("draft", { path: "resources/guide", title: "Guide" });

    expect(published[0]).toEqual({
      kind: "create-page",
      brief: "draft",
      page: { path: "resources/guide", title: "Guide" },
    });
  });

  // The dialog's title field can be left empty; the agent draws one from the brief instead.
  it("sends an empty title rather than omitting it", () => {
    const { channel, published } = fakeChannel();
    const handler = createGenerateWithAIHandler(channel, true);
    if (!handler) throw new Error("handler must be defined when the chatbot is enabled");

    handler("draft", { path: "launch" });

    expect(published[0]).toEqual({
      kind: "create-page",
      brief: "draft",
      page: { path: "launch", title: "" },
    });
  });
});
