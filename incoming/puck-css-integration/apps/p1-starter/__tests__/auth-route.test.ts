import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const appDir = resolve(__dirname, "..");

describe("auth route does not force re-authentication on every login", () => {
  const content = readFileSync(
    resolve(appDir, "app/p1/auth/[...action]/route.ts"),
    "utf-8",
  );

  it("does not hardcode an OAuth prompt override", () => {
    // prompt: 'login' forces Google's full re-auth screen on every broker
    // login, even with a live Google session — see PCC-3391.
    expect(content).not.toMatch(/prompt\s*:\s*['"]login['"]/);
  });

  it("uses select_account so users can still switch Google accounts", () => {
    // Omitting `prompt` entirely silently re-authenticates whichever Google
    // account has a live session, with no way to pick a different one on
    // logout/login. select_account shows a lightweight account chooser
    // (one click if already signed in) without forcing full re-auth.
    expect(content).toMatch(/prompt\s*:\s*['"]select_account['"]/);
  });
});
