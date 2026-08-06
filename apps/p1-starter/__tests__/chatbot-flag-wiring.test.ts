import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const appDir = resolve(__dirname, "..");

describe("editor-client gates the chatbot behind the p1-chatbot flag", () => {
  const content = readFileSync(
    resolve(appDir, "app/p1/(editor)/[[...p1]]/editor-client.tsx"),
    "utf-8",
  );

  it("reads LaunchDarkly flags via useFlags", () => {
    expect(content).toContain("useFlags");
  });

  it("gates the AI plugin through shouldShowChatbot", () => {
    expect(content).toContain("shouldShowChatbot");
  });

  it("wraps the editor in the chatbot flag provider", () => {
    expect(content).toContain("ChatbotFlagProvider");
  });

  it("imports the plugin from the published @pantheon-systems/p1-ai-chat package", () => {
    expect(content).toContain("@pantheon-systems/p1-ai-chat");
  });
});

describe("editor-client wires Generate with AI to the chat sidebar", () => {
  const content = readFileSync(
    resolve(appDir, "app/p1/(editor)/[[...p1]]/editor-client.tsx"),
    "utf-8",
  );

  it("uses the shared (singleton) agent request channel", () => {
    expect(content).toContain("getDraftRequestChannel");
  });

  it("passes the request channel to the chat plugin", () => {
    expect(content).toMatch(/createAIChatPlugin\(\{[^}]*draftRequests/);
  });

  it("wires onGenerateWithAI to publish onto the channel via the handler", () => {
    expect(content).toContain("onGenerateWithAI");
    expect(content).toContain("createGenerateWithAIHandler");
  });
});

describe("chatbot flag provider is a client-side LaunchDarkly gate", () => {
  const content = readFileSync(
    resolve(appDir, "components/ChatbotFlagProvider.tsx"),
    "utf-8",
  );

  it("initializes from the public client-side ID env var", () => {
    expect(content).toContain("NEXT_PUBLIC_LD_CLIENT_ID");
  });

  it("uses the launchdarkly-react-client-sdk", () => {
    expect(content).toContain("launchdarkly-react-client-sdk");
  });
});
