import React, { useState } from 'react';
import { Icon, Spinner } from '@pantheon-systems/pds-toolkit-react';
import type { ToolCallStatus } from '../../types.js';
import { toolCallLabel, toolCallOutcome, toolCallNote } from '../../lib/transcript/toolLabels.js';

interface Props {
  /** One run of consecutive tool calls from a single turn. */
  tools: ToolCallStatus[];
}

/**
 * A run of the agent's tool calls, every step visible. Only the raw backend text behind a
 * failed or partial step is hidden (see {@link ToolRow}); the list itself is not collapsible.
 */
export function ToolGroup({ tools }: Props): React.ReactElement | null {
  if (tools.length === 0) return null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, width: '100%', minWidth: 0, margin: '2px 0' }}>
      {tools.map((tool, i) => <ToolStep key={tool.id ?? i} tool={tool} />)}
    </div>
  );
}

/** One step of the run: in flight, or finished and reporting how it went. */
function ToolStep({ tool }: { tool: ToolCallStatus }): React.ReactElement {
  return toolCallOutcome(tool) === 'running' ? <ToolStatusLine tool={tool} /> : <ToolRow tool={tool} />;
}

/**
 * A step still running. Not a live region: the panel owns the only polite region and
 * announces this same step.
 */
export function ToolStatusLine({ tool }: { tool: ToolCallStatus }): React.ReactElement {
  return (
    <div style={{ ...ROW, alignItems: 'center' }}>
      <StepSpinner />
      <span style={{ overflowWrap: 'anywhere' }}>{toolCallLabel(tool)}…</span>
    </div>
  );
}

/**
 * The agent is working with nothing to show for it yet. A plain row rather than PDS's
 * `UtilityButton`, which renders a `<button aria-disabled>` — a focus stop that does nothing.
 */
export function ThinkingLine(): React.ReactElement {
  return (
    <div style={{ ...ROW, alignItems: 'center' }}>
      <StepSpinner />
      <span>Thinking…</span>
    </div>
  );
}

/**
 * PDS's `Icon` is static — the animation belongs to `Spinner` — and `isInline` makes it
 * `aria-hidden`, keeping the panel's status line the single announcer.
 */
function StepSpinner(): React.ReactElement {
  return <Spinner size="s" isInline style={SPINNER_SIZE} />;
}

/**
 * One finished call. Only an outright failure takes colour and weight; a partial or abandoned
 * step reads as ordinary and says so in its label.
 *
 * The row is itself the disclosure for any note, and the label stays visible either way, since
 * a collapsed panel isn't announced to assistive tech.
 */
function ToolRow({ tool }: { tool: ToolCallStatus }): React.ReactElement {
  const [showDetail, setShowDetail] = useState(false);
  const outcome = toolCallOutcome(tool);
  const note = outcome === 'failed' || outcome === 'partial' ? toolCallNote(tool) : undefined;
  const emphasis = outcome === 'failed' ? { color: CRITICAL, fontWeight: 600 } : undefined;

  const label = (
    <>
      <Icon
        iconName={outcome === 'done' ? 'circleCheck' : 'circleExclamation'}
        size="s"
        style={ROW_ICON}
      />
      <span style={{ overflowWrap: 'anywhere', flex: 1 }}>{toolCallLabel(tool)}</span>
      {note && <Icon iconName={showDetail ? 'caretDown' : 'caretRight'} size="s" style={ROW_ICON} />}
    </>
  );

  // Nothing to disclose — render as a plain row rather than a control that does nothing.
  if (!note) {
    return <div style={{ ...ROW, ...emphasis }}>{label}</div>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, maxWidth: '100%', minWidth: 0 }}>
      <button
        type="button"
        data-testid="tool-note-toggle"
        onClick={() => setShowDetail(v => !v)}
        aria-expanded={showDetail}
        style={{ ...QUIET_BUTTON, ...ROW, ...emphasis, width: '100%' }}
      >
        {label}
      </button>
      {/* The raw backend string is engineer-facing jargon running to several lines, so it
          stays behind the row rather than being the headline. Wrapped, never truncated:
          this is the text someone pastes into a bug report. */}
      {showDetail && (
        <div style={{ fontSize: 11, lineHeight: 1.45, color: MUTED, paddingLeft: 14, overflowWrap: 'anywhere' }}>
          {note}
        </div>
      )}
    </div>
  );
}

const MUTED = 'var(--pds-color-foreground-default-secondary)';
const CRITICAL = 'var(--pds-color-status-critical-foreground)';

/**
 * One line of the step list. Success and failure share it, so their icons and labels sit
 * on the same left edge and the run reads as a single sequence rather than mixed styles.
 */
const ROW = {
  display: 'flex',
  alignItems: 'flex-start',
  gap: 5,
  fontSize: 11,
  lineHeight: 1.5,
  color: MUTED,
  overflowWrap: 'anywhere',
  textAlign: 'left',
} as const;

const ICON_SIZE = { width: '0.625rem', height: '0.625rem' } as const;

/** `Spinner`'s smallest `size` is 12px; match the 10px icon column the rows align to. */
const SPINNER_SIZE = { ['--spinner-size']: '0.625rem' } as React.CSSProperties;

/** Row icons don't shrink, and sit on the first line's baseline rather than centred. */
const ROW_ICON = { ...ICON_SIZE, flex: 'none', marginTop: '0.28em' } as const;

/** A text-only control: reads as secondary label, not as a button competing with the UI. */
const QUIET_BUTTON = {
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  background: 'none',
  border: 'none',
  padding: 0,
  font: 'inherit',
  fontSize: 11,
  lineHeight: 1.5,
  cursor: 'pointer',
  textAlign: 'left',
} as const;
