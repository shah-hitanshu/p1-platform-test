import { attachmentsOf, pendingPageOf, selectedBlockOf } from '../conversation/context.js';
import type { Attachment, ChatContext, SelectedBlock } from '../types.js';
import { writableDocuments } from '../conversation/scope.js';
import { TEMPLATE_FILL_CONTRACT } from './system-prompt.js';

/**
 * Nothing else in the create flow can write the SEO description, so the agent does.
 *
 * Ordered after the content deliberately: written first it would describe a page that does not
 * exist yet, so a build that then fails leaves a confidently wrong description behind.
 */
const WRITE_META_DESCRIPTION = [
  'The SEO meta description is empty, so write one too.',
  'Build the content first, then, before completing the same edit session, set the',
  'description from what you actually built: a single sentence of roughly 150',
  'characters, as a "replace" operation on path "root.props.description".',
  'Leave "root.props.title" alone.',
  'Mentioning it in one short clause is fine. Do not explain what a meta description',
  'is or why it matters.',
];

/**
 * Names what the turn is pointed at, most specific first. A just-created page still carries a
 * `documentId`, so the order matters: reversed, it would be called an existing document directly
 * above a line saying it was created empty a moment ago.
 */
function contextHeader(context: ChatContext, hasPendingPage: boolean): string {
  if (hasPendingPage) return '[Current editor context — page still to create]';
  if (context.newPage) return '[Current editor context — new empty page]';
  if (context.documentId) return '[Current editor context — existing document]';
  return '[Current editor context]';
}

/**
 * The context block prepended to the user's message for the model only.
 *
 * Kept out of what gets persisted and displayed (see the `userContent` / `message` split
 * at the call site): these are instructions to the model, and showing them in the
 * transcript makes the user's own brief read as if they wrote our prompt.
 *
 * `followsTemplate` comes from the backend rather than the context, because the context is
 * assembled in the browser and this decides an instruction the agent is told to obey.
 */
function selectedBlockLines(selected: SelectedBlock | null): string[] {
  if (selected === null) return ['Selected block: none'];
  return [
    `Selected block: ${describe(selected)}`,
    `Its refs, for your tool calls only — never repeat these to the user: `
    + `${selected.path}, id ${selected.id}`,
  ];
}

function describe(selected: SelectedBlock): string {
  if (selected.preview === undefined) return selected.label;
  if (selected.itemCount !== undefined) {
    return `${selected.label}, ${String(selected.itemCount)} items, the first "${selected.preview}"`;
  }
  return `${selected.label} — "${selected.preview}"`;
}

/**
 * A fence the brief cannot contain, grown a quote at a time like a markdown code fence. A brief
 * holding `"""` would otherwise close the quotation early and have its remainder read as more of
 * our own context lines. Grown rather than escaped so the brief still reaches the model verbatim.
 */
function fenceFor(text: string): string {
  let fence = '"""';
  while (text.includes(fence)) fence += '"';
  return fence;
}

/**
 * The attached files, last in the block so a long brief cannot push the ids and the write set
 * out of sight. Fenced so a brief reads as the user's words rather than as more of ours.
 */
function attachmentLines(attachments: Attachment[], seesImages: boolean): string[] {
  if (attachments.length === 0) return [];
  const lines = ['', 'Files attached to this message:'];
  for (const attachment of attachments) {
    if (attachment.kind === 'image') {
      // Follows whether the image is really on the message. The image itself rides there as a
      // content part, so this only names it.
      lines.push(seesImages
        ? `Image "${attachment.filename}", attached to this message for you to look at`
        : `Image "${attachment.filename}" — the user attached it, but this model cannot be shown images, so you have not seen it. Say so plainly and ask them to describe it or paste the text, rather than guessing what it contains.`);
    } else {
      const fence = fenceFor(attachment.text);
      lines.push(`Document "${attachment.filename}":`, fence, attachment.text, fence);
    }
  }
  return lines;
}

export function buildContextNote(
  context: ChatContext,
  options?: { followsTemplate?: boolean; seesImages?: boolean },
): string {
  // Defaults to the answer that cannot mislead: a caller that says nothing gets a note that
  // makes no claim about an image having been seen.
  const seesImages = options?.seesImages ?? false;
  const attachments = attachmentsOf(context);
  const pendingPage = pendingPageOf(context);
  const lines: string[] = [contextHeader(context, pendingPage !== null)];
  if (context.siteId) lines.push(`Site ID: ${context.siteId}`);
  if (context.branchId) lines.push(`Branch ID: ${context.branchId}`);
  // The page the user is looking at is left out while one is pending: they asked for a new page,
  // and naming another document here reliably got it edited instead.
  if (context.documentPath && !pendingPage) lines.push(`Document: ${context.documentPath}`);
  // Per turn, not in the cached system prompt: the set grows as the user adds pages.
  if (context.siteId && !pendingPage) {
    const writable = writableDocuments(context);
    lines.push(`Pages you may edit: ${writable.length > 0 ? writable.join(', ') : 'none'}`);
  }

  // "none" rather than an omitted line, which read as "you were not told".
  if (!pendingPage) {
    lines.push(...selectedBlockLines(selectedBlockOf(context)));
  }

  if (pendingPage) {
    lines.push(
      `Page to create: ${pendingPage.path}`,
      ...(pendingPage.title ? [`Title: ${pendingPage.title}`] : []),
      'This page does not exist yet — the user asked for it from the Create Page dialog. Create it',
      'at that path once they have settled which template it starts from.',
      'Do not ask which page to use, and do not build this brief into some other page.',
      'If they ask for something else entirely, do that instead — this page can wait.',
      '',
      // Named as the one exception because otherwise the model reads a thin brief as an invitation
      // to interview, and asks four questions before writing anything.
      'The template is the only thing to ask about. Beyond that, make reasonable, conventional',
      'choices for a page of this kind and draft it rather than asking: the user refines it from',
      'here, so a first draft is more useful to them than a question.',
      '',
      pendingPage.title
        ? 'Pass the title above as root_props.title when you create the page.'
        : 'Pass a title drawn from the brief as root_props.title when you create the page.',
      ...WRITE_META_DESCRIPTION,
    );
    return [...lines, ...attachmentLines(attachments, seesImages)].join('\n');
  }

  if (context.newPage) {
    // Seeded from Create Page. The page exists but is empty, so the generic "already
    // exists" note below would be read as "there is something here to work around".
    // Stated as the situation plus the expected response, because without the second
    // half the model reliably opens with "which page would you like me to use?" on a
    // brief as thin as "I want a pricing page" (product decision: draft, don't ask).
    lines.push(
      'This page was just created for this request and is empty. Build it here now:',
      'do not create another page, and do not ask which page to use.',
      'If the brief is thin, make reasonable, conventional choices for a page of this',
      'kind and draft it immediately rather than asking clarifying questions. The user',
      'refines it from here, so a first draft is more useful to them than a question.',
      '',
      'The page title is already set.',
      ...WRITE_META_DESCRIPTION,
    );
  } else if (context.documentId) {
    lines.push('This document already exists. Use the edit workflow unless the user explicitly asks to create a new page.');
  }

  // For a page the user navigated to, which the context cannot tell us about. Without it the
  // first edit to a template page is spent discovering it has one: `apply_document_edits`
  // validates after applying and returns an error telling the agent to abort the session.
  //
  // Not added to the `newPage` branch, which would then call the same page both empty and
  // pre-filled. Only a client old enough to still send `newPage` can reach that branch, and it
  // only ever creates blank pages, so the combination does not occur.
  if (options?.followsTemplate === true && !context.newPage) {
    lines.push('This page follows a page template.', ...TEMPLATE_FILL_CONTRACT);
  }
  lines.push(...attachmentLines(attachments, seesImages));
  return lines.length > 1 ? lines.join('\n') : '';
}
