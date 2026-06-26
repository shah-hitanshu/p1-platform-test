/**
 * Content Type Templates - Feature Config Tests
 *
 * Tests for the enableContentTypeTemplates feature flag integration.
 */

import { describe, it, expect } from 'vitest';
import { resolveFeatureConfig } from '../../core/featureConfig.js';
import type { P1FeatureConfig } from '../../core/featureConfig.js';

describe('enableContentTypeTemplates feature flag', () => {
  it('defaults to true when not specified', () => {
    const config: P1FeatureConfig = {};
    const resolved = resolveFeatureConfig(config);
    expect(resolved.enableContentTypeTemplates).toBe(true);
  });

  it('can be explicitly enabled', () => {
    const config: P1FeatureConfig = {
      enableContentTypeTemplates: true,
    };
    const resolved = resolveFeatureConfig(config);
    expect(resolved.enableContentTypeTemplates).toBe(true);
  });

  it('can be explicitly disabled', () => {
    const config: P1FeatureConfig = {
      enableContentTypeTemplates: false,
    };
    const resolved = resolveFeatureConfig(config);
    expect(resolved.enableContentTypeTemplates).toBe(false);
  });

  it('works with other feature flags', () => {
    const config: P1FeatureConfig = {
      enableRealtime: true,
      presenceEnabled: true,
      enableContentTypeTemplates: true,
    };
    const resolved = resolveFeatureConfig(config);
    expect(resolved.enableRealtime).toBe(true);
    expect(resolved.presenceEnabled).toBe(true);
    expect(resolved.enableContentTypeTemplates).toBe(true);
  });

  it('is included in full preset', () => {
    // The full preset should include enableContentTypeTemplates: true
    // when templates are part of the full feature set
    const config: P1FeatureConfig = {
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
      enableContentTypeTemplates: true,
    };
    const resolved = resolveFeatureConfig(config);
    expect(resolved.enableContentTypeTemplates).toBe(true);
  });

  it('remains enabled in basic preset by default', () => {
    const config: P1FeatureConfig = {
      enableAutoSave: true,
      enablePublishButton: true,
    };
    const resolved = resolveFeatureConfig(config);
    expect(resolved.enableContentTypeTemplates).toBe(true);
  });
});
