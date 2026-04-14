"use client";

import type { Config } from "@puckeditor/core";
import type { ReactNode } from "react";

type AnyProps = Record<string, unknown> & { id?: string };

// Injected via <style> tag because the class names are applied dynamically
// by PreviewHit wrappers around arbitrary Puck components.
const css = `
/* Make every block feel clickable */
.connect-preview-hit {
  cursor: pointer;
  transition: box-shadow 0.12s ease;
}
/* Solid blue ring on the currently-selected block */
.connect-preview-hit--selected {
  box-shadow: inset 0 0 0 2px rgba(37, 99, 235, 0.95) !important;
}
/* Subtle blue hover ring — only on the deepest hovered block, not its ancestors */
.connect-preview-hit:not(.connect-preview-hit--root):not(.connect-preview-hit--selected):hover:not(:has(.connect-preview-hit:hover)) {
  box-shadow: inset 0 0 0 2px rgba(37, 99, 235, 0.38);
}
/* Root gets a muted gray ring so it doesn't compete with child blocks */
.connect-preview-hit--root:not(.connect-preview-hit--selected):hover:not(:has(.connect-preview-hit:hover)) {
  box-shadow: inset 0 0 0 2px rgba(100, 116, 139, 0.28);
}
`;

export function ConnectPreviewHitStyles() {
  return <style dangerouslySetInnerHTML={{ __html: css }} />;
}

function PreviewHit({
  selected,
  isRoot,
  onActivate,
  children,
}: {
  selected: boolean;
  isRoot?: boolean;
  onActivate: () => void;
  children: ReactNode;
}) {
  const cls = [
    "connect-preview-hit",
    isRoot ? "connect-preview-hit--root" : "",
    selected ? "connect-preview-hit--selected" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      role="button"
      tabIndex={0}
      className={cls}
      onClick={(e) => {
        e.stopPropagation();
        onActivate();
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          e.stopPropagation();
          onActivate();
        }
      }}
    >
      {children}
    </div>
  );
}

/**
 * Puck config clone where each component (and root) is wrapped so clicks select it in the connect modal.
 */
export function buildConnectPreviewConfig(
  base: Config,
  selectedId: string | null,
  onSelect: (id: string, type: string) => void
): Config {
  const comps = base.components as Record<
    string,
    { render?: (p: AnyProps) => ReactNode; [k: string]: unknown }
  >;
  const nextComponents = { ...comps };

  for (const typeKey of Object.keys(nextComponents)) {
    const comp = nextComponents[typeKey];
    if (!comp?.render) continue;
    const Original = comp.render;
    nextComponents[typeKey] = {
      ...comp,
      render: (props: AnyProps) => {
        const id = typeof props.id === "string" ? props.id : "?";
        return (
          <PreviewHit selected={selectedId === id} onActivate={() => onSelect(id, typeKey)}>
            <Original {...props} />
          </PreviewHit>
        );
      },
    };
  }

  const root = base.root as {
    render: (p: AnyProps) => ReactNode;
    [k: string]: unknown;
  };
  const OriginalRoot = root.render;

  return {
    ...base,
    components: nextComponents,
    root: {
      ...root,
      render: (props: AnyProps) => (
        <PreviewHit
          isRoot
          selected={selectedId === "root"}
          onActivate={() => onSelect("root", "root")}
        >
          <OriginalRoot {...props} />
        </PreviewHit>
      ),
    },
  } as Config;
}
