import { defineTools } from '../shared/define-tools.functions.js';
import { getDocumentVersionTool } from './get-document-version.js';
import { listDocumentVersionsTool } from './list-document-versions.js';
import { restoreDocumentVersionTool } from './restore-document-version.js';

export const versionTools = defineTools({
  list_document_versions: listDocumentVersionsTool,
  get_document_version: getDocumentVersionTool,
  restore_document_version: restoreDocumentVersionTool,
});
