import { describe, it, expect, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { ChatMessage } from '../src/components/transcript/ChatMessage.js';
import type { ChatMessage as ChatMessageType, MessagePart } from '../src/types.js';

const assistant = (over: Partial<ChatMessageType> = {}): ChatMessageType => ({
  id: 'm1',
  role: 'assistant',
  content: '',
  ...over,
});

describe('ChatMessage', () => {
  it('renders a single newline as a line break, so "Q:/A:" pairs do not share a line', () => {
    const { container } = render(
      <ChatMessage message={assistant({ content: '**Q:** Free trial?\n**A:** Yes, 14 days.' })} />,
    );

    // Plain markdown would soft-wrap these into one line; remark-breaks makes it a <br>.
    expect(container.querySelectorAll('br')).toHaveLength(1);
    // Both halves still live in one paragraph — this is a break, not a new block.
    expect(container.querySelectorAll('p')).toHaveLength(1);
  });

  it('keeps a blank line as a separate paragraph', () => {
    const { container } = render(
      <ChatMessage message={assistant({ content: 'First point.\n\nSecond point.' })} />,
    );

    expect(container.querySelectorAll('p')).toHaveLength(2);
  });

  it('renders a markdown table as a table, not as literal pipes', () => {
    const table = [
      '| Plan | Price |',
      '| --- | --- |',
      '| Free | $0 |',
      '| Pro | $20 |',
    ].join('\n');
    const { container } = render(<ChatMessage message={assistant({ content: table })} />);

    expect(container.querySelectorAll('table')).toHaveLength(1);
    expect(container.querySelectorAll('th')).toHaveLength(2);
    expect(container.querySelectorAll('tbody tr')).toHaveLength(2);
    expect(screen.getByText('Pro')).toBeTruthy();
    expect(container.textContent).not.toContain('---');
  });

  it('keeps a table within the panel, with a scroll container as the escape hatch', () => {
    const { container } = render(
      <ChatMessage message={assistant({ content: '| a | b |\n| --- | --- |\n| 1 | 2 |' })} />,
    );

    const scroller = container.querySelector('table')?.parentElement;
    expect(scroller?.getAttribute('style')).toContain('overflow-x: auto');
    expect(scroller?.getAttribute('style')).toContain('max-width: 100%');
  });

  it('wraps prose inside a cell rather than clipping it to one line', () => {
    const prose = 'For organizations with advanced security and compliance requirements.';
    const { container } = render(
      <ChatMessage message={assistant({ content: `| Block | Content |\n| --- | --- |\n| ParagraphBlock | ${prose} |` })} />,
    );

    const cell = container.querySelectorAll('td')[1] as HTMLElement;
    expect(cell.textContent).toBe(prose);
    expect(cell.style.whiteSpace).not.toBe('nowrap');
    expect(cell.style.verticalAlign).toBe('top');
  });

  it('keeps per-column alignment from the delimiter row', () => {
    const { container } = render(
      <ChatMessage message={assistant({ content: '| L | R |\n| :--- | ---: |\n| 1 | 2 |' })} />,
    );

    const aligned = Array.from(container.querySelectorAll('td')).map(td => (td as HTMLElement).style.textAlign);
    expect(aligned).toEqual(['left', 'right']);
  });

  it('opens external links in a new tab and keeps same-page anchors in place', () => {
    const { container } = render(
      <ChatMessage message={assistant({ content: 'See https://example.com and a note[^1].\n\n[^1]: Billed yearly.' })} />,
    );

    const links = Array.from(container.querySelectorAll('a'));
    const external = links.filter(a => a.getAttribute('href')?.startsWith('http'));
    const anchors = links.filter(a => a.getAttribute('href')?.startsWith('#'));

    expect(external).toHaveLength(1);
    expect(external[0].getAttribute('target')).toBe('_blank');
    expect(external[0].getAttribute('rel')).toBe('noopener noreferrer');

    expect(anchors.length).toBeGreaterThan(0);
    for (const a of anchors) expect(a.getAttribute('target')).toBeNull();
  });

  // Alignment and the user bubble carry this visually, and neither reaches assistive tech.
  it('positions the turn so the speaker label cannot escape it', () => {
    render(<ChatMessage message={assistant({ content: 'Hello' })} />);

    const turn = screen.getByText('AI said').parentElement as HTMLElement;
    expect(turn.style.position).toBe('relative');
  });

  it('names the speaker for assistive tech without showing it', () => {
    render(<ChatMessage message={assistant({ content: 'Hello' })} />);
    // Clipped to nothing, not `display: none`, which would take it out of the tree too.
    // (`clip` itself is unobservable here — happy-dom drops the deprecated property.)
    const label = screen.getByText('AI said');
    expect(label.style.position).toBe('absolute');
    expect(label.style.width).toBe('1px');
    expect(label.style.overflow).toBe('hidden');

    cleanup();
    render(<ChatMessage message={{ id: 'u1', role: 'user', content: 'Hi' }} />);
    expect(screen.getByText('You said')).toBeTruthy();
  });

  // The turn produced no output, so the label is the only thing attributing it.
  it('names the speaker on a turn that ended before saying anything', () => {
    render(<ChatMessage message={assistant({ stopped: true })} />);

    expect(screen.getByText('AI said')).toBeTruthy();
    expect(screen.getByText('Stopped')).toBeTruthy();
  });

  const seeded = (page: { title: string; path: string }): ChatMessageType => ({
    id: 'u1',
    role: 'user',
    content: 'a blog post about caching',
    origin: { source: 'create-page', page },
  });

  // Without this a seeded brief is indistinguishable from something the user typed, having
  // appeared without them touching the composer.
  it('says a seeded turn asked for a new page, and where it will land', () => {
    render(<ChatMessage message={seeded({ title: 'Caching', path: 'blog/caching' })} />);

    // The title and path were collected in the dialog and appear nowhere else in the transcript.
    expect(screen.getByText('New page').parentElement?.textContent).toBe('New page · Caching');
    // Stored without a leading slash; shown as the path it is.
    expect(screen.getByText('/blog/caching')).toBeTruthy();
  });

  // Both rows are clipped to a single line, so a long title or a deep path is only partly
  // legible. Nothing may be reachable *only* by reading them.
  it('keeps the untruncated title and path on the caption', () => {
    const title = 'Q3 2026 enterprise pricing and packaging update';
    const path = 'resources/pricing/q3-2026-enterprise-pricing-and-packaging-update';
    render(<ChatMessage message={seeded({ title, path })} />);

    const caption = screen.getByText('New page').closest('[title]');
    expect(caption?.getAttribute('title')).toBe(`New page · ${title} · /${path}`);
  });

  it('leaves a typed turn unannotated', () => {
    render(<ChatMessage message={{ id: 'u1', role: 'user', content: 'change the heading' }} />);

    expect(screen.queryByText('New page')).toBeNull();
  });

  // A tint behind every reply reads as chrome at this width, and its padding costs the prose
  // ~24px of a ~300px column.
  it('bubbles the user turn only', () => {
    const { container: ai } = render(<ChatMessage message={assistant({ content: 'Hello' })} />);
    expect(screen.getByText('Hello')).toBeTruthy();
    expect(ai.querySelector('[style*="background-color"]')).toBeNull();

    const { container: user } = render(
      <ChatMessage message={{ id: 'u1', role: 'user', content: 'Hi there' }} />,
    );
    expect(user.querySelector('[style*="background-color"]')).toBeTruthy();
  });

  it('renders prose and steps in the order they happened', () => {
    const parts: MessagePart[] = [
      { type: 'text', id: 't1', text: 'Reading first.' },
      { type: 'tool', tool: { id: 'c1', name: 'get_document', status: 'done' } },
      { type: 'text', id: 't2', text: 'Now editing.' },
    ];
    const { container } = render(<ChatMessage message={assistant({ parts, content: 'ignored' })} />);

    const rendered = container.textContent ?? '';
    expect(rendered.indexOf('Reading first.')).toBeLessThan(rendered.indexOf('Read the page'));
    expect(rendered.indexOf('Read the page')).toBeLessThan(rendered.indexOf('Now editing.'));
  });

  it('puts the in-flight step at the bottom, below the prose so far', () => {
    const parts: MessagePart[] = [
      { type: 'tool', tool: { id: 'c1', name: 'get_document', status: 'done' } },
      { type: 'text', id: 't1', text: 'Found it.' },
      { type: 'tool', tool: { id: 'c2', name: 'apply_document_edits', status: 'running' } },
    ];
    const { container } = render(<ChatMessage message={assistant({ parts, isStreaming: true })} />);

    const rendered = container.textContent ?? '';
    expect(rendered.indexOf('Read the page')).toBeLessThan(rendered.indexOf('Found it.'));
    expect(rendered.indexOf('Found it.')).toBeLessThan(rendered.indexOf('Applying changes…'));
  });

  // The agent announces a whole batch of calls as the model streams them, before running
  // any of them. Rendering only the newest hid the rest until they finished.
  it('lists every step in flight, not just the newest', () => {
    const parts: MessagePart[] = [
      { type: 'tool', tool: { id: 'c1', name: 'get_document', status: 'running' } },
      { type: 'tool', tool: { id: 'c2', name: 'list_components', status: 'running' } },
    ];
    render(<ChatMessage message={assistant({ parts, isStreaming: true })} />);

    expect(screen.getByText('Reading the page…')).toBeTruthy();
    expect(screen.getByText('Checking available components…')).toBeTruthy();
  });

  it('shows a working indicator in the pause after a step finishes', () => {
    const parts: MessagePart[] = [{ type: 'tool', tool: { id: 'c1', name: 'get_document', status: 'done' } }];
    render(<ChatMessage message={assistant({ parts, isStreaming: true })} />);

    expect(screen.getByText('Thinking…')).toBeTruthy();
  });

  it('shows no indicator on a turn that has ended', () => {
    render(<ChatMessage message={assistant({ content: 'Done.' })} />);

    expect(screen.queryByText('Thinking…')).toBeNull();
  });

  it('renders the indicator as text rather than a focusable control', () => {
    render(<ChatMessage message={assistant({ isStreaming: true })} />);

    expect(screen.getByText('Thinking…')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('shows a turn-level error with its detail as wrapping text, not inside a pill', () => {
    render(<ChatMessage message={assistant({ content: 'partial', error: 'Connection lost' })} />);

    expect(screen.getByText('Something went wrong')).toBeTruthy();
    expect(screen.getByText('Connection lost')).toBeTruthy();
  });

  it('offers a retry on a failed turn only when one is available', () => {
    const failed = assistant({ content: 'partial', error: 'Connection lost' });
    const { queryByText } = render(<ChatMessage message={failed} />);
    expect(queryByText('Try again')).toBeNull();

    cleanup();
    const onRetry = vi.fn();
    render(<ChatMessage message={failed} onRetry={onRetry} />);
    fireEvent.click(screen.getByText('Try again'));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  // A stop is a user decision, so it gets none of the failure treatment.
  it('marks a stopped turn plainly, with no error styling', () => {
    render(<ChatMessage message={assistant({ content: 'Half a reply', stopped: true })} />);

    expect(screen.getByText('Stopped')).toBeTruthy();
    expect(screen.queryByText('Something went wrong')).toBeNull();
    expect(screen.getByText('Half a reply')).toBeTruthy();
  });
});
