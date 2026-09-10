import { describe, expect, it } from "vitest";
import { sanitizeRichtextHtml } from "../data/sanitize-richtext.js";

describe("sanitizeRichtextHtml", () => {
  it("strips <script> tags", () => {
    const out = sanitizeRichtextHtml("<p>hi</p><script>alert(1)</script>");
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
      "<p><strong>bold</strong> and <em>italic</em></p>" +
      "<ul><li>one</li><li>two</li></ul>" +
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

  it("keeps the block elements a paste can carry through the editor schema", () => {
    const out = sanitizeRichtextHtml(
      "<h2>Title</h2><h3>Sub</h3><blockquote>quoted</blockquote><p><mark>note</mark></p>",
    );
    expect(out).toContain("<h2>Title</h2>");
    expect(out).toContain("<h3>Sub</h3>");
    expect(out).toContain("<blockquote>quoted</blockquote>");
    expect(out).toContain("<mark>note</mark>");
  });
});

describe("sanitizeRichtextHtml options", () => {
  it("allows an extra tag without dropping the defaults", () => {
    const input = "<figure><figcaption>cap</figcaption></figure><p><em>keep</em></p>";
    expect(sanitizeRichtextHtml(input)).not.toContain("<figure");

    const out = sanitizeRichtextHtml(input, {
      allowedTags: ["figure", "figcaption"],
    });
    expect(out).toContain("<figure>");
    expect(out).toContain("<figcaption>cap</figcaption>");
    expect(out).toContain("<em>keep</em>");
  });

  it("allows an extra attribute without dropping the defaults", () => {
    const out = sanitizeRichtextHtml(
      '<p><a href="https://example.com" title="t" id="x">link</a></p>',
      { allowedAttrs: ["title"] },
    );
    expect(out).toContain('title="t"');
    expect(out).toContain('href="https://example.com"');
    expect(out).not.toContain('id="x"');
  });

  it("ignores tag additions that would let stored content run script", () => {
    const out = sanitizeRichtextHtml(
      '<p>hi</p><script>alert(1)</script><iframe src="https://evil.example"></iframe>',
      { allowedTags: ["script", "iframe", "object", "embed", "base", "form"] },
    );
    expect(out.toLowerCase()).not.toContain("<script");
    expect(out.toLowerCase()).not.toContain("<iframe");
    expect(out).not.toContain("alert(1)");
    expect(out).toContain("<p>hi</p>");
  });

  it("ignores event-handler and resource-fetching attribute additions", () => {
    const out = sanitizeRichtextHtml(
      '<p onclick="steal()" srcdoc="x" formaction="y" style="background:url(https://evil.example)">text</p>',
      { allowedAttrs: ["onclick", "onerror", "srcdoc", "formaction", "style", "src"] },
    );
    expect(out.toLowerCase()).not.toContain("onclick");
    expect(out.toLowerCase()).not.toContain("srcdoc");
    expect(out.toLowerCase()).not.toContain("formaction");
    expect(out.toLowerCase()).not.toContain("style");
    expect(out).toContain("text");
  });

  it("ignores resource-tag additions, which would otherwise reopen data: URIs", () => {
    const options = { allowedTags: ["img", "video", "audio", "source", "track"] };

    for (const html of [
      '<img src="https://cdn.example/a.png">',
      '<img src="data:text/html,x">',
      '<video src="data:text/html,x"></video>',
      '<audio src="data:text/html,x"></audio>',
    ]) {
      const out = sanitizeRichtextHtml(`<p>t</p>${html}`, { ...options, allowedAttrs: ["src"] });
      expect(out).toBe("<p>t</p>");
    }
  });

  it("cannot widen the link-protocol allowlist through a tag or attribute addition", () => {
    const out = sanitizeRichtextHtml('<a href="javascript:alert(1)">click</a>', {
      allowedTags: ["a"],
      allowedAttrs: ["href"],
    });
    expect(out.toLowerCase()).not.toContain("javascript:");
    expect(out).toContain("click");
  });

  it("matches unconfigured output when the options are empty", () => {
    const input = '<p><strong>b</strong></p><a href="/x">l</a>';
    expect(sanitizeRichtextHtml(input, {})).toBe(sanitizeRichtextHtml(input));
    expect(sanitizeRichtextHtml(input, { allowedTags: [] })).toBe(
      sanitizeRichtextHtml(input),
    );
  });

  it("normalizes additions to lower case so casing cannot smuggle a forbidden tag", () => {
    const out = sanitizeRichtextHtml("<p>hi</p><script>alert(1)</script>", {
      allowedTags: ["SCRIPT"],
    });
    expect(out.toLowerCase()).not.toContain("<script");
    expect(out).not.toContain("alert(1)");
  });
});
