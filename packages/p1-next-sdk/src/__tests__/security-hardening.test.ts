import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(__dirname, "..");

describe("p1-next-sdk security hardening", () => {
  it("page-data route uses normalizePath instead of stripTrailingSlash", () => {
    const content = readFileSync(resolve(srcDir, "routes/page-data.ts"), "utf-8");
    expect(content).toContain("normalizePath");
    expect(content).not.toContain("stripTrailingSlash");
  });

  it("publish route validates path before persisting", () => {
    const content = readFileSync(resolve(srcDir, "routes/publish.ts"), "utf-8");
    expect(content).toContain("normalizePath");
    expect(content).toMatch(/400|invalid|bad.?request/i);
  });

  it("auth routes share a single getAuth0Config from a common module", () => {
    const deviceCode = readFileSync(resolve(srcDir, "routes/auth/device-code.ts"), "utf-8");
    const token = readFileSync(resolve(srcDir, "routes/auth/token.ts"), "utf-8");
    expect(deviceCode).not.toMatch(/async function getAuth0Config/);
    expect(token).not.toMatch(/async function getAuth0Config/);
    expect(deviceCode).toContain("getAuth0Config");
    expect(token).toContain("getAuth0Config");
  });

  it("shared auth config module validates issuerBaseUrl", () => {
    const configPath = resolve(srcDir, "routes/auth/config.ts");
    const content = readFileSync(configPath, "utf-8");
    expect(content).toContain("issuerBaseUrl");
    expect(content).toMatch(/https:\/\//);
  });
});
