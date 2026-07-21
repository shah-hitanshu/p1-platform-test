# Implementation Plan: History Scoping + Tool Result Trimming

> **Status (historical):** Tool-result trimming is implemented; DO scoping is handled via the agent id the plugin sends. The code snippets below predate the migration to Cloudflare AI Gateway + Workers AI — the Worker no longer calls the Anthropic SDK directly (`anthropic.messages.create` / `Anthropic.*` types are illustrative only). See `README.md` for the current setup.

## Problems Being Solved

1. **Shared history**: All users share a single Durable Object (`agentId = 'default'`). Fix: scope the DO to `userId + siteId + branchId + documentPath`.

2. **History bloat**: `get_document` and `apply_document_edits` store full page JSON snapshots in every turn. Fix: trim tool results before storing in history while still sending full results to Claude in the current turn.

---

## Files to Change

| File | Change |
|---|---|
| `packages/plugin-ai-chat/src/types.ts` | Add `getAgentId` to `AIChatPluginOptions`; remove `puckData` from `ChatContext` |
| `packages/plugin-ai-chat/src/useAgentChat.ts` | Replace static `agentId` with lazy `getAgentId()` getter; stop sending `puckData` |
| `packages/plugin-ai-chat/src/ChatPanel.tsx` | Pass `options.getAgentId`; remove `puckData` from `getContext` |
| `workers/agent/src/history.ts` | Add `trimForHistory(toolName, result)` |
| `workers/agent/src/agent.ts` | Use parallel history arrays: full for Claude, trimmed for storage |
| `workers/agent/src/agent.test.ts` | Add tests for `trimForHistory` |
| `my-app/app/puck/[...puckPath]/EditorWithCSSApp.tsx` | Provide `getAgentId` from CSS user + env + branch |

---

## 1. `packages/plugin-ai-chat/src/types.ts`

### `ChatContext` — remove `puckData`

```typescript
export interface ChatContext {
  siteId: string;
  branchId: string;
  documentPath: string;
  token: string;
  // puckData removed — agent lazy-fetches document via get_document tool
}
```

### `AIChatPluginOptions` — add `getAgentId`

```typescript
export interface AIChatPluginOptions {
  agentUrl: string;
  /** Returns the Durable Object key — must be scoped to at least userId to prevent history leakage */
  getAgentId: () => string;
  getAuthToken: () => string;
  getSiteId: () => string;
  getBranchId: () => string;
  getDocumentPath: () => string;
}
```

---

## 2. `packages/plugin-ai-chat/src/useAgentChat.ts`

### `UseAgentChatOptions` — replace `agentId` with `getAgentId`

```typescript
export interface UseAgentChatOptions {
  agentUrl: string;
  getAgentId: () => string;   // replaces agentId?: string
  getContext: () => ChatContext;
}
```

### Function signature

```typescript
export function useAgentChat({ agentUrl, getAgentId, getContext }: UseAgentChatOptions)
```

### Remove the static `wsUrl` constant at the top of the hook

Delete the current line:
```typescript
const wsUrl = `${agentUrl.replace(/^http/, 'ws').replace(/\/$/, '')}/agents/chat-agent/${agentId}`;
```

### Inside `getOrCreateWs` — compute URL fresh per connection

Replace `const ws = new WebSocket(wsUrl)` with:
```typescript
const agentId = encodeURIComponent(getAgentId());
const wsUrl = `${agentUrl.replace(/^http/, 'ws').replace(/\/$/, '')}/agents/chat-agent/${agentId}`;
const ws = new WebSocket(wsUrl);
```

### `getOrCreateWs` dependency array

Change `[wsUrl]` to `[agentUrl, getAgentId]`.

### `submit` — stop sending `puckData`

`getContext()` no longer returns `puckData`, so no change needed in submit itself — just make sure `getContext` in `ChatPanel.tsx` no longer passes it.

---

## 3. `packages/plugin-ai-chat/src/ChatPanel.tsx`

### Pass `getAgentId` to `useAgentChat`

```typescript
const { messages, input, setInput, submit, isLoading, clearMessages } = useAgentChat({
  agentUrl: options.agentUrl,
  getAgentId: options.getAgentId,
  getContext: () => ({
    siteId: options.getSiteId(),
    branchId: options.getBranchId(),
    documentPath: options.getDocumentPath(),
    token: options.getAuthToken(),
    // puckData removed
  }),
});
```

---

## 4. `workers/agent/src/history.ts`

Add a new exported function. The full `sanitizeHistory` and `trimHistory` functions stay unchanged.

### `trimForHistory(toolName, result)`

Strips large snapshot fields before storing tool results in the DO. Claude still gets the full result in the current turn — only the stored version is trimmed.

```typescript
/**
 * Reduce a tool result to what's worth storing in long-term conversation history.
 * Claude receives the full result in the current turn; subsequent turns only need
 * a summary to understand what happened.
 */
export function trimForHistory(toolName: string, result: unknown): unknown {
  if (result === null || typeof result !== 'object') return result;
  const r = result as Record<string, unknown>;

  switch (toolName) {
    case 'get_document': {
      // Drop: patch (large diff string), metadata fields Claude doesn't need
      const { patch, source, createdById, createdByType, createdAt,
              isPublished, isTombstone, ...rest } = r;
      void patch; void source; void createdById; void createdByType;
      void createdAt; void isPublished; void isTombstone;
      // Also strip zones if empty
      const snapshot = rest.snapshot as Record<string, unknown> | undefined;
      if (snapshot && Array.isArray(snapshot.zones) && snapshot.zones.length === 0) {
        rest.snapshot = { ...snapshot, zones: undefined };
      }
      return rest;
    }

    case 'apply_document_edits':
      // Full snapshot is redundant — Claude just crafted these edits
      return {
        success: r.success,
        operationsApplied: r.operationsApplied,
      };

    case 'list_components': {
      // Keep component names and descriptions; drop verbose field schemas
      if (!Array.isArray(r.components)) return r;
      return {
        ...r,
        components: (r.components as Record<string, unknown>[]).map(c => ({
          name: c.name,
          description: c.description,
        })),
      };
    }

    // All other tools (check_edit_permission, start_edit_session,
    // complete_edit_session, abort_edit_session, etc.) are already small
    default:
      return result;
  }
}
```

---

## 5. `workers/agent/src/agent.ts`

### Import `trimForHistory`

```typescript
import { trimHistory, sanitizeHistory, trimForHistory } from './history.js';
```

### Parallel history arrays in the agentic loop

The core pattern: `history` is used for Claude API calls (full content), `historyForStorage` is what gets saved to the DO (trimmed content). Both are built in lockstep.

```typescript
const history = sanitizeHistory([...this.state.conversationHistory]);
const historyForStorage = [...history]; // starts as a copy

history.push({ role: 'user', content: message });
historyForStorage.push({ role: 'user', content: message });

// ...existing activeEditSession tracking...

try {
  let firstApiCall = true;
  while (true) {
    const apiMessages = firstApiCall && contextNote
      ? [...history.slice(0, -1), { role: 'user' as const, content: userContent }]
      : history;
    firstApiCall = false;

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 8192,
      system: SYSTEM_PROMPT,
      messages: apiMessages,
      tools: CSS_TOOLS,
    });

    assistantContent = response.content;

    for (const block of response.content) {
      if (block.type === 'text') {
        this.send(connection, { type: 'token', content: block.text });
      } else if (block.type === 'tool_use') {
        this.send(connection, { type: 'tool_start', toolName: block.name, toolInput: block.input });
      }
    }

    if (response.stop_reason !== 'tool_use') break;

    const toolResultsFull: Anthropic.ToolResultBlockParam[] = [];
    const toolResultsTrimmed: Anthropic.ToolResultBlockParam[] = [];

    for (const block of response.content) {
      if (block.type !== 'tool_use') continue;

      let result: unknown;
      let isError = false;
      try {
        result = await executeTool(block.name, block.input as Record<string, unknown>, cssApi, user.id);

        const input = block.input as Record<string, unknown>;
        if (block.name === 'start_edit_session' && !isError) {
          activeEditSession = {
            siteId: input.site_id as string,
            branchId: input.branch_id as string,
            documentPath: input.document_path as string,
            editSessionId: (result as { editSessionId: string }).editSessionId,
          };
        } else if (block.name === 'complete_edit_session' || block.name === 'abort_edit_session') {
          activeEditSession = null;
        }
      } catch (err) {
        result = { error: err instanceof Error ? err.message : String(err) };
        isError = true;
      }

      this.send(connection, { type: 'tool_end', toolName: block.name, toolResult: result });

      const base = {
        type: 'tool_result' as const,
        tool_use_id: block.id,
        ...(isError ? { is_error: true } : {}),
      };
      toolResultsFull.push({ ...base, content: JSON.stringify(result) });
      toolResultsTrimmed.push({ ...base, content: JSON.stringify(trimForHistory(block.name, result)) });
    }

    // Claude gets full results; storage gets trimmed results
    history.push({ role: 'assistant', content: assistantContent });
    history.push({ role: 'user', content: toolResultsFull });

    historyForStorage.push({ role: 'assistant', content: assistantContent });
    historyForStorage.push({ role: 'user', content: toolResultsTrimmed });
  }

  historyForStorage.push({ role: 'assistant', content: assistantContent });
  await this.setState({ conversationHistory: trimHistory(historyForStorage, 20) });

  this.send(connection, { type: 'done' });
} catch (err) {
  // ...existing error handling unchanged...
}
```

Note: the existing `history.push({ role: 'assistant', content: assistantContent })` line at the end of the try block is **replaced** by `historyForStorage.push(...)` — only the storage array gets the final assistant turn appended.

---

## 6. `workers/agent/src/agent.test.ts`

Add a `describe('trimForHistory')` block:

```typescript
import { trimHistory, sanitizeHistory, trimForHistory } from './history.js';

describe('trimForHistory', () => {
  it('strips patch and metadata from get_document results', () => {
    const result = {
      id: 'doc-1',
      versionNumber: 4,
      snapshot: { content: [{ type: 'HeroBlock', props: {} }], root: {}, zones: [] },
      patch: 'huge-json-string',
      source: 'realtime',
      createdById: 'user-1',
      createdByType: 'user',
      createdAt: '2026-01-01',
      isPublished: true,
      isTombstone: false,
    };
    const trimmed = trimForHistory('get_document', result) as Record<string, unknown>;
    expect(trimmed.patch).toBeUndefined();
    expect(trimmed.source).toBeUndefined();
    expect(trimmed.createdById).toBeUndefined();
    expect(trimmed.id).toBe('doc-1');
    expect(trimmed.snapshot).toBeDefined();
  });

  it('strips snapshot from apply_document_edits results', () => {
    const result = {
      success: true,
      operationsApplied: 3,
      snapshot: { content: [/* 12 huge components */] },
    };
    const trimmed = trimForHistory('apply_document_edits', result) as Record<string, unknown>;
    expect(trimmed.snapshot).toBeUndefined();
    expect(trimmed.success).toBe(true);
    expect(trimmed.operationsApplied).toBe(3);
  });

  it('strips field schemas from list_components results', () => {
    const result = {
      components: [
        { name: 'HeroBlock', description: 'A hero', fields: { /* verbose */ } },
        { name: 'FooterBlock', description: 'A footer', fields: { /* verbose */ } },
      ],
    };
    const trimmed = trimForHistory('list_components', result) as Record<string, unknown>;
    const components = trimmed.components as Record<string, unknown>[];
    expect(components[0].fields).toBeUndefined();
    expect(components[0].name).toBe('HeroBlock');
    expect(components[0].description).toBe('A hero');
  });

  it('passes through small tool results unchanged', () => {
    const result = { canEdit: true, conflictingRegions: [] };
    expect(trimForHistory('check_edit_permission', result)).toEqual(result);
  });

  it('passes through non-object results unchanged', () => {
    expect(trimForHistory('complete_edit_session', 'ok')).toBe('ok');
  });
});
```

---

## 7. `my-app/app/puck/[...puckPath]/EditorWithCSSApp.tsx`

### Get `user` from `useCSSAuth` in `EditorContent`

```typescript
const { authMode, token, user } = useCSSAuth();
```

### Add `userRef` alongside existing `tokenRef` and `branchIdRef`

```typescript
const tokenRef = useRef(token);
const branchIdRef = useRef('');
const userIdRef = useRef(user?.id ?? '');
tokenRef.current = token;
userIdRef.current = user?.id ?? '';
```

### Add `getAgentId` to `createAIChatPlugin`

The agentId format: `{userId}__{siteId}__{branchId}__{documentPath}` using `__` as separator (UUIDs use single hyphens; double underscore avoids collision). The document path may contain `/` — replace with `-`.

```typescript
const aiChatPlugin = useMemo(
  () =>
    createAIChatPlugin({
      agentUrl: process.env.NEXT_PUBLIC_AGENT_URL!,
      getAgentId: () => {
        const userId = userIdRef.current || 'anon';
        const siteId = process.env.NEXT_PUBLIC_CSS_SITE_ID ?? '';
        const branchId = branchIdRef.current;
        const docPath = documentPath.replace(/\//g, '-').replace(/^-/, '');
        return `${userId}__${siteId}__${branchId}__${docPath}`;
      },
      getAuthToken: () => tokenRef.current,
      getSiteId: () => process.env.NEXT_PUBLIC_CSS_SITE_ID ?? '',
      getBranchId: () => branchIdRef.current,
      getDocumentPath: () => documentPath,
    }),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [],
);
```

Note: `documentPath` is a stable prop (doesn't change mid-render), so `[]` deps remain correct.

---

## 8. Build, Pack, Deploy Sequence

```bash
# 1. Build plugin
npm run build -w packages/plugin-ai-chat

# 2. Run worker tests
npm test            # in workers/agent

# 3. Pack plugin
cd packages/plugin-ai-chat && npm pack

# 4. Copy tarball to my-app vendor
cp pantheon-p1-ai-chat-0.1.0.tgz /path/to/my-app/vendor/pantheon-p1-ai-chat-0.1.0.tgz
cp pantheon-p1-ai-chat-0.1.0.tgz /path/to/my-app/vendor/p1-plugin-ai-chat-0.1.0.tgz

# 5. Install in my-app
cd /path/to/my-app && pnpm install

# 6. Deploy worker
cd /path/to/p1-chatbot/workers/agent && npm run deploy:sbx1

# 7. Commit and push my-app
git add vendor/pantheon-p1-ai-chat-0.1.0.tgz vendor/p1-plugin-ai-chat-0.1.0.tgz pnpm-lock.yaml
git commit -m "chore: scope chat DO to user+page, trim tool result snapshots from history"
git push
```

---

## Key Invariants to Verify

- `history` (for Claude API calls) and `historyForStorage` (for DO state) are always pushed to in lockstep — every push to one must have a matching push to the other
- The final `historyForStorage.push({ role: 'assistant', ... })` after the loop only goes to the storage array, not `history` (matching existing behaviour)
- `trimForHistory` on an error result (`isError = true`) must still pass through — the trimming is shape-based, not success-based, so errors from non-snapshot tools are unaffected
- `getAgentId()` is called inside `getOrCreateWs` (lazy), not at hook init — so `branchIdRef.current` and `userIdRef.current` are read at connection time
- `encodeURIComponent(getAgentId())` wraps the whole string in the WebSocket URL to handle any unexpected characters in the document path
