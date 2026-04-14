"use client";

import type { Config, Data, Plugin } from "@puckeditor/core";
import { createUsePuck } from "@puckeditor/core";

const usePuckStore = createUsePuck();
import {
  createContext,
  useContext,
  useMemo,
  type ComponentType,
  type ReactNode,
} from "react";

import { getBlockPropsById } from "../lib/cross-reference";
import type { RemoteDatasourceContext } from "../lib/remote-datasources/loader";
import { useResolvePreview } from "./hooks";

const PreviewResolvedContext = createContext<Data | null>(null);

function useResolvedPreviewData(): Data | null {
  return useContext(PreviewResolvedContext);
}

function PreviewResolveBoundary({
  children,
  remoteDatasourceContext,
}: {
  children: ReactNode;
  remoteDatasourceContext: RemoteDatasourceContext;
}) {
  const data = usePuckStore((s) => s.appState.data);
  const { data: resolved } = useResolvePreview(data, remoteDatasourceContext);

  return (
    <PreviewResolvedContext.Provider value={resolved ?? null}>{children}</PreviewResolvedContext.Provider>
  );
}

function mergeRootForPreview(props: Record<string, unknown>, resolved: Data | null) {
  if (!resolved) return props;
  const id = typeof props.id === "string" ? props.id : "puck-root";
  const rp = getBlockPropsById(resolved, id);
  if (!rp) return props;
  return {
    ...props,
    ...rp,
    id: props.id,
    children: props.children,
    puck: props.puck,
    editMode: props.editMode,
  };
}

function mergeBlockForPreview(props: Record<string, unknown>, resolved: Data | null) {
  if (!resolved || typeof props.id !== "string") return props;
  const rp = getBlockPropsById(resolved, props.id);
  if (!rp) return props;
  return {
    ...props,
    ...rp,
    id: props.id,
    puck: props.puck,
    editMode: props.editMode,
    children: props.children,
  };
}

function PreviewMergeRoot({
  Original,
  props,
}: {
  Original: ComponentType<Record<string, unknown>>;
  props: Record<string, unknown>;
}) {
  const resolved = useResolvedPreviewData();
  const merged = useMemo(() => mergeRootForPreview(props, resolved), [props, resolved]);
  return <Original {...merged} />;
}

function PreviewMergeBlock({
  Original,
  props,
}: {
  Original: ComponentType<Record<string, unknown>>;
  props: Record<string, unknown>;
}) {
  const resolved = useResolvedPreviewData();
  const merged = useMemo(() => mergeBlockForPreview(props, resolved), [props, resolved]);
  return <Original {...merged} />;
}

/**
 * Wraps root + component renders so the canvas can show resolved `pages[…]` / datasource strings
 * while the document JSON in Puck state stays unchanged.
 */
export function wrapConfigForEditorPreview(base: Config): Config {
  const components = { ...(base.components as Record<string, { render?: ComponentType<Record<string, unknown>>; [k: string]: unknown }>) };
  for (const key of Object.keys(components)) {
    const c = components[key];
    if (!c?.render) continue;
    const Original = c.render;
    components[key] = {
      ...c,
      render: (props: Record<string, unknown>) => (
        <PreviewMergeBlock Original={Original} props={props} />
      ),
    };
  }

  const root = base.root as {
    render: ComponentType<Record<string, unknown>>;
    [k: string]: unknown;
  };
  const OriginalRoot = root.render;

  return {
    ...base,
    components,
    root: {
      ...root,
      render: (props: Record<string, unknown>) => (
        <PreviewMergeRoot Original={OriginalRoot} props={props} />
      ),
    },
  } as Config;
}

export function createPreviewResolvePlugin(remoteDatasourceContext: RemoteDatasourceContext): Plugin {
  return {
    name: "preview-resolve",
    overrides: {
      puck: ({ children }: { children: ReactNode }) => (
        <PreviewResolveBoundary remoteDatasourceContext={remoteDatasourceContext}>{children}</PreviewResolveBoundary>
      ),
    },
  };
}
