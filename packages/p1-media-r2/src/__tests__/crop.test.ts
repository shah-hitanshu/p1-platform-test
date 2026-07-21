import { describe, it, expect } from "vitest";
import {
  getBaseUrl,
  getCropMode,
  getTrimRect,
  buildValueWithCrop,
  buildValueWithTrim,
} from "../crop";

const BASE = "https://cdn.example.com/site/media/1-photo.jpg";

describe("crop helpers", () => {
  it("getBaseUrl strips the query string", () => {
    expect(getBaseUrl(`${BASE}?fit=cover&gravity=auto`)).toBe(BASE);
    expect(getBaseUrl(BASE)).toBe(BASE);
    expect(getBaseUrl("")).toBe("");
  });

  it("getCropMode reads fit=cover as smart, everything else as fit", () => {
    expect(getCropMode(`${BASE}?fit=cover&gravity=auto`)).toBe("smart");
    expect(getCropMode(`${BASE}?fit=scale-down`)).toBe("fit");
    expect(getCropMode(BASE)).toBe("fit");
    expect(getCropMode("")).toBe("fit");
  });

  it("buildValueWithCrop emits the expected params per mode", () => {
    expect(buildValueWithCrop(BASE, "smart")).toBe(`${BASE}?fit=cover&gravity=auto`);
    expect(buildValueWithCrop(BASE, "fit")).toBe(`${BASE}?fit=scale-down`);
  });

  it("round-trips a smart-cropped value back to smart", () => {
    const v = buildValueWithCrop(getBaseUrl(`${BASE}?x=1`), "smart");
    expect(getCropMode(v)).toBe("smart");
    expect(getBaseUrl(v)).toBe(BASE);
  });

  // "custom" is not a preset: it appears when carrying the current mode onto a
  // newly selected asset, where the old trim rect would be meaningless.
  it("buildValueWithCrop degrades custom to fit-in", () => {
    expect(buildValueWithCrop(BASE, "custom")).toBe(`${BASE}?fit=scale-down`);
  });
});

describe("manual crop (trim) helpers", () => {
  const RECT = { left: 100, top: 50, width: 800, height: 450 };

  it("buildValueWithTrim emits trim.* params and round-trips via getTrimRect/getCropMode", () => {
    const v = buildValueWithTrim(BASE, RECT);
    expect(v).toBe(`${BASE}?trim.left=100&trim.top=50&trim.width=800&trim.height=450`);
    expect(getCropMode(v)).toBe("custom");
    expect(getTrimRect(v)).toEqual(RECT);
    expect(getBaseUrl(v)).toBe(BASE);
  });

  it("rounds fractional pixels and clamps to a non-negative ≥1px region", () => {
    const v = buildValueWithTrim(BASE, { left: -3.2, top: 9.6, width: 0.2, height: 449.5 });
    expect(getTrimRect(v)).toEqual({ left: 0, top: 10, width: 1, height: 450 });
  });

  it("getTrimRect is null for preset-crop and bare values", () => {
    expect(getTrimRect(`${BASE}?fit=cover&gravity=auto`)).toBeNull();
    expect(getTrimRect(BASE)).toBeNull();
    expect(getTrimRect("")).toBeNull();
  });

  it("getTrimRect is null when trim params are malformed", () => {
    expect(getTrimRect(`${BASE}?trim.left=abc&trim.top=1&trim.width=2&trim.height=3`)).toBeNull();
    expect(getTrimRect(`${BASE}?trim.left=1`)).toBeNull();
  });

  it("switching back to a preset clears the trim (via getBaseUrl)", () => {
    const custom = buildValueWithTrim(BASE, RECT);
    const back = buildValueWithCrop(getBaseUrl(custom), "smart");
    expect(getCropMode(back)).toBe("smart");
    expect(getTrimRect(back)).toBeNull();
  });
});
