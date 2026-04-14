"use client";

import { useState } from "react";

import type { RemoteDatasourceScope } from "../../lib/remote-datasources/user-remote-datasource-types";
import {
  parseFieldLines,
  parseRecordLines,
  toLines,
  type ScopedUiRemoteDatasource,
  type UiRemoteDatasource,
} from "./remote-datasource-form-helpers";
import {
  card,
  errorText,
  mono,
  muted,
  primaryButton,
  secondaryButton,
} from "../../lib/styles";
import {
  useRemoteDatasources,
  useRemoveRemoteDatasource,
  useSaveRemoteDatasource,
} from "../hooks";

export function RemoteDatasourceManager({ editorPath }: { editorPath: string }) {
  const { data: datasourcesData } = useRemoteDatasources(editorPath);
  const saveMutation = useSaveRemoteDatasource(editorPath);
  const removeMutation = useRemoveRemoteDatasource(editorPath);

  const [scope, setScope] = useState<RemoteDatasourceScope>("page");
  const [id, setId] = useState("");
  const [label, setLabel] = useState("");
  const [description, setDescription] = useState("");
  const [urlTemplate, setUrlTemplate] = useState("");
  const [fieldsText, setFieldsText] = useState("title|Display title");
  const [headersText, setHeadersText] = useState("");
  const [queryText, setQueryText] = useState("");

  const save = () => {
    saveMutation.mutate(
      {
        scope,
        path: editorPath,
        definition: {
          id,
          label,
          description,
          urlTemplate,
          fields: parseFieldLines(fieldsText),
          headers: parseRecordLines(headersText),
          query: parseRecordLines(queryText),
        },
      },
      {
        onSuccess: () => {
          setId("");
          setLabel("");
          setDescription("");
          setUrlTemplate("");
          setFieldsText("title|Display title");
          setHeadersText("");
          setQueryText("");
        },
      },
    );
  };

  const globalDatasources = (datasourcesData?.global ?? []) as UiRemoteDatasource[];
  const pageDatasources = (datasourcesData?.page ?? []) as UiRemoteDatasource[];
  const all: ScopedUiRemoteDatasource[] = [
    ...globalDatasources.map((d) => ({ ...d, scope: "global" as const })),
    ...pageDatasources.map((d) => ({ ...d, scope: "page" as const })),
  ];

  const error = saveMutation.error?.message ?? null;

  return (
    <div style={{ ...card, padding: 12 }}>
      <div style={{ fontWeight: 600, marginBottom: 8 }}>
        Manage data sources
      </div>
      <p style={{ ...muted, margin: "0 0 10px" }}>
        Create HTTP JSON datasources. Values may include template tokens like{" "}
        <code style={mono}>{`{{ urlParams.id }}`}</code>.
      </p>
      <div style={{ display: "grid", gap: 8 }}>
        <select
          value={scope}
          onChange={(e) => setScope(e.target.value as RemoteDatasourceScope)}
        >
          <option value="page">Page scope</option>
          <option value="global">Global scope</option>
        </select>
        <input
          placeholder="id (lowercase_snake_case)"
          value={id}
          onChange={(e) => setId(e.target.value)}
        />
        <input
          placeholder="Label"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
        />
        <input
          placeholder="Description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
        <input
          placeholder="https://example.com/api/items/{{ urlParams.id }}"
          value={urlTemplate}
          onChange={(e) => setUrlTemplate(e.target.value)}
        />
        <textarea
          rows={3}
          placeholder={"fields: path|description"}
          value={fieldsText}
          onChange={(e) => setFieldsText(e.target.value)}
        />
        <textarea
          rows={2}
          placeholder={"headers: key=value"}
          value={headersText}
          onChange={(e) => setHeadersText(e.target.value)}
        />
        <textarea
          rows={2}
          placeholder={"query: key=value"}
          value={queryText}
          onChange={(e) => setQueryText(e.target.value)}
        />
        <button
          type="button"
          onClick={save}
          style={{ ...primaryButton, width: "fit-content" }}
        >
          Save datasource
        </button>
        {error ? <p style={errorText}>{error}</p> : null}
      </div>
      {all.length > 0 ? (
        <div style={{ marginTop: 10, display: "grid", gap: 6 }}>
          {all.map((d) => (
            <div
              key={`${d.scope}:${d.id}`}
              style={{
                border: "1px solid var(--puck-color-grey-10, #f3f4f6)",
                borderRadius: 6,
                padding: 8,
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  gap: 8,
                }}
              >
                <div>
                  <strong>{d.label}</strong>{" "}
                  <code style={mono}>
                    {d.id} ({d.scope})
                  </code>
                  <div style={muted}>{d.urlTemplate}</div>
                </div>
                <div style={{ display: "flex", gap: 6 }}>
                  <button
                    type="button"
                    style={secondaryButton}
                    onClick={() => {
                      setScope(d.scope);
                      setId(d.id);
                      setLabel(d.label);
                      setDescription(d.description);
                      setUrlTemplate(d.urlTemplate);
                      setFieldsText(
                        d.fields
                          .map((f) => `${f.path}|${f.description}`)
                          .join("\n"),
                      );
                      setHeadersText(toLines(d.headers));
                      setQueryText(toLines(d.query));
                    }}
                  >
                    Edit
                  </button>
                  <button type="button" style={secondaryButton} onClick={() => removeMutation.mutate({ scope: d.scope, path: editorPath, id: d.id })}>
                    Delete
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
