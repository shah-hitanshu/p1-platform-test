import type { Data } from "@puckeditor/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  resolveDataTemplates,
  resolveStringTemplates,
} from "../../src/lib/resolve-data-templates";
import { encodePagesBlocksTemplate } from "../../src/lib/cross-reference";

vi.mock("../../src/lib/get-page", () => ({
  getPage: vi.fn(),
}));

import { getPage } from "../../src/lib/get-page";

describe("resolveStringTemplates", () => {
  it("replaces a single placeholder from a named source", () => {
    const ctx = { swapi: { name: "Luke Skywalker" } };
    expect(resolveStringTemplates("Hello {{ swapi.name }}", ctx)).toBe(
      "Hello Luke Skywalker"
    );
  });

  it("handles multiple placeholders", () => {
    const ctx = { swapi: { name: "Leia", height: "150" } };
    expect(
      resolveStringTemplates("{{ swapi.name }} — {{ swapi.height }} cm", ctx)
    ).toBe("Leia — 150 cm");
  });

  it("supports dotted paths within the source row", () => {
    const ctx = { swapi: { nested: { x: "ok" } } };
    expect(resolveStringTemplates("{{ swapi.nested.x }}", ctx)).toBe("ok");
  });

  it("supports urlParams tokens", () => {
    const ctx = { urlParams: { id: "42", slug: "obi-wan" } };
    expect(resolveStringTemplates("{{ urlParams.id }}:{{ urlParams.slug }}", ctx)).toBe(
      "42:obi-wan"
    );
  });

  it("uses empty string for missing source, path, or value", () => {
    expect(resolveStringTemplates("{{ swapi.name }}", {})).toBe("");
    expect(resolveStringTemplates("{{ other.name }}", { swapi: {} })).toBe("");
    expect(resolveStringTemplates("{{ swapi.missing }}", { swapi: { a: 1 } })).toBe(
      ""
    );
  });

  it("stringifies primitive field values", () => {
    expect(resolveStringTemplates("n={{ swapi.n }}", { swapi: { n: 42 } })).toBe(
      "n=42"
    );
    expect(resolveStringTemplates("b={{ swapi.b }}", { swapi: { b: true } })).toBe(
      "b=true"
    );
  });

  it("uses empty string for object/array field values", () => {
    const ctx = { swapi: { films: ["https://example.com"] } };
    expect(resolveStringTemplates("{{ swapi.films }}", ctx)).toBe("");
  });

  it("supports allowlisted function expressions", () => {
    const ctx = { swapi: { name: "Luke Skywalker" } };
    expect(resolveStringTemplates("{{ toUpperCase(swapi.name) }}", ctx)).toBe(
      "LUKE SKYWALKER"
    );
    expect(resolveStringTemplates('{{ replace(swapi.name, " ", "-") }}', ctx)).toBe(
      "Luke-Skywalker"
    );
  });

  it("supports numeric and fallback helper functions", () => {
    const ctx = { swapi: { name: "Leia Organa", missing: "" } };
    expect(resolveStringTemplates("{{ slice(swapi.name, 0, 4) }}", ctx)).toBe("Leia");
    expect(
      resolveStringTemplates('{{ default(swapi.missing, "Unknown") }}', ctx)
    ).toBe("Unknown");
    expect(
      resolveStringTemplates('{{ truncate(swapi.name, 7, "...") }}', ctx)
    ).toBe("Leia...");
  });

  it("returns empty string for unknown or malformed expressions", () => {
    const ctx = { swapi: { name: "Luke" } };
    expect(resolveStringTemplates("{{ doesNotExist(swapi.name) }}", ctx)).toBe("");
    expect(resolveStringTemplates("{{ toUpperCase(swapi.name) ", ctx)).toBe(
      "{{ toUpperCase(swapi.name) "
    );
    expect(resolveStringTemplates("{{ swapi.name + 1 }}", ctx)).toBe("");
  });

  it("preserves item templates for block-level per-item rendering", () => {
    expect(resolveStringTemplates("title is {{ item.name }}", {})).toBe(
      "title is {{ item.name }}"
    );
    expect(resolveStringTemplates("{{ item.id }}", {})).toBe("{{ item.id }}");
  });

  it("expands markdownLinks to markdown list lines for any source", () => {
    const ctx = {
      my_list: {
        items: [
          { id: "1", name: "Luke" },
          { id: "2", name: "Leia" },
        ],
      },
    };
    expect(
      resolveStringTemplates(
        'People:\n{{ my_list.markdownLinks "/people/{id}" }}',
        ctx
      )
    ).toBe("People:\n[Luke](/people/1)\n[Leia](/people/2)");
  });

  it("expands bare markdownLinks with default /{id} href template", () => {
    const ctx = {
      my_list: {
        items: [
          { id: "1", name: "Luke" },
          { id: "2", name: "Leia" },
        ],
      },
    };
    expect(resolveStringTemplates("{{ my_list.markdownLinks }}", ctx)).toBe(
      "[Luke](/1)\n[Leia](/2)"
    );
  });

  it("leaves markdownLinks empty when source is missing", () => {
    expect(
      resolveStringTemplates('{{ missing_list.markdownLinks "/path/{id}" }}', {})
    ).toBe("");
  });

  it("keeps object/array values for exact-template resolution in data walk", () => {
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
    const out = resolveDataTemplates(data, {
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

describe("resolveDataTemplates", () => {
  beforeEach(() => {
    vi.mocked(getPage).mockReset();
  });

  it("resolves cross-page block references when value is an exact template", () => {
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
    vi.mocked(getPage).mockImplementation((path: string) =>
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
    const out = resolveDataTemplates(data, {});
    expect(out.content?.[0].props.quote).toBe("A short quotation goes here.");
  });

  it("returns plain objects (not null-prototype) so Next.js can serialize to Client Components", () => {
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
    const out = resolveDataTemplates(data, ctx);

    // Root props must have Object.prototype (not null prototype)
    expect(Object.getPrototypeOf(out.root!.props)).toBe(Object.prototype);

    // Content item props
    expect(Object.getPrototypeOf(out.content![0].props)).toBe(Object.prototype);

    // Zone item props
    expect(Object.getPrototypeOf(out.zones!.sidebar[0].props)).toBe(
      Object.prototype
    );
  });

  it("resolves strings in root.props and content items", () => {
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
    const out = resolveDataTemplates(data, ctx);
    expect(out.root).toEqual({
      props: { title: "Page: Luke Skywalker" },
    });
    expect(out.content?.[0].props.title).toBe("Luke Skywalker");
  });

  it("does not mutate the original data", () => {
    const data: Partial<Data> = {
      root: { props: { title: "{{ swapi.name }}" } },
    };
    const ctx = { swapi: { name: "X" } };
    resolveDataTemplates(data, ctx);
    expect(data.root?.props?.title).toBe("{{ swapi.name }}");
  });

  it("walks nested component props in arrays", () => {
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
    const out = resolveDataTemplates(data, { swapi: { name: "Y" } });
    const children = (out.content?.[0].props as { children: unknown[] })
      .children;
    expect((children[0] as { props: { title: string } }).props.title).toBe("Y");
  });

  it("resolves zones", () => {
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
    const out = resolveDataTemplates(data, { swapi: { name: "Z" } });
    expect(out.zones?.sidebar[0].props.title).toBe("Z");
  });
});
