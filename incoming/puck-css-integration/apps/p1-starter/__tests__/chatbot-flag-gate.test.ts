import { describe, expect, it } from "vitest";
import { shouldShowChatbot, CHATBOT_FLAG_KEY } from "../lib/chatbot-flag/feature-gate";

describe("shouldShowChatbot", () => {
  it("is off when the flag is disabled, even with an agent URL", () => {
    expect(shouldShowChatbot(false, "https://agent.example")).toBe(false);
  });

  it("is off when the agent URL is missing, even with the flag enabled", () => {
    expect(shouldShowChatbot(true, undefined)).toBe(false);
    expect(shouldShowChatbot(true, "")).toBe(false);
  });

  it("is on only when the flag is enabled AND the agent URL is set", () => {
    expect(shouldShowChatbot(true, "https://agent.example")).toBe(true);
  });

  it("defaults off when the flag value is undefined (LD not yet resolved / offline)", () => {
    expect(shouldShowChatbot(undefined, "https://agent.example")).toBe(false);
  });

  it("exposes the p1-chatbot flag key", () => {
    expect(CHATBOT_FLAG_KEY).toBe("p1-chatbot");
  });
});
