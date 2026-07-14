/** LaunchDarkly flag that gates the AI chatbot. Short-lived — removed once the
 *  chatbot ships to everyone in the alpha. */
export const CHATBOT_FLAG_KEY = "p1-chatbot";

/**
 * Whether the AI chatbot plugin should be mounted in the editor.
 *
 * Requires both the `p1-chatbot` LaunchDarkly flag to be enabled and an agent
 * URL to be configured. Defaults off when the flag is `undefined` (LD not yet
 * resolved, unset client ID, or offline), so the chatbot stays hidden by default.
 */
export function shouldShowChatbot(
  flagEnabled: boolean | undefined,
  agentUrl: string | undefined,
): boolean {
  return Boolean(flagEnabled && agentUrl);
}
