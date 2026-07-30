import { createDraftRequestChannel, type DraftRequestChannel } from "@pantheon-systems/p1-ai-chat";

let channel: DraftRequestChannel | null = null;

/**
 * Module-level singleton, not component state: the publish and the consume happen either
 * side of a navigation that remounts the editor tree, so a per-mount ref would drop it.
 */
export function getDraftRequestChannel(): DraftRequestChannel {
  if (!channel) channel = createDraftRequestChannel();
  return channel;
}
