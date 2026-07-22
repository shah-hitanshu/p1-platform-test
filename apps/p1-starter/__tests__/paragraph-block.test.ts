import { describe, expect, it } from "vitest";

describe("paragraphBlock", () => {
  it("has a richtext field for text", async () => {
    const { paragraphBlock } = await import("../components/puck/paragraph-block");
    expect(paragraphBlock.fields.text.type).toBe("richtext");
  });

  it("enables inline canvas editing", async () => {
    const { paragraphBlock } = await import("../components/puck/paragraph-block");
    expect((paragraphBlock.fields.text as any).contentEditable).toBe(true);
  });

  it("includes ai instructions on the text field", async () => {
    const { paragraphBlock } = await import("../components/puck/paragraph-block");
    const ai = (paragraphBlock.fields.text as any).ai;
    expect(ai).toBeDefined();
    expect(typeof ai?.instructions).toBe("string");
    expect(ai?.instructions.length).toBeGreaterThan(0);
  });

  it("provides a renderMenu function", async () => {
    const { paragraphBlock } = await import("../components/puck/paragraph-block");
    expect(typeof (paragraphBlock.fields.text as any).renderMenu).toBe("function");
  });

  it("has a default text prop", async () => {
    const { paragraphBlock } = await import("../components/puck/paragraph-block");
    expect(typeof paragraphBlock.defaultProps.text).toBe("string");
    expect(paragraphBlock.defaultProps.text.length).toBeGreaterThan(0);
  });

  it("provides a render function", async () => {
    const { paragraphBlock } = await import("../components/puck/paragraph-block");
    expect(typeof paragraphBlock.render).toBe("function");
  });
});
