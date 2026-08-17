export type FieldGroup = "content" | "content:fieldMapping" | "layout" | "hidden";

export const MODE_FIELD_OWNERS: Record<string, string> = {
  columns: "grid",
  rowDensity: "table",
  listingWidth: "list",
};

export const DATA_LIST_FIELD_GROUPS: Record<string, FieldGroup> = {
  datasourceId: "content",
  heading: "content",
  titleField: "content:fieldMapping",
  subtitleField: "content:fieldMapping",
  teaserField: "content:fieldMapping",
  imageField: "content:fieldMapping",
  imagePosition: "content:fieldMapping",
  imageLoading: "content:fieldMapping",
  iconField: "content:fieldMapping",
  viewMode: "layout",
  columns: "layout",
  rowDensity: "layout",
  listingWidth: "layout",
  groupBy: "layout",
  startAt: "layout",
  status: "layout",
  sortBy: "layout",
  sortDir: "layout",
  filterField: "layout",
  filterContains: "layout",
  maxItems: "layout",
};
