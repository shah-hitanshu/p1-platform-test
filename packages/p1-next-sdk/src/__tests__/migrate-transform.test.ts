/**
 * Unit tests for the p1-migrate codemod's pure string transforms.
 *
 * These cover the mechanical building blocks in isolation; the byte-identical
 * end-to-end proof (OLD starter layout -> HEAD tree) lives in
 * migrate-integration.test.ts.
 */

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import {
  deepenRelativeImports,
  addNamedImport,
  rewriteWrapperSignature,
  rewriteLoadingOverlay,
  rewriteChatbotGate,
  rewriteEditorClient,
  splitPageFile,
  BailError,
  // @ts-expect-error - hand-written ESM JS codemod, no type declarations
} from "../../bin/lib/transform.js";

describe("deepenRelativeImports", () => {
  it("prepends one ../ to a `from` specifier", () => {
    expect(deepenRelativeImports(`import config from "../../../puck.config";`)).toBe(
      `import config from "../../../../puck.config";`,
    );
  });

  it("handles a single-level parent import", () => {
    expect(deepenRelativeImports(`import { X } from "../foo";`)).toBe(
      `import { X } from "../../foo";`,
    );
  });

  it("handles side-effect imports", () => {
    expect(deepenRelativeImports(`import "../styles.css";`)).toBe(
      `import "../../styles.css";`,
    );
  });

  it("handles dynamic imports", () => {
    expect(deepenRelativeImports(`const m = import("../x");`)).toBe(
      `const m = import("../../x");`,
    );
  });

  it("leaves sibling (./) imports untouched", () => {
    const src = `import { E } from "./editor-client";`;
    expect(deepenRelativeImports(src)).toBe(src);
  });

  it("leaves bare package imports untouched", () => {
    const src = `import { useRouter } from "next/navigation";\nimport "@scope/pkg/styles.css";`;
    expect(deepenRelativeImports(src)).toBe(src);
  });
});

describe("addNamedImport", () => {
  it("appends a name by default", () => {
    expect(
      addNamedImport(`import { P1NextRouterProvider } from "@pantheon-systems/p1-next-sdk";`, "@pantheon-systems/p1-next-sdk", "editorPagePathFromUrlPath"),
    ).toBe(
      `import { P1NextRouterProvider, editorPagePathFromUrlPath } from "@pantheon-systems/p1-next-sdk";`,
    );
  });

  it("prepends a name when asked", () => {
    expect(
      addNamedImport(`import { useRouter } from "next/navigation";`, "next/navigation", "usePathname", "prepend"),
    ).toBe(`import { usePathname, useRouter } from "next/navigation";`);
  });

  it("is idempotent when the name is already imported", () => {
    const src = `import { usePathname, useRouter } from "next/navigation";`;
    expect(addNamedImport(src, "next/navigation", "usePathname", "prepend")).toBe(src);
  });

  it("bails when the module import is absent", () => {
    expect(() =>
      addNamedImport(`import { A } from "other";`, "next/navigation", "usePathname"),
    ).toThrow(BailError);
  });
});

describe("rewriteWrapperSignature", () => {
  const legacy = `export function EditorClientWrapper({ path }: { path: string }) {\n  const [userRole] = useState('editor');\n}`;

  it("removes the path prop and injects the URL derivation", () => {
    const out = rewriteWrapperSignature(legacy);
    expect(out).toContain("export function EditorClientWrapper() {");
    expect(out).toContain("const pathname = usePathname();");
    expect(out).toContain("const path = editorPagePathFromUrlPath(pathname);");
    expect(out).not.toContain("{ path }: { path: string }");
    // body after the injection is preserved
    expect(out).toContain("const [userRole] = useState('editor');");
  });

  it("is idempotent when already migrated (no-arg signature)", () => {
    const migrated = `export function EditorClientWrapper() {\n  const pathname = usePathname();\n}`;
    expect(rewriteWrapperSignature(migrated)).toBe(migrated);
  });

  it("bails on an unrecognized signature", () => {
    const custom = `export function EditorClientWrapper({ path, extra }: Props) {\n}`;
    expect(() => rewriteWrapperSignature(custom)).toThrow(BailError);
  });
});

describe("splitPageFile", () => {
  const oldPage = [
    `import "@puckeditor/core/puck.css";`,
    `import { createP1Pages } from "@pantheon-systems/p1-next-sdk/server";`,
    `import config from "../../../puck.config";`,
    `import { EditorClientWrapper } from "./editor-client";`,
    ``,
    `const pages = createP1Pages({`,
    `  config,`,
    `  EditorClient: EditorClientWrapper,`,
    `});`,
    ``,
    `export default pages.Page;`,
    `export const generateMetadata = pages.generateMetadata;`,
    `export const dynamic = "force-dynamic";`,
    ``,
  ].join("\n");

  it("extracts an exported factory into p1-pages with a deepened config import", () => {
    const { p1Pages } = splitPageFile(oldPage);
    expect(p1Pages).toContain(`export const pages = createP1Pages({`);
    expect(p1Pages).toContain(`import config from "../../../../puck.config";`);
    expect(p1Pages).not.toContain(`@puckeditor/core/puck.css`);
    expect(p1Pages).not.toContain(`export default pages.Page;`);
    expect(p1Pages.endsWith("});\n")).toBe(true);
  });

  it("produces a thin page that re-exports from ./p1-pages", () => {
    const { page } = splitPageFile(oldPage);
    expect(page).toBe(
      [
        `import { pages } from "./p1-pages";`,
        ``,
        `export default pages.Page;`,
        `export const generateMetadata = pages.generateMetadata;`,
        `export const dynamic = "force-dynamic";`,
        ``,
      ].join("\n"),
    );
  });

  it("bails when the file is not the recognized createP1Pages page", () => {
    expect(() => splitPageFile(`export default function Page() { return null; }`)).toThrow(
      BailError,
    );
  });

  it("strips the page-level exports whatever order they appear in", () => {
    const reordered = [
      `import { createP1Pages } from "@pantheon-systems/p1-next-sdk/server";`,
      ``,
      `const pages = createP1Pages({});`,
      ``,
      `export const dynamic = "force-dynamic";`,
      `export const generateMetadata = pages.generateMetadata;`,
      `export default pages.Page;`,
      ``,
    ].join("\n");

    const { p1Pages } = splitPageFile(reordered);

    expect(p1Pages).not.toContain(`export default pages.Page;`);
    expect(p1Pages).not.toContain(`export const dynamic`);
    expect(p1Pages).not.toContain(`export const generateMetadata`);
    expect(p1Pages.endsWith("});\n")).toBe(true);
  });

  it("bails rather than emitting a p1-pages that never exports `pages`", () => {
    const unexported = [
      `import { createP1Pages } from "@pantheon-systems/p1-next-sdk/server";`,
      ``,
      `let pages = createP1Pages({});`,
      ``,
      `export default pages.Page;`,
      ``,
    ].join("\n");

    expect(() => splitPageFile(unexported)).toThrow(BailError);
  });
});

describe("rewriteLoadingOverlay", () => {
  const legacy = readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), "fixtures/legacy-editor/editor-client.tsx"),
    "utf-8",
  );

  it("swaps the hand-rolled overlay for the SDK component", () => {
    const out = rewriteLoadingOverlay(legacy);

    expect(out).toContain("<EditorReloadOverlay reloading={reloading} />");
    expect(out).not.toContain("Switching workstream...");
    expect(out).not.toContain("lastGoodStateRef");
  });

  it("imports the component it just started using", () => {
    expect(rewriteLoadingOverlay(legacy)).toContain(
      `  editorPathHref,\n  EditorReloadOverlay,\n} from "@pantheon-systems/puck-css";`,
    );
  });

  it("leaves an app that already uses the SDK overlay alone", () => {
    const once = rewriteLoadingOverlay(legacy);
    expect(rewriteLoadingOverlay(once)).toBe(once);
  });

  it("bails rather than half-rewriting an app that customized the overlay", () => {
    // Kept its own overlay markup, but still has the ref the SDK version drops.
    const partly = legacy.replace("Switching workstream...", "Hang tight, swapping branches");

    expect(() => rewriteLoadingOverlay(partly)).toThrow(BailError);
  });
});

describe("rewriteChatbotGate", () => {
  // The remount key it rewrites is the one the overlay step leaves behind, so the
  // gate runs after it — feed it the same input the codemod does.
  const legacy = rewriteLoadingOverlay(
    readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), "fixtures/legacy-editor/editor-client.tsx"),
      "utf-8",
    ),
  );

  it("hands the whole gate to the SDK", () => {
    const out = rewriteChatbotGate(legacy);

    expect(out).toContain(
      `import { P1ChatbotProvider, useP1Chatbot } from "@pantheon-systems/p1-next-sdk/chatbot";`,
    );
    expect(out).toContain("const chatbot = useP1Chatbot({ onPageCreated: handlePageCreated });");
    expect(out).toContain("...chatbot.pluginOptions,");
    expect(out).toContain("key={`${puckKey}${chatbot.editorKeySuffix}`}");
  });

  it("leaves the app naming no flag, provider or feature-flag package of its own", () => {
    const out = rewriteChatbotGate(legacy);

    expect(out).not.toContain("launchdarkly");
    expect(out).not.toContain("CHATBOT_FLAG_KEY");
    expect(out).not.toContain("ChatbotFlagProvider");
    expect(out).not.toContain("chatbot-flag/");
    expect(out).not.toContain("chatbotEnabled");
  });

  it("leaves an app that already asks the SDK alone", () => {
    const once = rewriteChatbotGate(legacy);
    expect(rewriteChatbotGate(once)).toBe(once);
  });

  // The published starter kits predate the chat plugin's default agent, so they read
  // NEXT_PUBLIC_AGENT_URL themselves and gate on it. That shape has to reach the same
  // place as the current one, or every project scaffolded so far bails.
  it("migrates a scaffold that gates on its own agent URL to the same call", () => {
    const gatesOnItsOwnAgentUrl = legacy
      .replace(
        "  const chatbotEnabled = shouldShowChatbot(flags[CHATBOT_FLAG_KEY]);\n",
        "  const agentUrl = process.env.NEXT_PUBLIC_AGENT_URL;\n" +
          "  const chatbotEnabled = shouldShowChatbot(flags[CHATBOT_FLAG_KEY], agentUrl);\n",
      )
      .replace(
        `      chatbotEnabled
        ? createAIChatPlugin({
            agentUrl: process.env.NEXT_PUBLIC_AGENT_URL,
            draftRequests,
            onPageCreated: handlePageCreated,
          })
        : null,
    [chatbotEnabled, draftRequests, handlePageCreated],`,
        `      chatbotEnabled && agentUrl
        ? createAIChatPlugin({ agentUrl, draftRequests, onPageCreated: handlePageCreated })
        : null,
    [chatbotEnabled, agentUrl, draftRequests, handlePageCreated],`,
      );

    expect(gatesOnItsOwnAgentUrl).not.toBe(legacy);
    expect(rewriteChatbotGate(gatesOnItsOwnAgentUrl)).toBe(rewriteChatbotGate(legacy));
  });

  it("bails rather than half-rewriting an app that customized the wiring", () => {
    // Kept its own remount key, but still has everything else the gate replaces.
    const partly = legacy.replace('${chatbotEnabled ? "ai" : "no-ai"}', "${aiSuffix}");

    expect(() => rewriteChatbotGate(partly)).toThrow(BailError);
  });
});

describe("rewriteEditorClient", () => {
  const legacy = readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), "fixtures/legacy-editor/editor-client.tsx"),
    "utf-8",
  );

  it("moves the route and hands over the gate by default", () => {
    const out = rewriteEditorClient(legacy);

    expect(out).toContain(`import { usePathname, useRouter } from "next/navigation";`);
    expect(out).toContain("useP1Chatbot");
    expect(out).not.toContain("chatbotEnabled");
  });

  it("leaves the app's own gate in place when the chatbot step is skipped", () => {
    const out = rewriteEditorClient(legacy, { chatbot: false });

    // The reason to run the codemod still applies: the route move is unaffected.
    expect(out).toContain(`import { usePathname, useRouter } from "next/navigation";`);
    expect(out).toContain("editorPagePathFromUrlPath");

    expect(out).toContain("chatbotEnabled");
    expect(out).toContain("ChatbotFlagProvider");
    expect(out).not.toContain("@pantheon-systems/p1-next-sdk/chatbot");
  });
});
