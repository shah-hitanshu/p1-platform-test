export { validateOps } from './validator.js';
export {
  fetchRegistry,
  listRegistryVersions,
  snapshotToComponentSchema,
  registryComponentKey,
  componentNameFromPath,
} from './registry.js';
export { validateDocumentStructure } from './structure-validator.js';
export { validateTranslationAuthority } from './authority-enforcement.js';
export {
  resolveTranslatable,
  resolveSlotAuthority,
  resolveSlotAuthorityMap,
  isAuthority,
  AUTHORITIES,
  DEFAULT_AUTHORITY,
} from './localization.js';
export type {
  EditOperation,
  Authority,
  ComponentSchema,
  ComponentField,
  FieldOption,
  ValidationError,
  ValidateInput,
  FetchRegistryOpts,
  TemplateComponent,
  TemplateSnapshot,
  StructuralConformanceError,
  ValidateStructureInput,
  AuthoritySeverity,
  AuthorityOverrideMap,
  AuthorityDiagnostic,
  ValidateTranslationAuthorityInput,
} from './types.js';
