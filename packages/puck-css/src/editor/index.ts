export { P1App } from './P1App.js';
export type { P1AppProps } from './P1App.js';
export { P1PuckProvider } from './P1PuckProvider.js';
export type { P1PuckProviderProps } from './P1PuckProvider.js';

export { useAutoSave } from './useAutoSave.js';
export { useDocuments } from './useDocuments.js';
export { useBranches } from './useBranches.js';
export { useRealtime } from './useRealtime.js';
export type { UseRealtimeParams, UseRealtimeReturn } from './useRealtime.js';
export { useP1Plugin } from './useP1Plugin.js';
export type { UseP1PluginOptions } from './useP1Plugin.js';
export { useP1Overrides } from './useP1Overrides.js';
export type { UseP1OverridesOptions } from './useP1Overrides.js';
export { useP1Editor } from './useP1Editor.js';
export type { UseP1EditorOptions, UseP1EditorReturn, PuckProps } from './useP1Editor.js';
export { useMergePreview } from './useMergePreview.js';
export type { UseMergePreviewReturn } from './useMergePreview.js';
export { useComponentRegistry } from './useComponentRegistry.js';
export { aiPanelStore, useAIPanelOpen } from './aiPanelStore.js';

export { createP1Plugin } from './plugin/P1Plugin.js';
export type { P1PluginOptions, PuckPlugin } from './plugin/P1Plugin.js';
export { createP1Overrides } from './plugin/createP1Overrides.js';
export type { P1OverridesOptions, PuckOverrides } from './plugin/createP1Overrides.js';

export { buildLiveThumbnailDrawer } from './thumbnails/buildLiveThumbnailDrawer.js';
export type { LiveThumbnailDrawerOptions } from './thumbnails/buildLiveThumbnailDrawer.js';
export { LiveThumbnail } from './thumbnails/LiveThumbnail.js';
export type { LiveThumbnailProps } from './thumbnails/LiveThumbnail.js';
export { ThumbnailCard } from './thumbnails/ThumbnailCard.js';
export type { ThumbnailCardProps } from './thumbnails/ThumbnailCard.js';
export { humanizeComponentName } from './thumbnails/humanizeComponentName.js';
export { createMergePreviewPlugin } from './plugin/mergePreviewPlugin.js';

export { SaveIndicator } from './components/SaveIndicator.js';
export { PublishButton } from './components/PublishButton.js';
export { BranchSelector } from './components/BranchSelector.js';
export { PuckDataSynchronizer } from './components/PuckDataSynchronizer.js';
export { PuckDataCapture } from './components/PuckDataCapture.js';
export { PuckSelectionTracker } from './components/PuckSelectionTracker.js';
export type { PuckSelectionTrackerProps } from './components/PuckSelectionTracker.js';
export { Toast } from './components/Toast.js';
export { NotificationContainer } from './components/NotificationContainer.js';
export { PublishedStatusBadge } from './components/PublishedStatusBadge.js';
export { PanelHeader } from './components/PanelHeader.js';
export type { PanelHeaderProps } from './components/PanelHeader.js';
export { PanelShell } from './components/PanelShell.js';
export type { PanelShellProps } from './components/PanelShell.js';
export { OutlinePanel } from './components/OutlinePanel.js';
export { Connectable } from './components/connectable.js';
export type { ConnectableItem, ConnectedItem } from './components/connectable.js';

export * from './components/merge-preview/index.js';

export { buildThumbnailOverride } from './utils/buildThumbnailOverride.js';
export type { ThumbnailMap } from './utils/buildThumbnailOverride.js';
export { createStablePluginArray } from './utils/createStablePluginArray.js';
export { createPuckYjsBinding, puckDataToYMap, yMapToPuckData } from './utils/puckYjsBinding.js';
export { extractDescriptors, buildRegistryIndex } from './utils/componentRegistry.js';
export type { ComponentDescriptor, RegistryIndex } from './utils/componentRegistry.js';
