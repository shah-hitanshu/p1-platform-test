import type { DraftRequestChannel } from "@pantheon-systems/p1-ai-chat";

/**
 * Build the Create Page modal's "Generate with AI" handler, or `undefined` when the
 * chatbot is disabled (which leaves the modal tile a placeholder).
 *
 * `newPage` is set because the modal creates the page empty first, which tells the agent
 * to draft rather than ask what to put on it (confirmed with Chris on PCC-3440).
 *
 * The modal also passes the page title. Not forwarded: the create call already wrote it to
 * `root.props.title`, which the agent's prompt tells it to leave alone.
 */
export function createGenerateWithAIHandler(
  draftRequests: DraftRequestChannel,
  enabled: boolean,
): ((brief: string, page: { path: string }) => void) | undefined {
  if (!enabled) return undefined;
  return (brief, page) => {
    draftRequests.publish({
      brief: brief.trim(),
      documentPath: page.path,
      newPage: true,
    });
  };
}
