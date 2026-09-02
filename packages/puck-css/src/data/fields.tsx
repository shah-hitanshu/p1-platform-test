"use client";

import React from "react";
import type { RichtextField, TextField } from "@puckeditor/core";
// RichTextMenu is NOT statically imported here. Lazily loading it keeps the
// @puckeditor/core editor bundle out of any context that only needs the field
// config (e.g. preview pages, server-side rendering). The editor loads it on
// first toolbar render, when @puckeditor/core is already present anyway.

import type { FieldAiMeta } from "../editor/utils/componentRegistry";

export type RichtextFieldWithAi = RichtextField & { ai?: FieldAiMeta };
export type TextFieldWithAi = TextField & { ai?: FieldAiMeta };

const LazyRichTextMenu = React.lazy(() =>
  import("@puckeditor/core").then(({ RichTextMenu }) => ({
    default: function DefaultRichTextMenu() {
      return (
        <RichTextMenu>
          <RichTextMenu.Group>
            <RichTextMenu.Bold />
            <RichTextMenu.Italic />
            <RichTextMenu.Underline />
          </RichTextMenu.Group>
          <RichTextMenu.Group>
            <RichTextMenu.BulletList />
            <RichTextMenu.OrderedList />
          </RichTextMenu.Group>
        </RichTextMenu>
      );
    },
  }))
);

const defaultRichtextMenu: RichtextField["renderMenu"] = () => (
  <React.Suspense fallback={null}>
    <LazyRichTextMenu />
  </React.Suspense>
);

export const richtextField: RichtextFieldWithAi = {
  type: "richtext",
  contentEditable: true,
  // @puckeditor/core registers the TipTap `textAlign` extension by default, but
  // our toolbar (`defaultRichtextMenu`) never exposes alignment — so `text-align`
  // is schema surface that only ever gets populated by paste. That is exactly why
  // pasting justified content from Word/Google Docs/web rendered justified in the
  // editor: ProseMirror discards foreign markup it can't represent
  // (fonts, colors, classes, scripts) for free, but alignment WAS representable
  // and so survived. Disabling the extension makes alignment unrepresentable, so
  // the schema drops it natively on every ingest path — paste, drag-and-drop,
  // AI `onChange`, and collaborative `setContent` alike.
  options: { textAlign: false },
  ai: {
    instructions:
      "Generate well-structured prose. Use bold or lists sparingly and only when they genuinely aid readability. Do not include heading tags — use the Heading block for headings.",
  },
  renderMenu: defaultRichtextMenu,
};

export function createRichtextField(
  overrides?: Partial<RichtextFieldWithAi>,
): RichtextFieldWithAi {
  if (!overrides) return { ...richtextField };

  const { ai: aiOverride, options: optionsOverride, ...rest } = overrides as
    Partial<RichtextFieldWithAi> & { options?: Record<string, unknown> };

  const merged: RichtextFieldWithAi & { options?: Record<string, unknown> } = {
    ...richtextField,
    ...rest,
  };

  // Deep-merge the nested `ai`/`options` objects so overriding a single key
  // keeps the defaults for the rest — e.g. `createRichtextField({ ai: { exclude: true } })`
  // retains the default `ai.instructions` instead of silently dropping it.
  if (richtextField.ai || aiOverride) {
    merged.ai = { ...richtextField.ai, ...aiOverride };
  }

  const baseOptions = (richtextField as { options?: Record<string, unknown> }).options;
  if (baseOptions || optionsOverride) {
    merged.options = { ...baseOptions, ...optionsOverride };
  }

  return merged;
}

export const inlineTextField: TextFieldWithAi = {
  type: "text",
  contentEditable: true,
  ai: {
    instructions: "Generate concise, plain text. No markdown or HTML.",
  },
};

export {
  createDatasourceSelectField,
  DatasourceRegistryProvider,
  useDatasourceRegistry,
  DatasourceDataProvider,
  useDatasourceData,
} from "./fields/datasource-select-field.js";

export { createTemplateSelectField } from "./fields/template-select-field.js";

export { createSchemaSelectField } from "./fields/schema-select-field.js";

export {
  createImagePositionField,
  clampImagePosition,
} from "./fields/image-position-field.js";

export { createViewModeField } from "./fields/view-mode-field.js";

export { useP1PuckOptional } from "../core/P1PuckContext.js";
export { PuckConfigProvider, usePuckConfig } from "../core/PuckConfigContext.js";

export {
  suggestFieldForRole,
  autoMapFields,
} from "./schema-heuristics.js";
export type { FieldRole } from "./schema-heuristics.js";
export {
  sortItems,
  filterItems,
  applyCollectionOperators,
  groupItems,
} from "./collection-operators.js";

export {
  createDataListBlock,
  builtinModes,
  Cards,
  Rows,
  Listing,
  normalizeItems,
  resolveItemFields,
  resolveField,
  getByDotPath,
  viewExtractKey,
} from "./data-list-block/index.js";
export type {
  ResolvedItem,
  LayoutProps,
  ImageLoading,
  ViewModeDefinition,
  CreateDataListBlockOptions,
  ImagePositionOption,
  PuckFieldDef,
} from "./data-list-block/index.js";
