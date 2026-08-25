// Registry sync — pure functions for extracting Puck component descriptors
// and syncing them to CCR registry documents, with no React dependency.
// Used by the browser useComponentRegistry hook and by headless CI callers
// (e.g. a customer's sync-puck-registry script) alike.

export { extractDescriptors, buildRegistryIndex } from "./editor/utils/componentRegistry.js";
export type {
  ComponentDescriptor,
  ComponentProvenance,
  SerializedField,
  FieldAiMeta,
  RegistryIndex,
} from "./editor/utils/componentRegistry.js";
export { syncComponentRegistry } from "./editor/utils/syncComponentRegistry.js";
export type { RegistrationResult } from "./editor/utils/syncComponentRegistry.js";
export { syncComponentRegistryWriteOnly } from "./editor/utils/syncComponentRegistryWriteOnly.js";
export type { WriteOnlyRegistrationResult } from "./editor/utils/syncComponentRegistryWriteOnly.js";
