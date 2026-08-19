import type { Data } from "@puckeditor/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  resolveDataTemplates,
  resolveStringTemplates,
} from "../../data/resolve-data-templates";
import { extractReferencedDatasourceIds } from "../../data/remote-datasources/loader";
import { encodePagesBlocksTemplate } from "../../data/cross-reference";

vi.mock("../../data/get-page", () => ({
  getPage: vi.fn(async () => null),
}));

import { getPage } from "../../data/get-page";

describe("resolveStringTemplates", () => {
  it("replaces a single placeholder from a named source", async () => {
    const ctx = { swapi: { name: "Luke Skywalker" } };
    expect(await resolveStringTemplates("Hello {{ swapi.name }}", ctx)).toBe(
      "Hello Luke Skywalker"
    );
  });

  it("handles multiple placeholders", async () => {
    const ctx = { swapi: { name: "Leia", height: "150" } };
    expect(
      await resolveStringTemplates("{{ swapi.name }} — {{ swapi.height }} cm", ctx)
    ).toBe("Leia — 150 cm");
  });

  it("supports dotted paths within the source row", async () => {
    const ctx = { swapi: { nested: { x: "ok" } } };
    expect(await resolveStringTemplates("{{ swapi.nested.x }}", ctx)).toBe("ok");
  });

  it("supports hyphenated datasource ids (PCC-3668)", async () => {
    const ctx = { "blog-post": { title: "My First Post" } };
    expect(await resolveStringTemplates("{{ blog-post.title }}", ctx)).toBe(
      "My First Post"
    );
  });

  it("supports urlParams tokens", async () => {
    const ctx = { urlParams: { id: "42", slug: "obi-wan" } };
    expect(await resolveStringTemplates("{{ urlParams.id }}:{{ urlParams.slug }}", ctx)).toBe(
      "42:obi-wan"
    );
  });

  it("uses empty string for missing source, path, or value", async () => {
    expect(await resolveStringTemplates("{{ swapi.name }}", {})).toBe("");
    expect(await resolveStringTemplates("{{ other.name }}", { swapi: {} })).toBe("");
    expect(await resolveStringTemplates("{{ swapi.missing }}", { swapi: { a: 1 } })).toBe(
      ""
    );
  });

  it("stringifies primitive field values", async () => {
    expect(await resolveStringTemplates("n={{ swapi.n }}", { swapi: { n: 42 } })).toBe(
      "n=42"
    );
    expect(await resolveStringTemplates("b={{ swapi.b }}", { swapi: { b: true } })).toBe(
      "b=true"
    );
  });

  it("uses empty string for object/array field values", async () => {
    const ctx = { swapi: { films: ["https://example.com"] } };
    expect(await resolveStringTemplates("{{ swapi.films }}", ctx)).toBe("");
  });

  it("supports allowlisted function expressions", async () => {
    const ctx = { swapi: { name: "Luke Skywalker" } };
    expect(await resolveStringTemplates("{{ toUpperCase(swapi.name) }}", ctx)).toBe(
      "LUKE SKYWALKER"
    );
    expect(await resolveStringTemplates('{{ replace(swapi.name, " ", "-") }}', ctx)).toBe(
      "Luke-Skywalker"
    );
  });

  it("supports numeric and fallback helper functions", async () => {
    const ctx = { swapi: { name: "Leia Organa", missing: "" } };
    expect(await resolveStringTemplates("{{ slice(swapi.name, 0, 4) }}", ctx)).toBe("Leia");
    expect(
      await resolveStringTemplates('{{ default(swapi.missing, "Unknown") }}', ctx)
    ).toBe("Unknown");
    expect(
      await resolveStringTemplates('{{ truncate(swapi.name, 7, "...") }}', ctx)
    ).toBe("Leia...");
  });

  it("returns empty string for unknown or malformed expressions", async () => {
    const ctx = { swapi: { name: "Luke" } };
    expect(await resolveStringTemplates("{{ doesNotExist(swapi.name) }}", ctx)).toBe("");
    expect(await resolveStringTemplates("{{ toUpperCase(swapi.name) ", ctx)).toBe(
      "{{ toUpperCase(swapi.name) "
    );
    expect(await resolveStringTemplates("{{ swapi.name + 1 }}", ctx)).toBe("");
  });

  it("preserves item templates for block-level per-item rendering", async () => {
    expect(await resolveStringTemplates("title is {{ item.name }}", {})).toBe(
      "title is {{ item.name }}"
    );
    expect(await resolveStringTemplates("{{ item.id }}", {})).toBe("{{ item.id }}");
  });

  it("expands markdownLinks to markdown list lines for any source", async () => {
    const ctx = {
      my_list: {
        items: [
          { id: "1", name: "Luke" },
          { id: "2", name: "Leia" },
        ],
      },
    };
    expect(
      await resolveStringTemplates(
        'People:\n{{ my_list.markdownLinks "/people/{id}" }}',
        ctx
      )
    ).toBe("People:\n[Luke](/people/1)\n[Leia](/people/2)");
  });

  it("expands bare markdownLinks with default /{id} href template", async () => {
    const ctx = {
      my_list: {
        items: [
          { id: "1", name: "Luke" },
          { id: "2", name: "Leia" },
        ],
      },
    };
    expect(await resolveStringTemplates("{{ my_list.markdownLinks }}", ctx)).toBe(
      "[Luke](/1)\n[Leia](/2)"
    );
  });

  it("expands markdownLinks for a hyphenated datasource id (PCC-3668)", async () => {
    const ctx = {
      "blog-post": {
        items: [
          { id: "1", name: "Luke" },
          { id: "2", name: "Leia" },
        ],
      },
    };
    expect(
      await resolveStringTemplates(
        'People:\n{{ blog-post.markdownLinks "/people/{id}" }}',
        ctx
      )
    ).toBe("People:\n[Luke](/people/1)\n[Leia](/people/2)");
  });

  it("leaves markdownLinks empty when source is missing", async () => {
    expect(
      await resolveStringTemplates('{{ missing_list.markdownLinks "/path/{id}" }}', {})
    ).toBe("");
  });

  it("keeps object/array values for exact-template resolution in data walk", async () => {
    const data: Partial<Data> = {
      content: [
        {
          type: "GridBlock",
          props: {
            id: "grid-1",
            jedi: "{{ swapi_list.items }}",
          },
        },
      ],
    };
    const out = await resolveDataTemplates(data, {
      swapi_list: {
        items: [
          { id: "1", name: "Luke" },
          { id: "2", name: "Leia" },
        ],
      },
    });
    expect(out.content?.[0].props.jedi).toEqual([
      { id: "1", name: "Luke" },
      { id: "2", name: "Leia" },
    ]);
  });
});

describe("templates.* compound datasource IDs", () => {
  it("resolves {{ templates.news.items }} as a dotted-path lookup on context['templates.news']", async () => {
    const ctx = {
      "templates.news": {
        items: [{ id: "1", title: "Breaking" }],
        returnedCount: 1,
      },
    };
    expect(
      await resolveStringTemplates("{{ templates.news.returnedCount }}", ctx)
    ).toBe("1");
  });

  it("resolves nested paths within a compound-ID source", async () => {
    const ctx = {
      "templates.news": {
        query: { name: "news", sortedBy: "createdAt" },
      },
    };
    expect(
      await resolveStringTemplates("{{ templates.news.query.name }}", ctx)
    ).toBe("news");
  });

  it("resolves compound-ID array access via jsep expression", async () => {
    const ctx = {
      "templates.news": {
        items: [
          { title: "First" },
          { title: "Second" },
        ],
      },
    };
    expect(
      await resolveStringTemplates("{{ templates.news.items[0].title }}", ctx)
    ).toBe("First");
  });

  it("returns empty string when compound-ID source is missing", async () => {
    expect(
      await resolveStringTemplates("{{ templates.missing.field }}", {})
    ).toBe("");
  });

  it("resolves {{ templates.blog-post.title }} for a hyphenated compound ID (PCC-3668)", async () => {
    const ctx = {
      "templates.blog-post": {
        title: "Hyphenated Template Title",
      },
    };
    expect(
      await resolveStringTemplates("{{ templates.blog-post.title }}", ctx)
    ).toBe("Hyphenated Template Title");
  });

  it("resolves bare {{ templates.news }} without a sub-path", async () => {
    const data: Partial<Data> = {
      content: [
        {
          type: "InfoBlock",
          props: {
            id: "info-1",
            source: "{{ templates.news }}",
          },
        },
      ],
    };
    const ctx = {
      "templates.news": {
        items: [{ title: "Breaking" }],
        returnedCount: 1,
      },
    };
    const out = await resolveDataTemplates(data, ctx);
    expect(out.content?.[0].props.source).toEqual({
      items: [{ title: "Breaking" }],
      returnedCount: 1,
    });
  });

  it("keeps compound-ID data intact for whole-value resolution in data walk", async () => {
    const data: Partial<Data> = {
      content: [
        {
          type: "ListBlock",
          props: {
            id: "list-1",
            items: "{{ templates.news.items }}",
          },
        },
      ],
    };
    const ctx = {
      "templates.news": {
        items: [
          { id: "1", title: "Breaking" },
          { id: "2", title: "Update" },
        ],
      },
    };
    const out = await resolveDataTemplates(data, ctx);
    expect(out.content?.[0].props.items).toEqual([
      { id: "1", title: "Breaking" },
      { id: "2", title: "Update" },
    ]);
  });
});

describe("extractReferencedDatasourceIds — compound IDs", () => {
  it("extracts templates.X as a single compound ID", () => {
    const data = {
      content: [
        {
          type: "Block",
          props: { id: "b1", title: "{{ templates.news.items[0].title }}" },
        },
      ],
    };
    const ids = extractReferencedDatasourceIds(data);
    expect(ids.has("templates.news")).toBe(true);
    expect(ids.has("templates")).toBe(false);
  });

  it("extracts multiple compound IDs", () => {
    const data = {
      content: [
        {
          type: "Block",
          props: {
            id: "b1",
            a: "{{ templates.news.items }}",
            b: "{{ templates.blog.query.name }}",
          },
        },
      ],
    };
    const ids = extractReferencedDatasourceIds(data);
    expect(ids.has("templates.news")).toBe(true);
    expect(ids.has("templates.blog")).toBe(true);
  });

  it("extracts hyphenated datasource IDs (PCC-3668)", () => {
    const data = {
      content: [
        {
          type: "Block",
          props: { id: "b1", title: "{{ blog-post.title }}" },
        },
      ],
    };
    const ids = extractReferencedDatasourceIds(data);
    expect(ids.has("blog-post")).toBe(true);
  });

  it("extracts hyphenated compound IDs under templates. (PCC-3668)", () => {
    const data = {
      content: [
        {
          type: "Block",
          props: { id: "b1", title: "{{ templates.blog-post.title }}" },
        },
      ],
    };
    const ids = extractReferencedDatasourceIds(data);
    expect(ids.has("templates.blog-post")).toBe(true);
  });

  it("still extracts simple IDs alongside compound IDs", () => {
    const data = {
      content: [
        {
          type: "Block",
          props: {
            id: "b1",
            a: "{{ swapi.name }}",
            b: "{{ templates.news.items }}",
          },
        },
      ],
    };
    const ids = extractReferencedDatasourceIds(data);
    expect(ids.has("swapi")).toBe(true);
    expect(ids.has("templates.news")).toBe(true);
  });
});

describe("resolveDataTemplates", () => {
  beforeEach(() => {
    vi.mocked(getPage).mockReset();
    vi.mocked(getPage).mockResolvedValue(null);
  });

  it("resolves cross-page block references when value is an exact template", async () => {
    const home: Data = {
      root: { props: { title: "Home" } },
      content: [
        {
          type: "QuoteBlock",
          props: {
            id: "QuoteBlock-abc",
            quote: "A short quotation goes here.",
            attribution: "",
          },
        },
      ],
      zones: {},
    } as unknown as Data;
    vi.mocked(getPage).mockImplementation(async (path: string) =>
      path === "/" ? home : null
    );

    const token = encodePagesBlocksTemplate("/", "QuoteBlock-abc", "quote");
    const data: Partial<Data> = {
      content: [
        {
          type: "QuoteBlock",
          props: { id: "q1", quote: token, attribution: "" },
        },
      ],
    };
    const out = await resolveDataTemplates(data, {});
    expect(out.content?.[0].props.quote).toBe("A short quotation goes here.");
  });

  it("returns plain objects (not null-prototype) so Next.js can serialize to Client Components", async () => {
    const data: Partial<Data> = {
      root: { props: { title: "{{ swapi.name }}" } },
      content: [
        {
          type: "HeadingBlock",
          props: { id: "h1", title: "{{ swapi.name }}" },
        },
      ],
      zones: {
        sidebar: [
          {
            type: "ParagraphBlock",
            props: { id: "p1", text: "{{ swapi.height }}" },
          },
        ],
      },
    };
    const ctx = { swapi: { name: "Luke", height: "172" } };
    const out = await resolveDataTemplates(data, ctx);

    // Root props must have Object.prototype (not null prototype)
    expect(out.root).toBeDefined();
    expect(Object.getPrototypeOf((out.root as NonNullable<typeof out.root>).props)).toBe(Object.prototype);

    // Content item props
    expect(out.content).toBeDefined();
    expect(Object.getPrototypeOf((out.content as NonNullable<typeof out.content>)[0].props)).toBe(Object.prototype);

    // Zone item props
    expect(out.zones).toBeDefined();
    expect(Object.getPrototypeOf((out.zones as NonNullable<typeof out.zones>).sidebar[0].props)).toBe(
      Object.prototype
    );
  });

  it("resolves strings in root.props and content items", async () => {
    const data: Partial<Data> = {
      root: {
        props: {
          title: "Page: {{ swapi.name }}",
        },
      },
      content: [
        {
          type: "HeadingBlock",
          props: {
            id: "h1",
            title: "{{ swapi.name }}",
          },
        },
      ],
    };
    const ctx = { swapi: { name: "Luke Skywalker" } };
    const out = await resolveDataTemplates(data, ctx);
    expect(out.root).toEqual({
      props: { title: "Page: Luke Skywalker" },
    });
    expect(out.content?.[0].props.title).toBe("Luke Skywalker");
  });

  it("does not mutate the original data", async () => {
    const data: Partial<Data> = {
      root: { props: { title: "{{ swapi.name }}" } },
    };
    const ctx = { swapi: { name: "X" } };
    await resolveDataTemplates(data, ctx);
    expect(data.root?.props?.title).toBe("{{ swapi.name }}");
  });

  it("walks nested component props in arrays", async () => {
    const data: Partial<Data> = {
      content: [
        {
          type: "Parent",
          props: {
            id: "p",
            children: [
              {
                type: "HeadingBlock",
                props: { id: "c", title: "{{ swapi.name }}" },
              },
            ],
          },
        },
      ],
    };
    const out = await resolveDataTemplates(data, { swapi: { name: "Y" } });
    const children = (out.content?.[0].props as { children: unknown[] })
      .children;
    expect((children[0] as { props: { title: string } }).props.title).toBe("Y");
  });

  it("resolves a hyphenated datasource id through the full data walk (PCC-3668)", async () => {
    const data: Partial<Data> = {
      content: [
        {
          type: "HeadingBlock",
          props: { id: "h1", title: "{{ blog-post.title }}" },
        },
      ],
    };
    const ctx = { "blog-post": { title: "My First Post" } };
    const out = await resolveDataTemplates(data, ctx);
    expect(out.content?.[0].props.title).toBe("My First Post");
  });

  it("resolves zones", async () => {
    const data: Partial<Data> = {
      root: { props: {} },
      content: [],
      zones: {
        sidebar: [
          {
            type: "HeadingBlock",
            props: { id: "z", title: "{{ swapi.name }}" },
          },
        ],
      },
    };
    const out = await resolveDataTemplates(data, { swapi: { name: "Z" } });
    expect(out.zones?.sidebar[0].props.title).toBe("Z");
  });
});
