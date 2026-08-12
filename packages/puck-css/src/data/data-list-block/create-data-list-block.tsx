import { type ReactElement } from "react";
import { createUsePuck, FieldLabel } from "@puckeditor/core";
import { Select } from "@pantheon-systems/pds-toolkit-react";
import { createDatasourceSelectField, useDatasourceData, useDatasourceRegistry } from "../fields/datasource-select-field.js";
import { createSchemaSelectField, extractFieldPaths } from "../fields/schema-select-field.js";
import { autoMapFields } from "../schema-heuristics.js";
import { createImagePositionField, clampImagePosition } from "../fields/image-position-field.js";
import { createViewModeField } from "../fields/view-mode-field.js";
import {
  createPdsTextField,
  createPdsNumberField,
  createPdsSegmentedField,
} from "../fields/pds-field-helpers.js";
import { applyCollectionOperators, groupItems } from "../collection-operators.js";
import { builtinModes } from "./builtin-modes.js";
import { DATA_LIST_FIELD_GROUPS } from "./field-groups.js";
import { isTemplateDatasource, normalizeItems, resolveItemFields, viewExtractKey } from "./utils.js";
import type {
  CreateDataListBlockOptions,
  DataListBlockConfig,
  ViewModeDefinition,
  ResolvedItem,
  ImagePositionOption,
} from "./types.js";

const STATUS_OPTIONS = [
  { label: "Published", value: "Published" },
  { label: "Published or scheduled", value: "Published or scheduled" },
  { label: "Any status", value: "Any status" },
];

const useStatusPuck = createUsePuck();

function StatusSelectFieldInner({
  label,
  value,
  onChange,
  readOnly,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  readOnly?: boolean;
}): ReactElement | null {
  const selectedItem = useStatusPuck((s) => s.selectedItem) as {
    props: Record<string, unknown>;
  } | null;
  const datasourceId = (selectedItem?.props?.datasourceId as string) ?? "";
  if (!isTemplateDatasource(datasourceId)) return null;
  return (
    <FieldLabel label={label}>
      <Select
        value={value}
        options={STATUS_OPTIONS}
        onOptionSelect={(opt: { value: string }) => onChange(opt.value)}
        disabled={readOnly}
      />
    </FieldLabel>
  );
}

export function createDataListBlock(options?: CreateDataListBlockOptions): DataListBlockConfig {
  const modes: Record<string, ViewModeDefinition> =
    options?.modes ?? builtinModes;
  const label = options?.label ?? "List";
  const wrapperClassName = options?.wrapperClassName ?? "";

  const modeEntries = Object.entries(modes);
  const firstModeKey = modeEntries[0]?.[0] ?? "grid";
  const firstModePositions = modeEntries[0]?.[1]?.imagePositions ?? [];
  const defaultImagePosition = firstModePositions[0]?.value ?? "top";

  const modePositions: Record<string, ImagePositionOption[]> = {};
  for (const [key, mode] of modeEntries) {
    modePositions[key] = mode.imagePositions;
  }

  const viewModeField = createViewModeField(
    modeEntries.map(([key, mode]) => ({
      label: mode.label,
      value: key as string,
    })),
  );

  const modeFields: Record<string, unknown> = {};
  const modeDefaultProps: Record<string, unknown> = {};

  for (const [, mode] of modeEntries) {
    if (mode.fields) {
      for (const [fieldKey, fieldDef] of Object.entries(mode.fields)) {
        modeFields[fieldKey] = fieldDef;
      }
    }
    if (mode.defaultProps) {
      for (const [propKey, propVal] of Object.entries(mode.defaultProps)) {
        modeDefaultProps[propKey] = propVal;
      }
    }
  }

  const fields = {
    // Content
    heading: createPdsTextField("Heading"),
    datasourceId: createDatasourceSelectField(),

    // Content > Field mapping
    titleField: createSchemaSelectField({
      label: "Title",
      togglePropName: "showTitle",
      required: true,
      typeHint: "string",
    }),
    subtitleField: createSchemaSelectField({
      label: "Subtitle",
      togglePropName: "showSubtitle",
      typeHint: "string",
    }),
    teaserField: createSchemaSelectField({
      label: "Teaser",
      togglePropName: "showTeaser",
      typeHint: "rich text",
    }),
    imageField: createSchemaSelectField({
      label: "Image",
      togglePropName: "showImage",
      typeHint: "image",
    }),
    imagePosition: createImagePositionField({
      label: "Image position",
      visibleWhenPropName: "showImage",
      modePositions,
    }),
    iconField: createSchemaSelectField({
      label: "Icon",
      togglePropName: "showIcon",
      typeHint: "icon",
    }),

    // Layout & Style
    viewMode: viewModeField,
    ...modeFields,
    groupBy: createSchemaSelectField({
      label: "Group by",
    }),
    startAt: createPdsNumberField("Start at", { min: 1 }),
    status: {
      type: "custom" as const,
      label: "Status",
      render(props: {
        label: string;
        value: string;
        onChange: (v: string) => void;
        readOnly?: boolean;
      }) {
        return (
          <StatusSelectFieldInner
            label={props.label}
            value={props.value}
            onChange={props.onChange}
            readOnly={props.readOnly}
          />
        );
      },
    },
    sortBy: createSchemaSelectField({
      label: "Sort by",
    }),
    sortDir: createPdsSegmentedField("Sort direction", [
      { label: "Ascending", value: "asc" },
      { label: "Descending", value: "desc" },
    ]),
    filterField: createSchemaSelectField({
      label: "Filter field",
    }),
    filterContains: createPdsTextField("Filter contains"),
    maxItems: createPdsNumberField("Max items", { min: 0, max: 100 }),
  };

  // The field-mapping props are deliberately absent: `undefined` means "never
  // chosen" and triggers auto-mapping, while `""` is the user picking "None".
  const defaultProps: Record<string, unknown> = {
    datasourceId: "",
    viewMode: firstModeKey,
    showTitle: true,
    showSubtitle: true,
    showTeaser: false,
    showImage: true,
    showIcon: false,
    imagePosition: defaultImagePosition,
    heading: "",
    groupBy: "",
    startAt: 1,
    status: "Published",
    sortBy: "",
    sortDir: "asc",
    filterField: "",
    filterContains: "",
    maxItems: 0,
    items: "",
    ...modeDefaultProps,
  };

  async function resolveData(
    data: { props: Record<string, unknown> },
    { changed }: { changed: Record<string, boolean> },
  ) {
    if (!changed.datasourceId) return { props: {} };
    const { datasourceId } = data.props as { datasourceId: string };
    const items = datasourceId ? `{{ ${datasourceId}.items }}` : "";
    return { props: { items } };
  }

  function DataListBlockRender(props: Record<string, unknown>) {
    const datasourceId = (props.datasourceId as string) ?? "";
    const viewMode = (props.viewMode as string) ?? firstModeKey;
    const titleField = props.titleField as string | undefined;
    const subtitleField = props.subtitleField as string | undefined;
    const teaserField = props.teaserField as string | undefined;
    const imageField = props.imageField as string | undefined;
    const iconField = props.iconField as string | undefined;
    const showTitle = (props.showTitle as boolean) ?? true;
    const showSubtitle = (props.showSubtitle as boolean) ?? true;
    const showTeaser = (props.showTeaser as boolean) ?? false;
    const showImage = (props.showImage as boolean) ?? true;
    const showIcon = (props.showIcon as boolean) ?? false;
    const imagePosition = (props.imagePosition as string) ?? defaultImagePosition;
    const heading = (props.heading as string) ?? "";
    const groupBy = (props.groupBy as string) ?? "";
    const startAt = (props.startAt as number) ?? 1;
    const status = (props.status as string) ?? "Published";
    const sortBy = (props.sortBy as string) ?? "";
    const sortDir = (props.sortDir as string) ?? "asc";
    const filterField = (props.filterField as string) ?? "";
    const filterContains = (props.filterContains as string) ?? "";
    const maxItems = (props.maxItems as number) ?? 0;

    const datasourceContext = useDatasourceData();
    const registry = useDatasourceRegistry();
    let rawItems: unknown = props.items;
    if (!Array.isArray(rawItems) && datasourceId) {
      const dsData = datasourceContext[datasourceId] as Record<string, unknown> | undefined;
      if (dsData?.items && Array.isArray(dsData.items)) {
        rawItems = dsData.items;
      }
    }

    const baseItems = normalizeItems(rawItems);

    let effectiveTitleField = titleField ?? "";
    let effectiveSubtitleField = subtitleField ?? "";
    let effectiveTeaserField = teaserField ?? "";
    let effectiveImageField = imageField ?? "";
    let effectiveIconField = iconField ?? "";

    const unmapped = [titleField, subtitleField, teaserField, imageField, iconField]
      .some((field) => field === undefined);

    if (datasourceId && unmapped) {
      let fieldDefs: { path: string; description: string }[] = [];

      if (baseItems.length > 0) {
        fieldDefs = extractFieldPaths(baseItems[0] as Record<string, unknown>);
      } else if (datasourceContext[datasourceId]) {
        const dsData = datasourceContext[datasourceId] as Record<string, unknown>;
        const dsItems = dsData?.items;
        if (Array.isArray(dsItems) && dsItems.length > 0) {
          fieldDefs = extractFieldPaths(dsItems[0] as Record<string, unknown>);
        } else {
          fieldDefs = extractFieldPaths(dsData);
        }
      }

      const datasource = registry.find((ds) => ds.id === datasourceId);
      if (datasource) {
        const rawFields = datasource.fields ?? [];
        const ITEM_PREFIXES = ["items.0.", "items[]."];
        const itemFields: typeof rawFields = [];
        for (const f of rawFields) {
          const prefix = ITEM_PREFIXES.find((p) => f.path.startsWith(p));
          if (prefix) {
            itemFields.push({ ...f, path: f.path.slice(prefix.length) });
          }
        }
        const staticFields = itemFields.length > 0 ? itemFields : rawFields;
        if (fieldDefs.length === 0) {
          fieldDefs = staticFields;
        } else if (itemFields.length > 0) {
          const seen = new Set(fieldDefs.map((f) => f.path));
          for (const sf of itemFields) {
            if (!seen.has(sf.path)) {
              fieldDefs.push(sf);
            }
          }
        }
      }

      if (fieldDefs.length > 0) {
        const mapped = autoMapFields(fieldDefs);
        if (titleField === undefined && mapped.title)
          effectiveTitleField = `{{ item.${mapped.title} }}`;
        if (subtitleField === undefined && mapped.subtitle)
          effectiveSubtitleField = `{{ item.${mapped.subtitle} }}`;
        if (teaserField === undefined && mapped.teaser)
          effectiveTeaserField = `{{ item.${mapped.teaser} }}`;
        if (imageField === undefined && mapped.image)
          effectiveImageField = `{{ item.${mapped.image} }}`;
        if (iconField === undefined && mapped.icon)
          effectiveIconField = `{{ item.${mapped.icon} }}`;
      }
    }

    const sectionClass = wrapperClassName || undefined;

    if (!datasourceId) {
      return (
        <section className={sectionClass}>
          <div className="rounded-lg border-2 border-dashed border-slate-300 p-8 text-center text-slate-500">
            Select a datasource to display items
          </div>
        </section>
      );
    }
    const sortByKey = viewExtractKey(sortBy) ?? "";
    const groupByKey = viewExtractKey(groupBy) ?? "";
    const filterFieldKey = viewExtractKey(filterField) ?? "";

    const { items: processedItems, totalBeforeLimit } =
      applyCollectionOperators(baseItems, {
        status: isTemplateDatasource(datasourceId) ? status : undefined,
        filterField: filterFieldKey,
        filterContains,
        sortBy: sortByKey,
        sortDir: sortDir as "asc" | "desc",
        startAt,
        limit: maxItems,
      });

    if (processedItems.length === 0) {
      return (
        <section className={sectionClass}>
          {heading && (
            <h2 className="mb-4 text-xl font-bold text-slate-900">{heading}</h2>
          )}
          <div className="rounded-lg border-2 border-dashed border-slate-300 p-8 text-center text-slate-500">
            No items to display
          </div>
        </section>
      );
    }

    const fieldMappings = {
      titleField: effectiveTitleField,
      subtitleField: effectiveSubtitleField,
      teaserField: effectiveTeaserField,
      imageField: effectiveImageField,
      iconField: effectiveIconField,
    };

    const groups = groupItems(processedItems, groupByKey);

    const resolveGroup = (items: Record<string, unknown>[]): ResolvedItem[] =>
      items.map((item) => resolveItemFields(item, fieldMappings));

    const layoutProps = {
      showTitle,
      showSubtitle,
      showTeaser,
      showImage,
      showIcon,
    };

    function renderLayout(resolved: ResolvedItem[]) {
      const mode = modes[viewMode] ?? modes[firstModeKey];
      if (!mode) return null;
      const clamped = clampImagePosition(viewMode, imagePosition, modePositions);
      const Component = mode.component;

      const modeExtraProps: Record<string, unknown> = {};
      if (mode.fields) {
        for (const key of Object.keys(mode.fields)) {
          modeExtraProps[key] = props[key];
        }
      }

      return (
        <Component
          items={resolved}
          {...layoutProps}
          {...modeExtraProps}
          imagePosition={clamped}
        />
      );
    }

    const hasGroups =
      groups.length > 1 || (groups.length === 1 && groups[0]?.label !== "");
    const truncated =
      maxItems > 0 && totalBeforeLimit > processedItems.length;

    return (
      <section className={sectionClass}>
        {heading && (
          <h2 className="mb-4 text-xl font-bold text-slate-900">{heading}</h2>
        )}
        {hasGroups ? (
          <div className="space-y-6">
            {groups.map((group) => (
              <div key={group.label}>
                <h3 className="mb-3 text-lg font-semibold text-slate-700">
                  {group.label}
                </h3>
                {renderLayout(resolveGroup(group.items))}
              </div>
            ))}
          </div>
        ) : (
          renderLayout(resolveGroup(processedItems))
        )}
        {truncated && (
          <div className="mt-3 text-center text-sm text-slate-400">
            +{totalBeforeLimit - processedItems.length} more
          </div>
        )}
      </section>
    );
  }

  return {
    label,
    fields,
    defaultProps,
    resolveData,
    render: DataListBlockRender,
    _fieldGroups: DATA_LIST_FIELD_GROUPS,
  };
}
