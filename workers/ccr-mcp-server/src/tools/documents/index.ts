import { defineTools } from '../shared/define-tools.functions.js';
import { archivePageTool } from './archive-page.js';
import { createPageTool } from './create-page.js';
import { getDocumentTool } from './get-document.js';
import { listDocumentsTool } from './list-documents.js';
import { publishPageTool } from './publish-page.js';
import { renamePageTool } from './rename-page.js';
import { restorePageTool } from './restore-page.js';

export const documentTools = defineTools({
  list_documents: listDocumentsTool,
  get_document: getDocumentTool,
  create_page: createPageTool,
  publish_page: publishPageTool,
  archive_page: archivePageTool,
  restore_page: restorePageTool,
  rename_page: renamePageTool,
});
