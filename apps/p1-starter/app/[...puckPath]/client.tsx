"use client";

import type { Data } from "@puckeditor/core";
import { RenderClient } from "@pantheon-systems/puck-css";
import config from "../../puck.config";

export function Client({
  data,
  pageMetadata,
}: {
  data: Data;
  pageMetadata?: {
    route: string;
    documentName?: string;
    pageType?: "page" | "template" | "override";
  };
}) {
  return (
    <>
      <RenderClient config={config} data={data} />
      {pageMetadata && (
        <footer className="mt-16 border-t border-gray-200 py-4 text-center text-sm text-gray-500">
          Rendered with{" "}
          <span className="font-medium">
            {pageMetadata.documentName || pageMetadata.route}
          </span>{" "}
          from{" "}
          <span className="font-medium">
            {pageMetadata.pageType === "page" && "page"}
            {pageMetadata.pageType === "template" && "page template"}
            {pageMetadata.pageType === "override" && "page template override"}
            {!pageMetadata.pageType && "page"}
          </span>{" "}
          at route{" "}
          <span className="font-mono text-xs">{pageMetadata.route}</span>
        </footer>
      )}
    </>
  );
}
