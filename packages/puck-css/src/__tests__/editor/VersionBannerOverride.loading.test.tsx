/**
 * With the editor persisting across document switches, loadDocument clears
 * currentDocument mid-switch. The canvas empty state ("Choose a page...")
 * must not flash through while a document load is in flight — it should only
 * appear when there is genuinely no document and nothing is loading.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import React from "react";

let mockCurrentDocument: unknown = null;
let mockDocumentLoading = false;

vi.mock("../../core/P1PuckContext", () => ({
  useP1Puck: () => ({
    currentDocument: mockCurrentDocument,
    documentLoading: mockDocumentLoading,
  }),
}));

import { VersionBannerOverride } from "../../editor/components/VersionBannerOverride";

describe("VersionBannerOverride empty state vs document loading", () => {
  beforeEach(() => {
    mockCurrentDocument = null;
    mockDocumentLoading = false;
  });

  it("shows the empty state when no document exists and nothing is loading", () => {
    render(
      <VersionBannerOverride versions={[]}>
        <div>canvas</div>
      </VersionBannerOverride>,
    );
    expect(
      screen.getByText("Choose a page from the menu above"),
    ).toBeInTheDocument();
  });

  it("hides the empty state while a document load is in flight", () => {
    mockDocumentLoading = true;
    render(
      <VersionBannerOverride versions={[]}>
        <div>canvas</div>
      </VersionBannerOverride>,
    );
    expect(
      screen.queryByText("Choose a page from the menu above"),
    ).not.toBeInTheDocument();
  });

  it("keeps rendering children while loading so the old canvas stays visible", () => {
    mockDocumentLoading = true;
    render(
      <VersionBannerOverride versions={[]}>
        <div>canvas</div>
      </VersionBannerOverride>,
    );
    expect(screen.getByText("canvas")).toBeInTheDocument();
  });
});
