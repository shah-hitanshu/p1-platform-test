"use client";

import type { Config, Plugin } from "@puckeditor/core";
import { useState, type ReactNode } from "react";

import { isCrossPageRefTemplateString } from "../../../data/cross-reference";
import type { RemoteDatasourceDefinition } from "../../../data/remote-datasources/remote-datasource-registry";
import type { RouteRow } from "../../../data/page-store";
import { TemplateAutocompleteLayer } from "../template-autocomplete-layer";
import { useLiveEditorContext } from "../hooks/useLiveEditorContext";
import { ConnectFieldModal } from "./connect-field-modal";

type ScalarFieldProps = {
  children: ReactNode;
  name: string;
  readOnly?: boolean;
  onChange: (value: string, ui?: unknown) => void;
  value?: unknown;
  field?: { type?: string };
};

export function createFieldConnectPlugin(opts: {
  config: Config;
  editorPath: string;
  /**
   * Fallback until live data resolves — and the only source if the host does not
   * serve /p1/api/editor-context. Inside a P1PuckProvider these are never used.
   * @deprecated the plugin reads live data on its own.
   */
  routes?: RouteRow[];
  /** @deprecated see routes */
  remoteDatasourceRegistry?: RemoteDatasourceDefinition[];
}): Plugin {
  const {
    config,
    editorPath,
    routes: fallbackRoutes = [],
    remoteDatasourceRegistry: fallbackRegistry = [],
  } = opts;

  function ConnectableScalarField(props: ScalarFieldProps) {
    const [open, setOpen] = useState(false);
    const { children, readOnly, onChange, value } = props;
    const linked = isCrossPageRefTemplateString(value);
    // useLiveEditorContext, not useLiveRemoteDatasources — this only needs the
    // registry/routes, and it runs for every text field in the sidebar (bound or
    // not), so it must skip the per-datasource context-resolution queries.
    const live = useLiveEditorContext(editorPath);
    // live.hasLoaded (not registry.length) distinguishes "not loaded yet"
    // from "loaded and genuinely empty" — a length check would keep showing
    // a stale fallback forever once live data legitimately resolves empty.
    const registry = live.hasLoaded ? live.registry : fallbackRegistry;
    const routes = live.hasLoaded ? live.routes : fallbackRoutes;

    return (
      <TemplateAutocompleteLayer
        readOnly={readOnly}
        onChange={onChange}
        registry={registry}
      >
        <div style={{ position: "relative", paddingBottom: 2 }}>
          {children}
          {!readOnly && (
            <>
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setOpen(true);
                }}
                style={{
                  position: "absolute",
                  top: 4,
                  right: 2,
                  fontSize: 11,
                  fontWeight: 500,
                  color: "var(--puck-color-azure-04, #2563eb)",
                  background: "rgba(255,255,255,0.92)",
                  border: "1px solid var(--puck-color-grey-09, #e5e7eb)",
                  borderRadius: 4,
                  padding: "2px 6px",
                  cursor: "pointer",
                  zIndex: 3,
                }}
              >
                {linked ? "Bound" : "Bind"}
              </button>
              <ConnectFieldModal
                open={open}
                onClose={() => setOpen(false)}
                onConfirm={(t) => onChange(t)}
                routes={routes}
                config={config}
                editorPath={editorPath}
              />
            </>
          )}
        </div>
      </TemplateAutocompleteLayer>
    );
  }

  return {
    name: "field-connect",
    overrides: {
      fieldTypes: {
        text: (props) => <ConnectableScalarField {...(props as ScalarFieldProps)} />,
        textarea: (props) => <ConnectableScalarField {...(props as ScalarFieldProps)} />,
      },
    },
  };
}
