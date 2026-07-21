/**
 * End-to-end test for the ChatAgent Worker.
 *
 * Usage:
 *   CSS_TOKEN=<your-css-token> node scripts/test-agent.mjs
 *
 * Optional overrides:
 *   AGENT_URL=https://... SITE_ID=... BRANCH_ID=... DOCUMENT_PATH=...
 */

import { WebSocket } from "ws";

const AGENT_URL =
  process.env.AGENT_URL ??
  "https://p1-chatbot-agent-sbx1.chris-801.workers.dev";
const CSS_TOKEN = process.env.CSS_TOKEN;
const SITE_ID = process.env.SITE_ID ?? "";
const BRANCH_ID = process.env.BRANCH_ID ?? "";
const DOCUMENT_PATH = process.env.DOCUMENT_PATH ?? "/test";
const MESSAGE =
  process.env.MESSAGE ?? "List the branches on the Audi Demo site";

if (!CSS_TOKEN) {
  console.error("Error: CSS_TOKEN env var is required.");
  console.error("  CSS_TOKEN=<token> node scripts/test-agent.mjs");
  process.exit(1);
}

const wsUrl = `${AGENT_URL.replace(/^http/, "ws")}/agents/chat-agent/test-session`;
console.log(`Connecting to ${wsUrl}`);
console.log(`Message: "${MESSAGE}"\n`);

const ws = new WebSocket(wsUrl);

ws.on("open", () => {
  ws.send(
    JSON.stringify({
      type: "chat",
      message: MESSAGE,
      context: {
        siteId: SITE_ID,
        branchId: BRANCH_ID,
        documentPath: DOCUMENT_PATH,
        token: CSS_TOKEN,
      },
    }),
  );
});

ws.on("message", (data) => {
  const msg = JSON.parse(data.toString());

  switch (msg.type) {
    case "token":
      process.stdout.write(msg.content);
      break;
    case "tool_start":
      console.log(
        `\n[tool] → ${msg.toolName}`,
        msg.toolInput ? JSON.stringify(msg.toolInput) : "",
      );
      break;
    case "tool_end":
      console.log(
        `[tool] ← ${msg.toolName}`,
        JSON.stringify(msg.toolResult).slice(0, 120),
      );
      break;
    case "done":
      console.log("\n\n✓ Done");
      ws.close();
      break;
    case "error":
      console.error(`\n✗ Error: ${msg.error}`);
      ws.close();
      process.exit(1);
  }
});

ws.on("error", (err) => {
  console.error("WebSocket error:", err.message);
  process.exit(1);
});
