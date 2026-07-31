"use client";

import type { Config, Data, Plugin } from "@puckeditor/core";
import { createUsePuck } from "@puckeditor/core";

const usePuckStore = createUsePuck();
import {
  createContext,
  isValidElement,
  useContext,
  useMemo,
  type ComponentType,
  type ReactNode,
} from "react";

import { getBlockPropsById } from "../../data/cross-reference";
import type { RemoteDatasourceContext } from "../../data/remote-datasources/loader";
import { useResolvePreview } from "./hooks/api-hooks";

interface PreviewResolvedState {
  data: Data | null;
  loading: boolean;
}

const PreviewResolvedContext = createContext<PreviewResolvedState>({
  data: null,
  loading: false,
});

function useResolvedPreviewState(): PreviewResolvedState {
  return useContext(PreviewResolvedContext);
}

const TEMPLATE_TOKEN_RE = /\{\{[^{}]+\}\}/g;
const SHIMMER_PLACEHOLDER = "    ";

function shimmerUnresolvedTokens(
  props: Record<string, unknown>,
  loading: boolean,
): Record<string, unknown> {
  if (!loading) return props;
  let changed = false;
  const result = { ...props };
  for (const key of Object.keys(result)) {
    const val = result[key];
    if (typeof val === "string" && TEMPLATE_TOKEN_RE.test(val)) {
      result[key] = val.replace(TEMPLATE_TOKEN_RE, SHIMMER_PLACEHOLDER);
      changed = true;
    }
  }
  return changed ? result : props;
}

function PreviewResolveBoundary({
  children,
  remoteDatasourceContext,
  loading,
}: {
  children: ReactNode;
  remoteDatasourceContext: RemoteDatasourceContext;
  loading?: boolean;
}) {
  const data = usePuckStore((s) => s.appState.data);
  const { data: resolved } = useResolvePreview(data, remoteDatasourceContext);

  const state = useMemo<PreviewResolvedState>(
    () => ({ data: resolved ?? null, loading: loading ?? false }),
    [resolved, loading],
  );

  return (
    <PreviewResolvedContext.Provider value={state}>{children}</PreviewResolvedContext.Provider>
  );
}

function mergeRootForPreview(props: Record<string, unknown>, resolved: Data | null, loading: boolean) {
  if (!resolved) return shimmerUnresolvedTokens(props, loading);
  const id = typeof props.id === "string" ? props.id : "puck-root";
  const rp = getBlockPropsById(resolved, id);
  if (!rp) return shimmerUnresolvedTokens(props, loading);
  const merged = { ...props };
  for (const key of Object.keys(rp)) {
    if (key === "id" || key === "puck" || key === "editMode" || key === "children") continue;
    if (isValidElement(props[key])) continue;
    merged[key] = rp[key];
  }
  return shimmerUnresolvedTokens(merged, loading);
}

function mergeBlockForPreview(props: Record<string, unknown>, resolved: Data | null, loading: boolean) {
  if (!resolved || typeof props.id !== "string") return shimmerUnresolvedTokens(props, loading);
  const rp = getBlockPropsById(resolved, props.id);
  if (!rp) return shimmerUnresolvedTokens(props, loading);
  const merged = { ...props };
  for (const key of Object.keys(rp)) {
    if (key === "id" || key === "puck" || key === "editMode" || key === "children") continue;
    if (isValidElement(props[key])) continue;
    merged[key] = rp[key];
  }
  return shimmerUnresolvedTokens(merged, loading);
}

function PreviewMergeRoot({
  Original,
  props,
}: {
  Original: ComponentType<Record<string, unknown>>;
  props: Record<string, unknown>;
}) {
  const { data: resolved, loading } = useResolvedPreviewState();
  const merged = useMemo(() => mergeRootForPreview(props, resolved, loading), [props, resolved, loading]);
  return <Original {...merged} />;
}

function PreviewMergeBlock({
  Original,
  props,
}: {
  Original: ComponentType<Record<string, unknown>>;
  props: Record<string, unknown>;
}) {
  const { data: resolved, loading } = useResolvedPreviewState();
  const merged = useMemo(() => mergeBlockForPreview(props, resolved, loading), [props, resolved, loading]);
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

export function createPreviewResolvePlugin(
  remoteDatasourceContext: RemoteDatasourceContext,
  options?: { loading?: boolean },
): Plugin {
  return {
    name: "preview-resolve",
    overrides: {
      puck: ({ children }: { children: ReactNode }) => (
        <PreviewResolveBoundary
          remoteDatasourceContext={remoteDatasourceContext}
          loading={options?.loading}
        >
          {children}
        </PreviewResolveBoundary>
      ),
    },
  };
}

export { useResolvedPreviewState };
export { mergeBlockForPreview as _mergeBlockForPreview, mergeRootForPreview as _mergeRootForPreview };
