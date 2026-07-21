/**
 * Syncs this site's Puck component registry (_registry/components/* and the
 * registry index) headlessly, without opening the editor in a browser.
 * Intended to run from CI on push to main or a branch whose name matches a
 * CSS branch, whenever puck.config.tsx or components/puck/** change.
 *
 * Usage: tsx scripts/sync-puck-registry.ts [--dry-run]
 *
 * Required env vars (see validateEnv below for the full fallback contract):
 *   CSS_BASE_URL, CSS_SITE_ID, CSS_REGISTRY_API_KEY
 *
 * CSS_REGISTRY_API_KEY must be a sat_ site token scoped to write:registry
 * only — do not reuse a read-scoped token (P1_CSS_API_KEY). Because that
 * token has no read access at all, every run rewrites every component
 * descriptor + the registry index unconditionally (no skip-if-unchanged) —
 * see syncComponentRegistryWriteOnly.
 */

import { register } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { P1Client } from "@pantheon-systems/css-client";
import type { Branch } from "@pantheon-systems/css-client";
import { extractDescriptors, syncComponentRegistryWriteOnly } from "@pantheon-systems/puck-css/registry-sync";

export interface ValidatedEnv {
  baseUrl: string;
  siteId: string;
  apiKey: string;
  branchOverride?: string;
  puckConfigPath: string;
}

export function validateEnv(env: Record<string, string | undefined>): ValidatedEnv {
  const baseUrl = env.CSS_BASE_URL ?? env.NEXT_PUBLIC_CSS_BASE_URL;
  const siteId = env.CSS_SITE_ID ?? env.NEXT_PUBLIC_CSS_SITE_ID;
  const apiKey = env.CSS_REGISTRY_API_KEY;
  const branchOverride = env.CSS_BRANCH_ID ?? env.NEXT_PUBLIC_CSS_BRANCH_ID;
  const puckConfigPath = env.PUCK_CONFIG_PATH ?? "puck.config.tsx";

  const missing: string[] = [];
  if (baseUrl === undefined || baseUrl === "") {
    missing.push("CSS_BASE_URL (or NEXT_PUBLIC_CSS_BASE_URL)");
  }
  if (siteId === undefined || siteId === "") {
    missing.push("CSS_SITE_ID (or NEXT_PUBLIC_CSS_SITE_ID)");
  }
  if (apiKey === undefined || apiKey === "") {
    if (env.P1_CSS_API_KEY !== undefined && env.P1_CSS_API_KEY !== "") {
      missing.push(
        "CSS_REGISTRY_API_KEY — do not reuse P1_CSS_API_KEY (your read-scoped site token); " +
          "create a separate sat_ token scoped to write:registry",
      );
    } else {
      missing.push("CSS_REGISTRY_API_KEY");
    }
  }

  if (missing.length > 0) {
    throw new Error(`Missing required environment variable(s):\n  - ${missing.join("\n  - ")}`);
  }

  return {
    baseUrl: baseUrl as string,
    siteId: siteId as string,
    apiKey: apiKey as string,
    branchOverride,
    puckConfigPath,
  };
}

export function resolveConfigModule(mod: unknown): unknown {
  const record = mod as Record<string, unknown>;
  return record.default ?? record.config ?? mod;
}

/**
 * Thrown by resolveBranchId when no CSS branch matches. Distinguished from
 * other errors so callers (main(), a CI trigger firing on every git branch)
 * can treat "this branch has no CSS counterpart" as a benign no-op rather
 * than a real sync failure.
 */
export class NoBranchMatchError extends Error {}

export function resolveBranchId(branches: Branch[], siteId: string, override?: string): string {
  if (override !== undefined && override !== "") {
    const match = branches.find((b) => b.id === override || b.name === override);
    if (match === undefined) {
      throw new NoBranchMatchError(`No branch matching "${override}" found for site ${siteId}`);
    }
    return match.id;
  }
  const mainBranch = branches.find((b) => b.isMain);
  if (mainBranch === undefined) {
    throw new NoBranchMatchError("No main branch found for site " + siteId);
  }
  return mainBranch.id;
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes("--dry-run");

  // Registered here (not at module scope) so importing this file for tests
  // never installs a process-wide loader hook.
  register("./asset-stub-hooks.mjs", import.meta.url);

  const { baseUrl, siteId, apiKey, branchOverride, puckConfigPath } = validateEnv(process.env);

  const configUrl = pathToFileURL(path.resolve(process.cwd(), puckConfigPath)).href;
  const mod: unknown = await import(configUrl);
  const puckConfig = resolveConfigModule(mod);

  const descriptors = extractDescriptors(puckConfig);

  const client = new P1Client({ baseUrl, apiKey });
  const branches = await client.branches.list(siteId);
  const branchId = resolveBranchId(branches, siteId, branchOverride);

  if (dryRun) {
    console.log(
      `[sync-puck-registry] Dry run: ${String(descriptors.length)} component descriptor(s) found for site ${siteId}, branch ${branchId}. No writes performed.`,
    );
    return;
  }

  const result = await syncComponentRegistryWriteOnly(client, siteId, branchId, descriptors);
  console.log(
    `[sync-puck-registry] Synced site ${siteId}, branch ${branchId}: ` +
      `wrote ${String(result.total)} component descriptor(s) + registry index`,
  );
}

const isMainModule = import.meta.url === pathToFileURL(process.argv[1] ?? "").href;
if (isMainModule) {
  main().catch((err: unknown) => {
    // A CI trigger firing on every git branch push has no way to know ahead
    // of time which branches have a matching CSS branch — that has to be
    // discovered at runtime. Treat "no match" as a benign no-op, not a
    // failure, so unrelated feature-branch pushes don't turn CI red.
    if (err instanceof NoBranchMatchError) {
      console.log(`[sync-puck-registry] Skipping: ${err.message}`);
      return;
    }
    const message = err instanceof Error ? err.message : String(err);
    console.error("[sync-puck-registry] FAILED:", message);
    process.exitCode = 1;
  });
}
