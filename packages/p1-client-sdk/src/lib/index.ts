export {
  type AuthTokens,
  type UserInfo,
  type DeviceCodeResponse,
  getStoredTokens,
  storeTokens,
  clearTokens,
  getUserInfo,
  isTokenExpired,
  refreshAccessToken,
  getValidTokens,
  startDeviceFlow,
  pollForToken,
} from "./auth";

export {
  type FlatComponent,
  CROSS_PAGE_REF_REGEX,
  MAX_XREF_DEPTH,
  getBlockPropsById,
  getRawPropValue,
  normalizeRoutePathForRef,
  encodePagesBlocksTemplate,
  isPagesBlocksTemplateString,
  isCrossPageRefTemplateString,
  flattenComponents,
  listConnectablePropKeys,
} from "./cross-reference";

export {
  type RemoteDatasourceFieldDoc,
  type RemoteDatasourceDefinition,
  buildRemoteDatasourceRegistry,
  type RemoteDatasourceContext,
  type RemoteDatasourceFetcher,
  type RemoteDatasourceFetcherParams,
  type LoadRemoteDatasourceContextOpts,
  fetchHttpJsonRemoteDatasource,
  type HttpJsonRemoteDatasourceDefinition,
  type RemoteDatasourceFieldDocInput,
  type RemoteDatasourceScope,
} from "./remote-datasources";

export {
  normalizeRoutePath,
  publicPagePathHref,
  editorPathHref,
  pagePathFromCatchAllSegments,
  isRouteTemplatePath,
  pathSegments,
  defaultInstancePathFromTemplate,
  matchConcretePathToTemplateParams,
  listRouteTemplateKeys,
  pickTemplateSourcePath,
  resolveTemplateMatch,
  isCanonicalTemplatePath,
  templatePathParamNames,
} from "./route-templates";

export {
  isUnsafeKey,
  isComponentNode,
  stripTrailingSlash,
  PATH_REGEX,
  isReservedPath,
  normalizePath,
} from "./paths";

export { applySemanticOps, computeSemanticOps } from "./semantic-ops";

export {
  type TemplateSuggestion,
  getActiveRemoteDatasourceInterpolation,
  remoteDatasourceTemplateSuggestions,
} from "./template-autocomplete";

// Re-export server-only types (type-only is safe for client bundles)
export type {
  RouteKind,
  RouteRow,
  FlatStructureRow,
  SemanticPatchPageEntry,
  OverridePageEntry,
  SemanticOp,
} from "./page-store";

export {
  mono,
  muted,
  card,
  infoPanel,
  sectionLabel,
  errorText,
  backdrop,
  modalPanel,
  primaryButton,
  secondaryButton,
  dangerButton,
  ghostButton,
} from "./styles";

export { P1QueryProvider } from "./query-provider";
