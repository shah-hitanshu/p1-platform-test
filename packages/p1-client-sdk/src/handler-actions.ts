/**
 * Barrel re-export for handler actions.
 * Each domain lives in its own route module under `./routes/`.
 */

export { normalizePath } from "./lib/paths";
export { getPageData } from "./routes/page-data";
export { getRemoteDatasources, postRemoteDatasources, deleteRemoteDatasources } from "./routes/remote-datasources-api";
export { postPublish } from "./routes/publish";
export { postResolvePreview } from "./routes/resolve-preview";
export { postPreviewMeta } from "./routes/preview-meta";
export { postAuthDeviceCode, postAuthToken } from "./routes/auth";
export { postStructure, deleteStructurePage } from "./routes/structure";
