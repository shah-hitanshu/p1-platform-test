import { defineTools } from '../shared/define-tools.functions.js';
import { getBranchPresenceTool } from './get-branch-presence.js';
import { getDocumentPresenceTool } from './get-document-presence.js';

export const presenceTools = defineTools({
  get_branch_presence: getBranchPresenceTool,
  get_document_presence: getDocumentPresenceTool,
});
