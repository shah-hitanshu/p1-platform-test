import { describe, expect, it } from "vitest";
import { shouldShowChatbot, CHATBOT_FLAG_KEY } from "../lib/chatbot-flag/feature-gate";

describe("shouldShowChatbot", () => {
  it("is off when the flag is disabled", () => {
    expect(shouldShowChatbot(false)).toBe(false);
  });

  it("is on when the flag is enabled", () => {
    expect(shouldShowChatbot(true)).toBe(true);
  });

  it("defaults off when the flag value is undefined (LD not yet resolved / offline)", () => {
    expect(shouldShowChatbot(undefined)).toBe(false);
  });

  it("exposes the p1-chatbot flag key", () => {
    expect(CHATBOT_FLAG_KEY).toBe("p1-chatbot");
  });
});
