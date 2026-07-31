import { describe, expect, it } from "vitest";
import { sanitizeRichtextHtml } from "../components/puck/sanitize-richtext";

describe("sanitizeRichtextHtml", () => {
  it("strips <script> tags", () => {
    const out = sanitizeRichtextHtml('<p>hi</p><script>alert(1)</script>');
    expect(out).not.toContain("<script");
    expect(out).not.toContain("alert(1)");
    expect(out).toContain("<p>hi</p>");
  });

  it("drops javascript: hrefs but keeps the link text", () => {
    const out = sanitizeRichtextHtml('<a href="javascript:alert(1)">click</a>');
    expect(out.toLowerCase()).not.toContain("javascript:");
    expect(out).toContain("click");
  });

  it("drops data: hrefs", () => {
    const out = sanitizeRichtextHtml(
      '<a href="data:text/html,<script>alert(1)</script>">x</a>',
    );
    expect(out.toLowerCase()).not.toContain("data:");
    expect(out.toLowerCase()).not.toContain("<script");
  });

  it("removes <img> and its onerror handler entirely", () => {
    const out = sanitizeRichtextHtml('<img src="x" onerror="alert(1)">');
    expect(out.toLowerCase()).not.toContain("<img");
    expect(out.toLowerCase()).not.toContain("onerror");
  });

  it("strips inline event-handler attributes", () => {
    const out = sanitizeRichtextHtml('<p onclick="steal()">text</p>');
    expect(out.toLowerCase()).not.toContain("onclick");
    expect(out).toContain("text");
  });

  it("preserves safe formatting, lists, and https links", () => {
    const input =
      '<p><strong>bold</strong> and <em>italic</em></p>' +
      '<ul><li>one</li><li>two</li></ul>' +
      '<a href="https://example.com">safe link</a>';
    const out = sanitizeRichtextHtml(input);
    expect(out).toContain("<strong>bold</strong>");
    expect(out).toContain("<em>italic</em>");
    expect(out).toContain("<li>one</li>");
    expect(out).toContain('href="https://example.com"');
  });

  it("keeps relative and anchor hrefs", () => {
    expect(sanitizeRichtextHtml('<a href="/about">a</a>')).toContain(
      'href="/about"',
    );
    expect(sanitizeRichtextHtml('<a href="#section">a</a>')).toContain(
      'href="#section"',
    );
  });
});
