import type { DraftRequestChannel } from "@pantheon-systems/p1-ai-chat";

/**
 * Build the Create Page modal's "Generate with AI" handler, or `undefined` when the
 * chatbot is disabled (which leaves the modal tile a placeholder).
 *
 * The page does not exist yet: the chat proposes the page template it should start from and
 * creates it once the user agrees, because a document's template can only be set as it is
 * created (PCC-3555). Until then the request carries the title and path the dialog collected.
 */
export function createGenerateWithAIHandler(
  draftRequests: DraftRequestChannel,
  enabled: boolean,
): ((brief: string, page: { path: string; title?: string }) => void) | undefined {
  if (!enabled) return undefined;
  return (brief, page) => {
    draftRequests.publish({
      kind: "create-page",
      brief: brief.trim(),
      page: { path: page.path, title: page.title?.trim() ?? "" },
    });
  };
}
