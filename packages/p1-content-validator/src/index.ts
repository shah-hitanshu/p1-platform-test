export { validateOps } from './validator.js';
export {
  fetchRegistry,
  listRegistryVersions,
  snapshotToComponentSchema,
  registryComponentKey,
  componentNameFromPath,
} from './registry.js';
export { validateDocumentStructure } from './structure-validator.js';
export type {
  EditOperation,
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
} from './types.js';
