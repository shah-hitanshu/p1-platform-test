import { describe, expect, it } from "vitest";

import { config } from "../puck.config";

describe("puck.config block labels", () => {
  it("has no two components sharing the same label", () => {
    const labelToKeys = new Map<string, string[]>();

    for (const [key, component] of Object.entries(config.components)) {
      const displayName = (component as { label?: string }).label ?? key;
      const keys = labelToKeys.get(displayName) ?? [];
      keys.push(key);
      labelToKeys.set(displayName, keys);
    }

    const collisions = Array.from(labelToKeys.entries()).filter(
      ([, keys]) => keys.length > 1,
    );

    const message = collisions
      .map(([label, keys]) => `label "${label}" shared by ${keys.join(", ")}`)
      .join("; ");

    expect(collisions, message).toHaveLength(0);
  });
});
