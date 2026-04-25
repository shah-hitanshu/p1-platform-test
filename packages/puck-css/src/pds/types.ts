export type DocState = 'modified' | 'unpublished' | 'live' | 'liveOnly';

export interface PDSEditorOverridesOptions {
  onPublish?: () => Promise<void> | void;
  onCompareWithLive?: () => void;
  onStopAgent?: (agentId: string) => void;
}
