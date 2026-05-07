"use client";

import { useEffect, useState } from "react";

import { defaultInstancePathFromTemplate } from "../../data/route-templates";
import { primaryButton, secondaryButton } from "../../data/styles";
import { useCreateStructure } from "./hooks";

export function AddOverrideForTemplate({ templatePath }: { templatePath: string }) {
  const [open, setOpen] = useState(false);
  const [instancePath, setInstancePath] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const createMutation = useCreateStructure("override");

  useEffect(() => {
    if (open) {
      setInstancePath(defaultInstancePathFromTemplate(templatePath));
      setMessage(null);
    }
  }, [open, templatePath]);

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    createMutation.mutate(instancePath.trim(), {
      onSuccess: () => setOpen(false),
      onError: (err) => setMessage(err.message),
    });
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        style={{ ...secondaryButton, marginLeft: 12, padding: "4px 10px" }}
      >
        Add override
      </button>
    );
  }

  return (
    <form
      onSubmit={(e) => void onSubmit(e)}
      style={{
        marginTop: 8,
        marginLeft: 12,
        display: "flex",
        flexDirection: "column",
        alignItems: "flex-start",
        gap: 8,
        maxWidth: 360,
      }}
    >
      <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12, color: "#444" }}>
        Instance path for <code style={{ fontFamily: "ui-monospace, monospace" }}>{templatePath}</code>
        <input
          value={instancePath}
          onChange={(e) => setInstancePath(e.target.value)}
          placeholder="/starships/42"
          autoFocus
          style={{
            padding: "6px 8px",
            fontFamily: "ui-monospace, monospace",
            fontSize: 13,
            minWidth: 260,
            border: "1px solid #ccc",
            borderRadius: 4,
            background: "#fff",
          }}
        />
      </label>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
        <button
          type="submit"
          disabled={createMutation.isPending}
          style={{ ...primaryButton, cursor: createMutation.isPending ? "wait" : undefined }}
        >
          {createMutation.isPending ? "Creating…" : "Create override"}
        </button>
        <button
          type="button"
          disabled={createMutation.isPending}
          onClick={() => setOpen(false)}
          style={secondaryButton}
        >
          Cancel
        </button>
        {message && (
          <span style={{ fontSize: 12, color: message.includes("failed") || message === "Network error" ? "#c00" : "#0a0" }}>
            {message}
          </span>
        )}
      </div>
      <p style={{ margin: 0, fontSize: 11, color: "#666", lineHeight: 1.4 }}>
        Publish from <code style={{ fontFamily: "ui-monospace, monospace" }}>…/edit</code> stores semantic diffs only.
      </p>
    </form>
  );
}
