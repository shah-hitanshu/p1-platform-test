import type { Data } from "@puckeditor/core";

import { resolvePageData } from "./page-store";

export {
  isRouteTemplatePath,
  listRouteTemplateKeys,
  pickTemplateSourcePath,
} from "./route-templates";

/** Resolved Puck data (full merge: patch overrides + collection template fallback). */
export const getPage = (path: string): Promise<Data | null> => resolvePageData(path);
