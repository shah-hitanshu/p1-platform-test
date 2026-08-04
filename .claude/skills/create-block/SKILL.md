---
name: create-block
description: >-
  Author a new Puck block for the p1-starter editor. Use when adding, editing,
  or reviewing a block component in apps/p1-starter/components/puck/ — covers the
  block object shape, the shared richtextField / inlineTextField / createRichtextField
  factories, blockPaddingClass, the Connectable HOC for datasource-driven blocks,
  ai.instructions, and the required "use client" directive.
---

# Authoring Puck blocks

This is the canonical, baseline recipe for authoring blocks in the p1-starter
Puck editor. A "block" is a Puck component: a plain object describing its editor
fields, default content, and how it renders. Blocks live in
`apps/p1-starter/components/puck/` and are registered in
`apps/p1-starter/puck.config.tsx`.

Follow these rules for every new block. When in doubt, read
`apps/p1-starter/components/puck/paragraph-block.tsx` — it is the reference
implementation for richtext-driven blocks.

## 1. Block structure

A block is a **plain object** (not a class, not a React component) with four
keys: `label`, `fields`, `defaultProps`, and `render`.

```tsx
export const myBlock = {
  label: "My Block",              // shown in the editor's component list
  fields: {
    /* one entry per editable prop */
  },
  defaultProps: {
    /* an initial value for every field */
  },
  render: ({ /* props */ }) => {
    /* return JSX */
  },
};
```

Rules:

- Export the block as a named `const` in `camelCase` (e.g. `paragraphBlock`).
- Give **every** field a matching entry in `defaultProps`. A field without a
  default renders empty on insert and looks broken.
- `render` receives the field values as props. Type them as **optional**
  (`text?: string`) — Puck may hand you `undefined` before defaults resolve, and
  guarding against it keeps render pure.
- Keep `render` a pure function of its props. If it needs client hooks or heavy
  markup, extract it to a sibling `*-render.tsx` component (see
  `welcome-block.tsx` → `welcome-block-render.tsx`).
- Register the block in `puck.config.tsx`: add it to `components` under a
  PascalCase key (`MyBlock: myBlock`) and list that key under the appropriate
  `categories` entry.

## 2. richtextField — multi-line formatted text

Use `richtextField` for any prose field where the author should be able to type
directly on the canvas and apply **bold / italic / underline / bulleted /
numbered lists**. This is the default choice for body copy.

Import from the shared subpath — never redefine it per block:

```tsx
import { richtextField } from "@pantheon-systems/puck-css/fields";
```

It is a ready-to-use field object: `type: "richtext"`, `contentEditable: true`,
a default formatting menu, and baked-in AI instructions. Drop it straight into
`fields`:

```tsx
fields: {
  text: richtextField,
},
```

### contentEditable

`richtextField` sets `contentEditable: true`, which makes the field editable
**inline on the canvas** rather than only in the right-hand sidebar. The author
clicks the rendered text and types. For this to feel right, your `render` must
output the value in a way the editor can map back to the field (see below).

### Rendering richtext output with dangerouslySetInnerHTML

A richtext field stores **HTML** (not markdown, not plain text). At render time
Puck may hand you either a React element (while editing) or an HTML string
(when persisted). Handle both, exactly as `paragraph-block.tsx` does:

```tsx
import { type ReactNode, isValidElement } from "react";
import { richtextField } from "@pantheon-systems/puck-css/fields";
import { blockPaddingClass } from "./block-padding";
import { sanitizeRichtextHtml } from "./sanitize-richtext";

render: ({ text }: { text?: string | ReactNode }) => {
  if (isValidElement(text)) {
    return <div className={blockPaddingClass}>{text}</div>;
  }
  return (
    <div
      className={`${blockPaddingClass} prose max-w-prose`}
      dangerouslySetInnerHTML={{
        __html: typeof text === "string" ? sanitizeRichtextHtml(text) : "",
      }}
    />
  );
},
```

- Check `isValidElement(text)` first and render the element directly — this is
  the live-editing path.
- Otherwise treat it as an HTML string and use `dangerouslySetInnerHTML`. Always
  guard with `typeof text === "string" ? … : ""` so `undefined` never reaches
  the DOM.
- **Always sanitize richtext HTML at the render boundary** with
  `sanitizeRichtextHtml` before handing it to `dangerouslySetInnerHTML`. Why it
  matters: this is editor-authored content rendered on the public, server-side
  surface. It is *currently* schema-constrained — the richtext editor registers
  no `<script>`/`<img>`/raw-HTML nodes, and the enabled `link` extension enforces
  a protocol allowlist that rejects `javascript:`/`data:` hrefs — but that is an
  upstream TipTap default, not something this repo enforces or tests. Sanitizing
  at render is defense-in-depth that stays correct even if the editor schema, a
  TipTap upgrade, or the AI-write path later changes. Do **not** feed any HTML
  string to `dangerouslySetInnerHTML` unsanitized — see also the link-safety
  checks in `list-block.tsx` and `connectable.tsx`.
- Add the `prose max-w-prose` classes so formatted HTML (lists, emphasis) gets
  sensible typography.

## 3. inlineTextField — short single-line text

Use `inlineTextField` for a **single line** of unformatted text that the author
should still be able to edit inline on the canvas (e.g. a short label or
eyebrow) — when a full richtext menu would be overkill.

```tsx
import { inlineTextField } from "@pantheon-systems/puck-css/fields";

fields: {
  label: inlineTextField,
},
```

It is `type: "text"`, `contentEditable: true`, with AI instructions asking for
concise plain text (no markdown/HTML). Its value is a plain string — render it
directly (`{label}`), no `dangerouslySetInnerHTML`.

For text that only needs sidebar editing (no inline canvas editing) a plain
`{ type: "text" as const, label: "…" }` field is fine — see `heading-block.tsx`.
Reach for `inlineTextField` specifically when you want inline editing.

## 4. createRichtextField — overriding defaults

When a block needs richtext but must tweak a default — a custom formatting menu,
different AI instructions, etc. — use `createRichtextField(overrides)` instead of
hand-rolling a field object. It merges your overrides over the shared defaults and
**deep-merges the nested `ai` and `options` objects**, so overriding a single nested
key keeps the rest of the defaults. For example,
`createRichtextField({ ai: { exclude: true } })` sets `ai.exclude` while retaining the
default `ai.instructions` — you don't have to respecify the fields you aren't changing:

```tsx
import { createRichtextField } from "@pantheon-systems/puck-css/fields";

fields: {
  body: createRichtextField({
    ai: {
      instructions: "Write a punchy one-paragraph product summary.",
    },
  }),
},
```

Only override what genuinely differs. If you find yourself re-specifying the
defaults, use plain `richtextField` instead.

## 5. blockPaddingClass — consistent spacing

**Every** block's outermost rendered element must carry the shared padding class
so blocks line up on the page:

```tsx
import { blockPaddingClass } from "./block-padding";
```

`blockPaddingClass` is `"px-16 py-6"` (horizontal 64px / vertical 24px). Apply it
to your root element — either alone (`className={blockPaddingClass}`) or combined
with block-specific classes:

```tsx
<div className={`${blockPaddingClass} prose max-w-prose`}>…</div>
```

Do not hard-code your own padding — import and use `blockPaddingClass` so a
single change re-spaces all blocks.

## 6. Connectable HOC — datasource-driven blocks

When a block renders a **list of items pulled from a datasource** (a
`{{ datasource.items }}` reference) rather than statically authored content, wrap
its render component with the `Connectable` HOC. It resolves the raw items,
slices them to `[min, max]`, and interpolates `{{ item.field }}` / `{{ index }}`
title and URL templates into safe `ConnectedItem`s. See `grid-block.tsx` for the
full pattern.

```tsx
import { Connectable, type ConnectedItem } from "@pantheon-systems/puck-css/connectable";

function CardGrid({ title, items }: { title?: string; items: ConnectedItem[] }) {
  return (
    <section className={blockPaddingClass}>
      {items.map((item, i) => (
        <div key={`${item.id}-${i}`}>{item._title}</div>
      ))}
    </section>
  );
}

const ConnectableCardGrid = Connectable(CardGrid);

export const gridBlock = {
  label: "Card Grid",
  fields: {
    title: { type: "text" as const, label: "Heading" },
    items: { type: "textarea" as const, label: "Items datasource (e.g. {{ swapi_list.items }})" },
    min: { type: "number" as const, label: "Min cards" },
    max: { type: "number" as const, label: "Max cards" },
    itemTitleTemplate: { type: "text" as const, label: "Item title template" },
    itemUrlTemplate: { type: "text" as const, label: "Optional item URL template" },
  },
  defaultProps: {
    title: "Cards",
    items: "{{ swapi_list.items }}",
    min: 1,
    max: 12,
    itemTitleTemplate: "{{ item.name }}",
    itemUrlTemplate: "",
  },
  render: ConnectableCardGrid,
};
```

Rules:

- The wrapped base component must accept `items: ConnectedItem[]`. The HOC swaps
  the raw `items` prop for the resolved array.
- Expose the template/limit fields (`items`, `min`, `max`, `itemTitleTemplate`,
  `itemUrlTemplate`) so authors can point the block at a datasource and shape it.
- Read resolved values off each item via the `_`-prefixed keys: `_title`,
  `_href`, `_index`. Only render `_href` as a link — the HOC has already
  validated it is a safe relative or `http(s)` URL.
- Use `Connectable` **only** for data-driven blocks. Statically authored blocks
  (paragraph, heading, quote) do not need it.

## 7. ai.instructions — guiding block-level AI generation

Fields can carry an `ai` hint object (`{ instructions?, exclude?, required?,
stream? }`). `ai.instructions` is a natural-language prompt the AI generation
feature uses when it fills or rewrites that field. Good instructions keep
AI-generated content on-brand and prevent the model from doing the wrong thing
(e.g. emitting headings inside a paragraph).

The shared fields already ship with sensible defaults:

- `richtextField` → "Generate well-structured prose. Use bold or lists sparingly
  … Do not include heading tags — use the Heading block for headings."
- `inlineTextField` → "Generate concise, plain text. No markdown or HTML."

Customize when a block's field has domain-specific expectations, using
`createRichtextField` (or by setting `ai` on a plain field object):

```tsx
fields: {
  summary: createRichtextField({
    ai: { instructions: "One paragraph, plain and factual. No lists." },
  }),
}
```

Write instructions as if briefing a copywriter: say what to produce and what to
avoid. They matter because they are the only steering the AI gets for that field.

## 8. TypeScript — `as const` on field type discriminants

Puck's `Config` type discriminates fields on their literal `type` value. A bare
string widens to `string` and breaks the union, so **every inline field object
must pin its `type` (and any other literal, like `value` or `level`) with
`as const`:**

```tsx
fields: {
  level: {
    type: "select" as const,
    label: "Level",
    options: [
      { label: "H1", value: "h1" },
      { label: "H2", value: "h2" },
    ],
  },
},
defaultProps: {
  level: "h1" as const,
},
```

The shared field factories (`richtextField`, `inlineTextField`,
`createRichtextField`) are already correctly typed — you don't add `as const`
when you use them, only on inline field objects you write yourself.

## 9. "use client" directive

Any block file that imports the shared field factories, uses React hooks, or
otherwise touches client-only APIs must start with the `"use client"` directive
as the **very first line**, before any imports:

```tsx
"use client";
import { type ReactNode, isValidElement } from "react";
import { richtextField } from "@pantheon-systems/puck-css/fields";
```

`richtextField`/`inlineTextField` come from a `"use client"` module, so a block
that uses them must be a client component too. When unsure, add it — the p1
editor blocks are client components. Purely static, import-only blocks
(e.g. `divider-block.tsx`) may omit it, but adding `"use client"` is always safe.

## Checklist for a new block

- [ ] `"use client"` at the top (required if it uses the shared fields).
- [ ] Named `const` export in camelCase with `label`, `fields`, `defaultProps`,
      `render`.
- [ ] Prose/body fields use `richtextField`; short inline text uses
      `inlineTextField`; overrides go through `createRichtextField`.
- [ ] richtext render handles both `isValidElement` and the HTML-string path with
      guarded `dangerouslySetInnerHTML`, and sanitizes the HTML via
      `sanitizeRichtextHtml` at the render boundary.
- [ ] Root element carries `blockPaddingClass`.
- [ ] Every field has a `defaultProps` entry.
- [ ] Inline field objects pin literals with `as const`.
- [ ] Data-driven lists wrap render in `Connectable` and consume
      `ConnectedItem[]` (`_title` / `_href` / `_index`).
- [ ] `ai.instructions` reviewed/customized where the field is domain-specific.
- [ ] Registered in `puck.config.tsx` under `components` + a `categories` entry.
- [ ] `pnpm lint` clean and `pnpm build` clean before you call it done.
