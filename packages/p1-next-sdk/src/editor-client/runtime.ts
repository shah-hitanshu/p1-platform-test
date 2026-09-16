"use client";

import { createNextConfig, wrapConfigForEditorPreview } from "@pantheon-systems/puck-css";
import type { Config, Plugin } from "@puckeditor/core";
import type { P1Config, UseP1OverridesOptions } from "@pantheon-systems/puck-css";
import type React from "react";

import type {
  CreateP1EditorClientOptions,
  EditorPluginOptions,
  P1EditorContext,
  P1EditorExtensions,
} from "./types";

/**
 * The options after defaulting, plus the two values derived once at factory
 * time. The components below read their inputs from this rather than from the
 * factory's closure, so what each one depends on is visible in its props.
 */
export type EditorRuntime = {
  /** The app's config as written; the P1 plugin set is derived from it. */
  puckConfig: Config;
  /** The same config wrapped for preview; this is what the canvas renders. */
  editorConfig: Config;
  signInPage?: React.ReactElement;
  plugins: Plugin[];
  pluginOptions: Partial<EditorPluginOptions>;
  overrideOptions: UseP1OverridesOptions;
  useExtensions: (ctx: P1EditorContext) => P1EditorExtensions;
  wrapEditor?: (children: React.ReactNode) => React.ReactNode;
  /** Null when the environment does not describe a P1 site; `configError` says why. */
  config: P1Config | null;
  configError: string | null;
};

const NO_EXTENSIONS: P1EditorExtensions = {};

function useNoExtensions(): P1EditorExtensions {
  return NO_EXTENSIONS;
}

export function createEditorRuntime(options: CreateP1EditorClientOptions): EditorRuntime {
  let config: P1Config | null = null;
  let configError: string | null = null;
  try {
    config = createNextConfig();
  } catch (e) {
    configError = e instanceof Error ? e.message : String(e);
  }

  return {
    puckConfig: options.puckConfig,
    editorConfig: wrapConfigForEditorPreview(options.puckConfig),
    signInPage: options.signInPage,
    plugins: options.plugins ?? [],
    pluginOptions: options.pluginOptions ?? {},
    overrideOptions: options.overrideOptions ?? {},
    useExtensions: options.useExtensions ?? useNoExtensions,
    wrapEditor: options.wrapEditor,
    config,
    configError,
  };
}
