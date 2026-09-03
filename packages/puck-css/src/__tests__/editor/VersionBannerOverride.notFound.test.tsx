/**
 * The page-not-found panel takes over the canvas, not the whole editor: the
 * chrome (children still mount) stays around it, and it replaces the generic
 * "Choose a page" empty state rather than stacking with it.
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

const notFound = {
  canCreate: true,
  onCreate: vi.fn().mockResolvedValue(undefined),
};

describe("VersionBannerOverride page-not-found panel", () => {
  beforeEach(() => {
    mockCurrentDocument = null;
    mockDocumentLoading = false;
  });

  it("replaces the generic empty state and keeps the canvas mounted", () => {
    render(
      <VersionBannerOverride versions={[]} pageNotFound={{ ...notFound, onOpenHome: vi.fn() }}>
        <div>canvas</div>
      </VersionBannerOverride>,
    );

    expect(screen.getByText("This page doesn't exist")).toBeInTheDocument();
    expect(screen.queryByText("Choose a page from the menu above")).not.toBeInTheDocument();
    // Children stay mounted so Puck's canvas — and the chrome around it — still render.
    expect(screen.getByText("canvas")).toBeInTheDocument();
  });

  it("stays out of the way while a document load is in flight", () => {
    mockDocumentLoading = true;
    render(
      <VersionBannerOverride versions={[]} pageNotFound={{ ...notFound, onOpenHome: vi.fn() }}>
        <div>canvas</div>
      </VersionBannerOverride>,
    );

    expect(screen.queryByText("This page doesn't exist")).not.toBeInTheDocument();
  });
});
