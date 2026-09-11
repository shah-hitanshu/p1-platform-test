/**
 * argv parsing and exit codes for `p1-next-sdk enable-registry`.
 * `enableRegistry()` holds the behaviour; this is the process wrapper.
 */

import { resolve } from "node:path";
import { enableRegistry, EnableError } from "./enable-registry.js";
import * as msg from "./enable-messages.js";

export function parseArgs(argv) {
  const args = argv.filter((arg) => arg !== "");
  if (args.includes("--help") || args.includes("-h")) return { help: true };

  const positional = args.filter((arg) => !arg.startsWith("-"));
  if (positional.length > 1) {
    throw new EnableError(`expected at most one directory, got ${positional.length}`);
  }
  const unknown = args.filter((arg) => arg.startsWith("-"));
  if (unknown.length) {
    throw new EnableError(`unrecognized option ${unknown[0]}`);
  }
  return { help: false, dir: resolve(positional[0] ?? ".") };
}

export function runEnableCLI(argv = process.argv.slice(2)) {
  let parsed;
  try {
    parsed = parseArgs(argv);
  } catch (error) {
    msg.failure(error.message);
    process.exit(2);
  }

  if (parsed.help) {
    msg.help();
    return;
  }

  try {
    msg.report(enableRegistry(parsed.dir));
  } catch (error) {
    msg.failure(error instanceof EnableError ? error.message : String(error));
    process.exit(1);
  }
}
