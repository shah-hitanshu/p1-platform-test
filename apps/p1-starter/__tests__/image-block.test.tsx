import { describe, expect, it } from "vitest";
import { isValidElement, type ReactNode } from "react";

const SRC = "https://example.com/photo.jpg";

// react-dom is not available where the scaffolded template runs its tests, so
// inspect the element tree the block returns rather than rendering it.
function findImg(node: ReactNode): Record<string, unknown> | null {
  if (node == null || typeof node !== "object") return null;
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findImg(child);
      if (found) return found;
    }
    return null;
  }
  if (!isValidElement(node)) return null;
  const props = (node.props ?? {}) as Record<string, unknown>;
  if (node.type === "img") return props;
  return findImg(props.children as ReactNode);
}

describe("imageBlock", () => {
  it("exposes a loading field defaulting to lazy", async () => {
    const { imageBlock } = await import("../components/puck/image-block");
    expect(imageBlock.fields.loading.type).toBe("radio");
    expect(imageBlock.fields.loading.options.map((o) => o.value)).toEqual([
      "lazy",
      "eager",
    ]);
    expect(imageBlock.defaultProps.loading).toBe("lazy");
  });

  it("lazy-loads even when the prop is missing (documents saved before the field existed)", async () => {
    const { imageBlock } = await import("../components/puck/image-block");
    const img = findImg(imageBlock.render({ src: SRC, alt: "A photo" }));
    expect(img?.loading).toBe("lazy");
    expect(img?.decoding).toBe("async");
  });

  it("renders eager when the editor chooses it", async () => {
    const { imageBlock } = await import("../components/puck/image-block");
    const img = findImg(
      imageBlock.render({ src: SRC, alt: "A photo", loading: "eager" }),
    );
    expect(img?.loading).toBe("eager");
  });
});
