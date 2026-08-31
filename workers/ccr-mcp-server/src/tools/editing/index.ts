import { defineTools } from '../shared/define-tools.functions.js';
import { abortEditSessionTool } from './abort-edit-session.js';
import { applyDocumentEditsTool } from './apply-document-edits.js';
import { checkEditPermissionTool } from './check-edit-permission.js';
import { completeEditSessionTool } from './complete-edit-session.js';
import { startEditSessionTool } from './start-edit-session.js';

export const editingTools = defineTools({
  check_edit_permission: checkEditPermissionTool,
  start_edit_session: startEditSessionTool,
  apply_document_edits: applyDocumentEditsTool,
  complete_edit_session: completeEditSessionTool,
  abort_edit_session: abortEditSessionTool,
});
