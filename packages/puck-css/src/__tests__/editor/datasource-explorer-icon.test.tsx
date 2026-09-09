/**
 * The Data sources tab wore the AI sparkles icon for two releases because the
 * rail painted icons onto tab *positions*: styles.css targeted `nth-child(4)`,
 * and the rail reorders whenever a plugin gains or loses `render`, so the rule
 * landed on whichever plugin happened to sit there.
 *
 * React-only assertions cannot catch that — an earlier version of this test
 * asserted the correct SVG while the running editor showed sparkles. So pin the
 * stylesheet too: no nav rule may key off tab position.
 */

import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import React from "react";

import { createRemoteDatasourceExplorerPlugin } from "../../p1/editor/remote-datasources/remote-datasource-explorer-plugin";

const DB_CYLINDER_TOP = "M12 4c4.4 0 8 1.3 8 3s-3.6 3-8 3-8-1.3-8-3 3.6-3 8-3z";
const here = dirname(fileURLToPath(import.meta.url));
const navStylesheets = [
  join(here, "../../styles.css"),
  join(here, "../../pds/theme/PuckEditorTheme.css"),
];

describe("datasource explorer nav rail icon", () => {
  it("renders the database cylinder, not a PDS glyph", () => {
    const plugin = createRemoteDatasourceExplorerPlugin({
      editorPath: "/people/1",
    });

    const { container } = render(<>{plugin.icon}</>);

    const svg = container.querySelector("svg");
    expect(svg).not.toBeNull();
    expect(svg?.getAttribute("width")).toBe("20");
    expect(
      Array.from(container.querySelectorAll("path")).map((p) =>
        p.getAttribute("d"),
      ),
    ).toContain(DB_CYLINDER_TOP);
  });
});

describe("puck nav rail stylesheets", () => {
  it.each(navStylesheets)("paints no nav icon by tab position (%s)", (path) => {
    const positional = readFileSync(path, "utf8")
      .split("\n")
      .filter((line) => /Nav(-list|Item)/.test(line) && /nth-child/.test(line));

    expect(positional).toEqual([]);
  });

  it("does not reintroduce the sparkles glyph", () => {
    for (const path of navStylesheets) {
      expect(readFileSync(path, "utf8")).not.toContain("576 512");
    }
  });
});
