import { describe, expect, it } from "vitest";

import { buildFlagContext } from "../chatbot/flag-context";

const user = (over: Partial<{ id: string; name: string; email: string }> = {}) => ({
  id: "00000000-0000-4000-8000-000000000001",
  name: "Test User",
  ...over,
});

describe("buildFlagContext", () => {
  it("keys on the email so individual targets entered as emails match", () => {
    expect(buildFlagContext(user({ email: "editor@example.com" })).key).toBe(
      "editor@example.com",
    );
  });

  it("lowercases the key, since target matching is case-sensitive", () => {
    expect(buildFlagContext(user({ email: "Editor@Example.com" })).key).toBe(
      "editor@example.com",
    );
  });

  it("keeps the email as a targeting attribute so rules on it still work", () => {
    expect(buildFlagContext(user({ email: "editor@example.com" })).email).toBe(
      "editor@example.com",
    );
  });

  it("falls back to the user id when the user has no email", () => {
    const context = buildFlagContext(user());
    expect(context.key).toBe("00000000-0000-4000-8000-000000000001");
    expect(context.anonymous).toBeUndefined();
    expect(context.email).toBeUndefined();
  });

  // The id is opaque and matched verbatim, so normalizing it would move the target.
  it("leaves the user id untouched when falling back to it", () => {
    expect(buildFlagContext(user({ id: "00000000-0000-4000-8000-ABCDEF000002" })).key).toBe("00000000-0000-4000-8000-ABCDEF000002");
  });

  it("treats a blank email as absent rather than keying on an empty string", () => {
    expect(buildFlagContext(user({ email: "   " })).key).toBe(
      "00000000-0000-4000-8000-000000000001",
    );
  });

  it("marks the pre-auth context anonymous", () => {
    expect(buildFlagContext(null)).toEqual({
      kind: "user",
      key: "anonymous",
      anonymous: true,
    });
  });
});
