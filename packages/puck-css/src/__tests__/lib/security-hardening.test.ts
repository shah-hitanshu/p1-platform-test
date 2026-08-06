import { describe, expect, it, vi } from "vitest";

vi.mock("../../data/get-page", () => ({
  getPage: vi.fn(async () => null),
}));

import type { Data } from "@puckeditor/core";
import {
  resolveStringTemplates,
} from "../../data/resolve-data-templates";
import { getRawPropValue } from "../../data/cross-reference";
import { fetchHttpJsonRemoteDatasource } from "../../data/remote-datasources/fetch-http-json";
import type { HttpJsonRemoteDatasourceDefinition } from "../../data/remote-datasources/user-remote-datasource-types";
import { TEMPLATE_FUNCTIONS } from "../../data/template-functions";

describe("prototype pollution guards — getByPath (resolve-data-templates)", () => {
  it("blocks __proto__ traversal", async () => {
    const ctx = { source: { __proto__: { polluted: "yes" } } };
    const result = await resolveStringTemplates("{{ source.__proto__.polluted }}", ctx);
    expect(result).toBe("");
  });

  it("blocks constructor traversal", async () => {
    const ctx = { source: { nested: { value: "ok" } } };
    const result = await resolveStringTemplates("{{ source.constructor.name }}", ctx);
    expect(result).toBe("");
  });

  it("blocks prototype traversal", async () => {
    const ctx = { source: { nested: { value: "ok" } } };
    const result = await resolveStringTemplates("{{ source.prototype }}", ctx);
    expect(result).toBe("");
  });

  it("allows normal dotted paths", async () => {
    const ctx = { source: { nested: { value: "safe" } } };
    const result = await resolveStringTemplates("{{ source.nested.value }}", ctx);
    expect(result).toBe("safe");
  });
});

describe("prototype pollution guards — getPropFromObject (cross-reference)", () => {
  it("blocks __proto__ in prop path", () => {
    const data: Data = {
      root: { props: { title: "Test" } },
      content: [
        { type: "Block", props: { id: "b1", value: "hello" } },
      ],
      zones: {},
    } as unknown as Data;
    expect(getRawPropValue(data, "b1", "__proto__")).toBeUndefined();
  });

  it("blocks constructor in prop path", () => {
    const data: Data = {
      root: { props: { title: "Test" } },
      content: [
        { type: "Block", props: { id: "b1", value: "hello" } },
      ],
      zones: {},
    } as unknown as Data;
    expect(getRawPropValue(data, "b1", "constructor")).toBeUndefined();
  });

  it("blocks prototype in nested prop path", () => {
    const data: Data = {
      root: { props: { title: "Test" } },
      content: [
        { type: "Block", props: { id: "b1", meta: { alt: "img" } } },
      ],
      zones: {},
    } as unknown as Data;
    expect(getRawPropValue(data, "b1", "meta.prototype")).toBeUndefined();
  });
});

describe("prototype pollution guards — getByPath (fetch-http-json)", () => {
  it("blocks __proto__ in URL template context traversal", async () => {
    const def: HttpJsonRemoteDatasourceDefinition = {
      id: "test",
      label: "Test",
      description: "",
      urlTemplate: "https://example.com/{{ source.__proto__.polluted }}",
      fields: [],
    };
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({}),
    });
    await fetchHttpJsonRemoteDatasource(
      def,
      { source: { safe: "value" } },
      mockFetch as unknown as typeof fetch,
    );
    const url = String(mockFetch.mock.calls[0]?.[0] ?? "");
    expect(url).not.toContain("polluted");
  });
});

describe("prototype pollution guards — evalTemplateExpression", () => {
  it("blocks __proto__ in MemberExpression", async () => {
    const ctx = { source: { real: "data" } };
    const result = await resolveStringTemplates("{{ source.__proto__ }}", ctx);
    expect(result).toBe("");
  });

  it("blocks constructor in computed MemberExpression via function call", async () => {
    const ctx = { source: { real: "data" } };
    const result = await resolveStringTemplates("{{ source.constructor }}", ctx);
    expect(result).toBe("");
  });
});

describe("padStart/padEnd length cap", () => {
  const MAX_PAD = 10_000;

  it("caps padStart to MAX_PAD_LENGTH", () => {
    const result = TEMPLATE_FUNCTIONS.padStart(["x", 999_999_999, " "]);
    expect(typeof result).toBe("string");
    expect((result as string).length).toBeLessThanOrEqual(MAX_PAD);
  });

  it("caps padEnd to MAX_PAD_LENGTH", () => {
    const result = TEMPLATE_FUNCTIONS.padEnd(["x", 999_999_999, " "]);
    expect(typeof result).toBe("string");
    expect((result as string).length).toBeLessThanOrEqual(MAX_PAD);
  });

  it("still works for normal pad lengths", () => {
    expect(TEMPLATE_FUNCTIONS.padStart(["5", 3, "0"])).toBe("005");
    expect(TEMPLATE_FUNCTIONS.padEnd(["5", 3, "0"])).toBe("500");
  });
});

describe("URL scheme validation — fetch-http-json", () => {
  it("rejects file:// URLs", async () => {
    const def: HttpJsonRemoteDatasourceDefinition = {
      id: "test",
      label: "Test",
      description: "",
      urlTemplate: "file:///etc/passwd",
      fields: [],
    };
    const mockFetch = vi.fn();
    const result = await fetchHttpJsonRemoteDatasource(
      def,
      {},
      mockFetch as unknown as typeof fetch,
    );
    expect(result).toEqual({});
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("rejects ftp:// URLs", async () => {
    const def: HttpJsonRemoteDatasourceDefinition = {
      id: "test",
      label: "Test",
      description: "",
      urlTemplate: "ftp://example.com/data",
      fields: [],
    };
    const mockFetch = vi.fn();
    const result = await fetchHttpJsonRemoteDatasource(
      def,
      {},
      mockFetch as unknown as typeof fetch,
    );
    expect(result).toEqual({});
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("allows https:// URLs", async () => {
    const def: HttpJsonRemoteDatasourceDefinition = {
      id: "test",
      label: "Test",
      description: "",
      urlTemplate: "https://example.com/api",
      fields: [],
    };
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true }),
    });
    const result = await fetchHttpJsonRemoteDatasource(
      def,
      {},
      mockFetch as unknown as typeof fetch,
    );
    expect(result).toEqual({ ok: true });
    expect(mockFetch).toHaveBeenCalledOnce();
  });

  it("allows http:// URLs", async () => {
    const def: HttpJsonRemoteDatasourceDefinition = {
      id: "test",
      label: "Test",
      description: "",
      urlTemplate: "http://localhost:3000/api",
      fields: [],
    };
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true }),
    });
    const result = await fetchHttpJsonRemoteDatasource(
      def,
      {},
      mockFetch as unknown as typeof fetch,
    );
    expect(result).toEqual({ ok: true });
    expect(mockFetch).toHaveBeenCalledOnce();
  });
});
