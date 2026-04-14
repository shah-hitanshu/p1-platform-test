"use client";

import { useState } from "react";

import { primaryButton } from "../lib/styles";
import { useCreateStructure } from "./hooks";

export function CreatePageForm() {
  const [path, setPath] = useState("/contact-us");
  const [message, setMessage] = useState<string | null>(null);
  const createMutation = useCreateStructure("page");

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    createMutation.mutate(path, {
      onSuccess: (resultPath) => setMessage(`Created page ${resultPath}`),
      onError: (err) => setMessage(err.message),
    });
  }

  return (
    <form onSubmit={onSubmit} style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
      <input
        name="path"
        value={path}
        onChange={(e) => setPath(e.target.value)}
        placeholder="/contact-us"
        style={{
          padding: "8px 10px",
          minWidth: 220,
          fontFamily: "ui-monospace, monospace",
          fontSize: 14,
          border: "1px solid #ccc",
          borderRadius: 4,
          background: "#fff",
        }}
      />
      <button
        type="submit"
        disabled={createMutation.isPending}
        style={{ ...primaryButton, padding: "8px 14px", fontSize: 14, cursor: createMutation.isPending ? "wait" : undefined }}
      >
        {createMutation.isPending ? "Creating…" : "Add page"}
      </button>
      {message && (
        <span style={{ fontSize: 13, color: message.startsWith("Created") ? "#0a0" : "#c00" }}>
          {message}
        </span>
      )}
    </form>
  );
}
