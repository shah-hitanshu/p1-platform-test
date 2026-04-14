/**
 * CSS Feature Configuration
 *
 * Configuration-driven feature enablement for the CSS Puck integration.
 * Features can be toggled via config flags instead of manual code wiring.
 */

/**
 * Feature flags for CSS Puck integration UI features.
 *
 * These flags control which UI panels and behaviors are enabled.
 * They extend the existing CSSPuckConfig props (enableRealtime,
 * presenceEnabled, agentModeEnabled) with flags for UI-specific features.
 */
export interface CSSFeatureConfig {
  // =========================================================================
  // Existing CSSPuckConfig props (already supported by CSSPuckProvider)
  // =========================================================================

  /** Enable real-time collaborative editing */
  enableRealtime?: boolean;
  /** Enable presence tracking */
  presenceEnabled?: boolean;
  /** Enable agent mode features */
  agentModeEnabled?: boolean;

  // =========================================================================
  // UI Feature Flags
  // =========================================================================

  /** Show document list in plugin panel (default: true) */
  enableDocumentBrowser?: boolean;
  /** Show branch selector in plugin panel (default: true) */
  enableBranchSelector?: boolean;
  /** Show version list in plugin panel (default: true) */
  enableVersionHistory?: boolean;
  /** Show merge controls in plugin panel (default: false) */
  enableMergeControl?: boolean;
  /** Enable auto-save indicator (default: true) */
  enableAutoSave?: boolean;
  /** Show publish/checkpoint button (default: true) */
  enablePublishButton?: boolean;
  /** Show collaborator avatars in header (default: follows presenceEnabled) */
  enableCollaboratorAvatars?: boolean;
  /** Show agent activity banner (default: follows agentModeEnabled) */
  enableAgentBanner?: boolean;
  /** Enable focus region highlighting (default: follows presenceEnabled) */
  enableFocusHighlighting?: boolean;
}

/**
 * Preset configurations for common setups.
 */
export const CSS_PRESETS: Record<'basic' | 'collaborative' | 'full', CSSFeatureConfig> = {
  /**
   * Basic preset: auto-save and publish only.
   * Suitable for single-user editing without collaboration.
   */
  basic: {
    enableAutoSave: true,
    enablePublishButton: true,
  },

  /**
   * Collaborative preset: adds real-time editing, presence, and focus highlighting.
   * Suitable for multi-user editing scenarios.
   */
  collaborative: {
    enableRealtime: true,
    presenceEnabled: true,
    enableAutoSave: true,
    enablePublishButton: true,
    enableCollaboratorAvatars: true,
    enableFocusHighlighting: true,
  },

  /**
   * Full preset: all features enabled.
   * Suitable for power-user or admin scenarios.
   */
  full: {
    enableRealtime: true,
    presenceEnabled: true,
    agentModeEnabled: true,
    enableDocumentBrowser: true,
    enableBranchSelector: true,
    enableVersionHistory: true,
    enableMergeControl: true,
    enableAutoSave: true,
    enablePublishButton: true,
    enableCollaboratorAvatars: true,
    enableAgentBanner: true,
    enableFocusHighlighting: true,
  },
};

/**
 * Resolves feature flags with defaults.
 *
 * Some flags have defaults that follow other flags:
 * - enableCollaboratorAvatars defaults to presenceEnabled
 * - enableAgentBanner defaults to agentModeEnabled
 * - enableFocusHighlighting defaults to presenceEnabled
 *
 * @param config - Feature config with optional flags
 * @returns Resolved config with all flags set
 */
export function resolveFeatureConfig(config: CSSFeatureConfig): Required<CSSFeatureConfig> {
  return {
    enableRealtime: config.enableRealtime ?? true,
    presenceEnabled: config.presenceEnabled ?? true,
    agentModeEnabled: config.agentModeEnabled ?? false,
    enableDocumentBrowser: config.enableDocumentBrowser ?? true,
    enableBranchSelector: config.enableBranchSelector ?? true,
    enableVersionHistory: config.enableVersionHistory ?? true,
    enableMergeControl: config.enableMergeControl ?? false,
    enableAutoSave: config.enableAutoSave ?? true,
    enablePublishButton: config.enablePublishButton ?? true,
    enableCollaboratorAvatars: config.enableCollaboratorAvatars ?? config.presenceEnabled ?? false,
    enableAgentBanner: config.enableAgentBanner ?? config.agentModeEnabled ?? false,
    enableFocusHighlighting: config.enableFocusHighlighting ?? config.presenceEnabled ?? false,
  };
}
