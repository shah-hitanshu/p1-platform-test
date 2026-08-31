import { defineTools } from '../shared/define-tools.functions.js';
import { getPageMetadataTool } from './get-page-metadata.js';
import { setPageMetadataTool } from './set-page-metadata.js';

export const metadataTools = defineTools({
  get_page_metadata: getPageMetadataTool,
  set_page_metadata: setPageMetadataTool,
});
