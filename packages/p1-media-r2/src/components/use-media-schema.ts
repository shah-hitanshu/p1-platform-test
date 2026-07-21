"use client";

import { useState, useEffect } from "react";
import { useMediaConfig } from "../context";
import type { MetadataFieldDef } from "../types";

export const DEFAULT_METADATA_FIELDS: MetadataFieldDef[] = [
  { name: "alt", label: "Alt text", type: "string" },
];

/** Ensures `alt` renders first (design: "alt first"), keeping the rest in order. */
export function orderAltFirst(schema: MetadataFieldDef[]): MetadataFieldDef[] {
  const alt = schema.find((f) => f.name === "alt");
  if (!alt) return schema;
  return [alt, ...schema.filter((f) => f.name !== "alt")];
}

/**
 * Fetches the metadata schema from `GET /media/schema`, falling back to the
 * plugin's `metadataFields` option (or `[alt]`) when the endpoint is
 * absent/unreachable — so the plugin works before the Worker is upgraded.
 */
export function useMediaSchema(): MetadataFieldDef[] {
  const config = useMediaConfig();
  const fallback =
    config.metadataFields && config.metadataFields.length > 0
      ? config.metadataFields
      : DEFAULT_METADATA_FIELDS;
  const [schema, setSchema] = useState<MetadataFieldDef[]>(fallback);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const token = await config.getAuthToken();
        const headers: HeadersInit = token ? { Authorization: "Bearer " + token } : {};
        const res = await fetch(config.workerUrl + "/media/schema", { headers });
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled && Array.isArray(data) && data.length > 0) {
          setSchema(data as MetadataFieldDef[]);
        }
      } catch {
        // keep the fallback
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [config]);

  return schema;
}
