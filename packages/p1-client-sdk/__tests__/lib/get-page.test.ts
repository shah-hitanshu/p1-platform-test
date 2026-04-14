import { describe, expect, it } from "vitest";

import { pickTemplateSourcePath } from "../../src/lib/route-templates";

const JEDI_TEMPLATE = "/jedi/:id";
const KEYS = [JEDI_TEMPLATE];

describe("pickTemplateSourcePath (integration with jedi-style DB keys)", () => {
  it("returns template key for concrete instance paths", () => {
    expect(pickTemplateSourcePath("/jedi/1", KEYS)).toBe(JEDI_TEMPLATE);
    expect(pickTemplateSourcePath("/jedi/42", KEYS)).toBe(JEDI_TEMPLATE);
    expect(pickTemplateSourcePath("/jedi/luke", KEYS)).toBe(JEDI_TEMPLATE);
    expect(pickTemplateSourcePath("/jedi/5/", KEYS)).toBe(JEDI_TEMPLATE);
  });

  it("does not remap the template storage path itself", () => {
    expect(pickTemplateSourcePath(JEDI_TEMPLATE, KEYS)).toBeNull();
  });

  it("returns null for non-matching paths", () => {
    expect(pickTemplateSourcePath("/about", KEYS)).toBeNull();
    expect(pickTemplateSourcePath("/jedi", KEYS)).toBeNull();
    expect(pickTemplateSourcePath("/jedi/a/b", KEYS)).toBeNull();
  });
});
