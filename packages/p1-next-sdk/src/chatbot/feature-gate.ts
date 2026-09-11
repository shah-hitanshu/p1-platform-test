/** LaunchDarkly flag that gates the AI chatbot. Short-lived — removed once the chatbot
 *  ships to everyone in the alpha. Internal to this package: no application names it. */
export const CHATBOT_FLAG_KEY = "p1-chatbot";

/**
 * Whether the AI chatbot plugin should be mounted in the editor.
 *
 * Defaults off when the flag is `undefined` (LaunchDarkly not yet resolved, unset client
 * ID, or offline), so the chatbot stays hidden by default.
 */
export function shouldShowChatbot(flagEnabled: boolean | undefined): boolean {
  return Boolean(flagEnabled);
}
