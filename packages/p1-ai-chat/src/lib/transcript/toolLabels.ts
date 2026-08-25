import type { ToolCallStatus } from '../../types.js';
import { isDevBuild } from '../devBuild.js';

/**
 * Everything the panel displays about an agent tool call: what it is called in plain language,
 * and what its result amounts to.
 *
 * Arguments and results come from the model and the backend, so every field read here is
 * untrusted — an unknown shape falls back to the plain label.
 */

/**
 * What a call amounts to on screen. `partial` is not a shade of `failed`: a tool that did some
 * of the job must not be reported as having done none. `abandoned` isn't either — the result
 * never came back, but the call may well have succeeded. Nor is `denied`: the answer is that the
 * caller may not do this, which is not the tool having failed.
 */
export type ToolCallOutcome = 'running' | 'done' | 'partial' | 'failed' | 'denied' | 'abandoned';

interface LabelSpec {
  /** Shown while the call is in flight. */
  running: string;
  /** Shown once the call has returned. */
  done: string;
  /**
   * Shown when the call came back reporting a failure. Spelled out per tool rather
   * than derived from `done`, because the past tense states the action *happened* —
   * a red badge reading "Applied changes" tells the user the opposite of the truth.
   */
  failed: string;
  /** A result meaning this tool did part of the job, and what to call that. Paired so a tool
   *  cannot declare the test without the phrasing. */
  partial?: { when: (result: Record<string, unknown>) => boolean; label: string };
  /** A result meaning *this* tool failed without throwing; {@link isCommonFailure} applies too. */
  isFailure?: (result: Record<string, unknown>) => boolean;
  /** A result carrying this tool's own way of saying the caller may not do this. */
  isDenial?: (result: Record<string, unknown>) => boolean;
  /**
   * What to call a refusal, for a tool whose {@link failed} text would misdescribe one. Falls
   * back to `failed`, which for an action tool states the truth: the action did not happen.
   */
  denied?: string;
  /** Optional trailing detail, e.g. a page path or a count. */
  detail?: (input: Record<string, unknown>, result: unknown) => string | undefined;
}

/**
 * Cap on a displayed note. Generous, because it renders as wrapping body text rather than
 * inside a badge — this only guards against a runaway payload (a stack trace or serialized
 * blob) swamping the transcript.
 */
const MAX_NOTE_LENGTH = 200;

/**
 * The one-line explanation attached to a call that failed or half-succeeded. Kept out of
 * {@link toolCallLabel} so the caller can render it where it wraps.
 */
export function toolCallNote(call: ToolCallStatus): string | undefined {
  const result = call.result;
  if (result === null || typeof result !== 'object') return undefined;
  const r = result as Record<string, unknown>;
  const raw = readString(r, 'error') ?? readString(r, 'message') ?? readString(r, 'warning');
  if (raw === undefined) return undefined;
  // Collapse whitespace: backend errors often span lines.
  const collapsed = raw.replace(/\s+/g, ' ').trim();
  if (collapsed === '') return undefined;
  return collapsed.length > MAX_NOTE_LENGTH
    ? `${collapsed.slice(0, MAX_NOTE_LENGTH - 1)}…`
    : collapsed;
}

/** Read a string field, ignoring empty and non-string values. */
function readString(source: Record<string, unknown>, key: string): string | undefined {
  const v = source[key];
  return typeof v === 'string' && v.trim() !== '' ? v : undefined;
}

/** Format a document path for display — drop the leading slash, fall back to "home". */
function displayPath(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const trimmed = raw.replace(/^\/+/, '');
  return trimmed === '' ? 'home' : trimmed;
}

function pagePath(input: Record<string, unknown>): string | undefined {
  return displayPath(readString(input, 'document_path') ?? readString(input, 'path'));
}

/**
 * The path a create actually landed on, which is not always the one asked for: a page built from
 * a template is placed under the template's route shape.
 */
function createdPath(result: unknown): string | undefined {
  if (result === null || typeof result !== 'object') return undefined;
  return displayPath(readString(result as Record<string, unknown>, 'documentPath'));
}

/** Pluralize a count, e.g. `pluralizeString(3, 'edit')` -> "3 edits". */
function pluralizeString(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? '' : 's'}`;
}

/** Number of operations in an apply_document_edits call, from either side of the exchange. */
function editCount(input: Record<string, unknown>, result: unknown): number | undefined {
  const ops = input.operations;
  if (Array.isArray(ops)) return ops.length;
  if (result !== null && typeof result === 'object') {
    const applied = (result as Record<string, unknown>).operationsApplied;
    if (typeof applied === 'number') return applied;
  }
  return undefined;
}

const LABELS: Record<string, LabelSpec> = {
  list_documents: {
    running: 'Looking at the pages on this site',
    done: 'Checked the pages on this site',
    failed: "Couldn't check the pages on this site",
    detail: (_input, result) => {
      const docs = result !== null && typeof result === 'object'
        ? (result as Record<string, unknown>).documents
        : undefined;
      return Array.isArray(docs) ? pluralizeString(docs.length, 'page') : undefined;
    },
  },
  get_document: {
    running: 'Reading the page',
    done: 'Read the page',
    failed: "Couldn't read the page",
    detail: input => pagePath(input),
  },
  list_components: {
    running: 'Checking available components',
    done: 'Checked available components',
    failed: "Couldn't check available components",
  },
  list_page_templates: {
    running: 'Looking for a page template',
    done: 'Checked the page templates',
    failed: "Couldn't check the page templates",
    // "none" is the useful case: it is why the reply that follows offers a blank page.
    detail: (_input, result) =>
      Array.isArray(result)
        ? (result.length === 0 ? 'none available' : pluralizeString(result.length, 'template'))
        : undefined,
  },
  check_edit_permission: {
    running: 'Checking edit permission',
    done: 'Confirmed edit permission',
    failed: "Couldn't check edit permission",
    // The one tool whose action *is* the checking, so "couldn't check" would deny an answer it
    // has. Two refusals reach here: the CCR response { canEdit: false, reason }, which carries
    // no `error` and no `success: false` for anything generic to catch, and the write-set refusal.
    denied: "Can't edit this page",
    isDenial: r => r.canEdit === false,
  },
  start_edit_session: {
    running: 'Reserving the page for editing',
    done: 'Reserved the page for editing',
    failed: "Couldn't reserve the page for editing",
  },
  apply_document_edits: {
    running: 'Applying changes',
    done: 'Applied changes',
    failed: "Couldn't apply changes",
    detail: (input, result) => {
      const n = editCount(input, result);
      return n === undefined ? undefined : pluralizeString(n, 'edit');
    },
  },
  complete_edit_session: {
    running: 'Saving changes',
    done: 'Saved changes',
    failed: "Couldn't save changes",
  },
  abort_edit_session: {
    running: 'Discarding changes',
    done: 'Discarded changes',
    failed: "Couldn't discard changes",
  },
  create_page: {
    running: 'Creating the page',
    done: 'Created the page',
    failed: "Couldn't create the page",
    // The page exists but its components were not populated. Reporting that as a failure
    // told the user the page had not been created, which it had.
    partial: { when: r => r.warning !== undefined, label: 'Created the page, without its components' },
    // document_path is required by the schema, so the fallback is effectively always present.
    detail: (input, result) => createdPath(result) ?? pagePath(input),
  },
  list_media: {
    running: 'Browsing the media library',
    done: 'Browsed the media library',
    failed: "Couldn't browse the media library",
    detail: input => {
      const search = readString(input, 'search');
      return search ? `matching "${search}"` : undefined;
    },
  },
  fetch_page: {
    running: 'Fetching the page',
    done: 'Fetched the page',
    failed: "Couldn't fetch the page",
    detail: input => {
      const url = readString(input, 'url');
      if (!url) return undefined;
      // Show just the host — a full URL overflows the narrow sidebar.
      try {
        return new URL(url).hostname;
      } catch {
        return undefined;
      }
    },
  },
  get_branch_presence: {
    running: 'Checking who else is editing',
    done: 'Checked who else is editing',
    failed: "Couldn't check who else is editing",
  },
  get_document_presence: {
    running: 'Checking who else is on this page',
    done: 'Checked who else is on this page',
    failed: "Couldn't check who else is on this page",
  },
};

/**
 * Failure conventions general enough to apply to every tool. Narrowing these to the tools
 * known to use them today would leave any other soft-failing tool undetected.
 */
function isCommonFailure(result: Record<string, unknown>): boolean {
  return result.error !== undefined || result.success === false;
}

/** Named as a state rather than re-derived per use, so the panel and the labels can't disagree. */
export function toolCallOutcome(call: ToolCallStatus): ToolCallOutcome {
  if (call.status === 'running') return 'running';
  if (call.status === 'abandoned') return 'abandoned';
  if (call.status === 'error') return 'failed';
  if (call.result === null || typeof call.result !== 'object') return 'done';

  const result = call.result as Record<string, unknown>;
  const spec = LABELS[call.name];
  // Ahead of the failure tests, which a refusal would otherwise answer first: the Worker records
  // it as an `error` as well, since to the model it is one.
  if (result.denied === true || spec?.isDenial?.(result) === true) return 'denied';
  // A hard failure wins: a result carrying both an error and a warning did not half-succeed.
  if (isCommonFailure(result) || spec?.isFailure?.(result) === true) return 'failed';
  if (spec?.partial?.when(result) === true) return 'partial';
  return 'done';
}

/**
 * Build the row text for a tool call. Falls back to the raw tool name for anything not in the
 * map, so a newly-added agent tool degrades to today's behaviour rather than rendering blank.
 */
export function toolCallLabel(call: ToolCallStatus): string {
  const outcome = toolCallOutcome(call);
  const spec = LABELS[call.name];

  if (!spec) {
    warnUnmappedTool(call.name);
    return outcome === 'abandoned' ? `${call.name} — didn't finish` : call.name;
  }

  switch (outcome) {
    // No detail on either: "3 edits" describes what the call would have done, and reads as
    // a claim that it did.
    case 'failed':
      return spec.failed;
    case 'partial':
      return spec.partial?.label ?? spec.done;
    // The page it was refused for, never the tool's own detail: "· 3 edits" would describe work
    // this call did not do. Every deniable tool names its page in `document_path`.
    case 'denied':
      return withDetail(spec.denied ?? spec.failed, input => pagePath(input), call);
    // Present tense plus a note: the past tense would assert a completion we never observed.
    case 'abandoned':
      return `${spec.running} — didn't finish`;
    case 'running':
      return withDetail(spec.running, spec.detail, call);
    case 'done':
      return withDetail(spec.done, spec.detail, call);
  }
}

function withDetail(base: string, of: LabelSpec['detail'], call: ToolCallStatus): string {
  const input =
    call.input !== null && typeof call.input === 'object' ? (call.input as Record<string, unknown>) : {};

  let detail: string | undefined;
  try {
    detail = of?.(input, call.result);
  } catch {
    // A malformed argument payload must never break the transcript.
    detail = undefined;
  }

  return detail ? `${base} · ${detail}` : base;
}

/** Tools already reported, so the warning fires once rather than on every render. */
const warnedTools = new Set<string>();

/**
 * A tool the agent has gained that this package has no phrasing for. Silent otherwise: the
 * plugin and the Worker version and deploy independently, so drift is the default.
 */
function warnUnmappedTool(name: string): void {
  if (!isDevBuild() || warnedTools.has(name)) return;
  warnedTools.add(name);
  // Passed as an argument, never interpolated: the name arrives over the wire.
  console.warn('[p1-ai-chat] No display label for agent tool:', name);
}
