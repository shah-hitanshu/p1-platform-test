/**
 * All console output for `p1-next-sdk enable-registry`, in one place. Plain text
 * — no color dependency — so the SDK's runtime deps stay unchanged.
 */

const TAG = "[p1-next-sdk]";

export function help() {
  console.log(
    [
      "enable-registry — wire an existing P1 app up to the @p1 code registry",
      "",
      "Usage:",
      "  npx @pantheon-systems/p1-next-sdk enable-registry [dir]",
      "",
      "Writes components.json, creates components/puck/blocks/index.ts, and adds the",
      "@/* path alias to tsconfig.json. Anything already in place is left alone, so",
      "running it twice changes nothing.",
      "",
      "It does not edit puck.config.tsx — that file is yours. The two lines to add",
      "are printed at the end.",
    ].join("\n"),
  );
}

export function report({ done, skipped, manual, puckConfigWired }) {
  for (const item of done) console.log(`${TAG} wrote ${item}`);
  for (const item of skipped) console.log(`${TAG} skipped — ${item}`);
  for (const item of manual) console.log(`${TAG} action needed — ${item}`);

  if (!puckConfigWired) {
    console.log(
      [
        "",
        "Last step. Spread the barrel in puck.config.tsx, both entries first:",
        "",
        '  import { p1Blocks, p1Categories } from "./components/puck/blocks";',
        "",
        "  categories: { ...p1Categories, /* your own categories after */ },",
        "  components: { ...p1Blocks,     /* your own blocks after */ },",
        "",
        "Order matters: later keys win in an object literal, so a spread placed last",
        "lets a registry category overwrite one of yours — the blocks stay registered",
        "and vanish from the editor drawer, with no error.",
      ].join("\n"),
    );
  } else {
    console.log(`${TAG} skipped — puck.config already spreads the barrel`);
  }

  console.log(
    [
      "",
      "Then install a block. The install prints the lines to register it:",
      "",
      "  npx shadcn@latest add @p1/pricing",
    ].join("\n"),
  );
}

export function failure(message) {
  console.error(`${TAG} ${message}`);
}
