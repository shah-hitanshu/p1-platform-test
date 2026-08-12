import {
  createPdsNumberField,
  createPdsSegmentedField,
} from "../fields/pds-field-helpers.js";
import type { ViewModeDefinition } from "./types.js";
import { Cards } from "./builtin-components/cards.js";
import { Rows } from "./builtin-components/rows.js";
import { Listing } from "./builtin-components/listing.js";

export const builtinModes: Record<string, ViewModeDefinition> = {
  grid: {
    label: "Grid",
    component: Cards,
    imagePositions: [
      { label: "Top", value: "top" },
      { label: "Left", value: "left" },
      { label: "Right", value: "right" },
      { label: "Backdrop", value: "backdrop" },
      { label: "None", value: "none" },
    ],
    fields: {
      columns: createPdsNumberField("Columns", { min: 1, max: 6 }),
    },
    defaultProps: { columns: 3 },
  },
  table: {
    label: "Table",
    component: Rows,
    imagePositions: [
      { label: "Left", value: "left" },
      { label: "None", value: "none" },
    ],
    fields: {
      rowDensity: createPdsSegmentedField("Row density", [
        { label: "Compact", value: "compact" },
        { label: "Comfortable", value: "comfortable" },
      ]),
    },
    defaultProps: { rowDensity: "comfortable" },
  },
  list: {
    label: "List",
    component: Listing,
    imagePositions: [
      { label: "Left", value: "left" },
      { label: "Right", value: "right" },
      { label: "None", value: "none" },
    ],
    fields: {
      listingWidth: createPdsSegmentedField("Listing width", [
        { label: "Contained", value: "narrow" },
        { label: "Full bleed", value: "wide" },
      ]),
    },
    defaultProps: { listingWidth: "wide" },
  },
};
