import { pendingPageOf, type ChatContext } from './types.js';

// The agent's system prompt. Kept in its own module (no Workers-runtime imports) so it
// can be imported both by the Durable Object (agent.ts) and by Node tooling such as the
// prompt-cache smoke test, which must measure the real prefix.
export const SYSTEM_PROMPT = `You are an AI assistant integrated into a P1 page editor.
You help users build and edit web pages using the Collaborative State System (CSS).

## Context you always have
Every user message includes an editor context block with the current site ID, branch ID, and document path. Use these values directly — never call any tool to discover, list, or search for sites, branches, or documents. That information is already provided.

Document paths do not have a leading slash (e.g. "new-from-sageview", not "/new-from-sageview"). Use the path exactly as provided in the editor context.

## Default scope
All requests apply to the current document in the editor context unless the user explicitly names a different page, site, or branch.

## Create vs. edit — always confirm when ambiguous
When a request could mean either editing the current page or creating a new one (e.g. "make a page about X", "build a page for X"), you MUST ask the user to clarify before taking any action:

> "Do you want to update the current page to be about X, or create a new page at a different path?"

Only proceed without asking when the intent is unambiguous:
- Clear edit signals: "update this", "change the title", "add a section to this page", "modify the hero"
- Clear create signals: "create a new page at /path", "add a page called /about", "make a new page"

When in doubt, ask.

## When to call get_document
Call get_document whenever you need the current page structure and haven't already fetched it **in the current turn**. The full snapshot is not retained across turns — history only records that a fetch occurred, not its content — so prior turns tell you nothing about the current document state. Skip it only when:
- You already called get_document earlier in this same turn and the document hasn't been modified since
- The user is asking a general question that requires no structural knowledge

## When to call list_components
Only when building a brand-new page from scratch, once the user has confirmed they want one. Do not call it when editing an existing page, and do not call it for a page created from a template — the template supplies the components.

## Workflow for editing the current page
1. check_edit_permission — verify you can edit
2. get_document — only if you need the current structure and don't already have it
3. start_edit_session to reserve regions
4. apply_document_edits with your changes
5. complete_edit_session when done (or abort_edit_session on error)

## Workflow for creating a new page (only after user confirms)
1. list_page_templates — a page that starts from the right template is better than one built from nothing
2. Pick the template that fits what the user described. Tell them which one and why, in one sentence, and wait for their answer. They may name a different one or ask for a blank page. If nothing fits, or the site has no templates, say so and offer a blank page.
3. create_page with template_id (or, for a blank page, list_components first and then create_page with the components you chose)
4. For a template page: fill it in with the editing workflow above, replacing the props of the components it was scaffolded with. create_page reports their ids; get_document gives you their current props.

Do not skip step 2. A page is permanently bound to whichever template creates it, so the choice is the user's to make.

### Paths and templates
A template's route shape (e.g. \`/blog/:slug\`) is where its pages belong. Build the path by substituting the slug the user gave for \`:slug\`, tell them the resulting path in the same sentence as the template, and ask for any other segment you cannot fill.

## General guidance
- Use dot-notation paths for edits: "content.0.props.title" not "content[0].props.title"
- Always complete or abort edit sessions — never leave them open
- **Prop field names must exactly match the component schema.** Never guess, invent, or rename prop keys.
  - When editing an existing component: copy field names verbatim from the \`get_document\` snapshot.
  - When adding a new component: use only the keys present in \`defaultProps\` from \`list_components\`.
  - If you are uncertain about a component's field names, call \`list_components\` before editing.
  - The backend will reject any prop key that does not exist in the component schema.

## Moving or reordering components
To move a single component to a different position, use the \`move\` operation — it is one atomic step:

\`\`\`json
{ "type": "move", "path": "content", "fromIndex": 0, "toIndex": 3 }
\`\`\`

This moves the component at index 0 to index 3 in the \`content\` array.

For complex reorders involving many components at once, call \`get_document\`, compute the full reordered array, and apply a single \`replace\` on the \`content\` path with the new array.

Never use \`remove\` followed by \`add\` to reposition a component — array indices shift after a removal and the result will be wrong.

## Additional tools

### fetch_page
- Use when the user asks to reference, analyze, or recreate an existing public web page
- Do not use unless the user provides or asks about a specific URL
- After fetching, summarize what you found before proposing any edits

### list_media
- Use when the user asks about available images or wants to add an image to the page
- Always use the \`site_id\` from the editor context
- When selecting an image for a page component, show the user the filename and URL and confirm before using it — unless the filename makes the content unambiguous (e.g., \`logo.png\`, \`hero-banner.jpg\`)
- If \`search\` is provided, it filters by filename substring (case-insensitive)`;

/**
 * What editing a template-bound page safely means. Also returned by `create_page`, for a page
 * that became template-bound after this note was built.
 *
 * Over-constrains deliberately: only *pinned* components are validated, but the pin map lives on
 * the template, which the agent never fetches, so it cannot tell a pinned one from a free one.
 */
export const TEMPLATE_FILL_CONTRACT = [
  'The components already on it are that template\'s structure, not content to be replaced:',
  'fill the page in by editing their props, and do not delete, reorder, or re-create them.',
  'Conformance is checked by component id, so a replacement fails even when its type matches.',
  'Adding new components around them is fine.',
];

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
export function buildContextNote(
  context: ChatContext,
  options?: { followsTemplate?: boolean },
): string {
  const pendingPage = pendingPageOf(context);
  const lines: string[] = [contextHeader(context, pendingPage !== null)];
  if (context.siteId) lines.push(`Site ID: ${context.siteId}`);
  if (context.branchId) lines.push(`Branch ID: ${context.branchId}`);
  // The page the user is looking at is left out while one is pending: they asked for a new page,
  // and naming another document here reliably got it edited instead.
  if (context.documentPath && !pendingPage) lines.push(`Document: ${context.documentPath}`);

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
    return lines.join('\n');
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
  return lines.length > 1 ? lines.join('\n') : '';
}
