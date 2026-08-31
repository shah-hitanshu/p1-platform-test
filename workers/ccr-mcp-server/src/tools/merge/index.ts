import { defineTools } from '../shared/define-tools.functions.js';
import { cancelMergeJobTool } from './cancel-merge-job.js';
import { checkMergeTool } from './check-merge.js';
import { createMergeRequestTool } from './create-merge-request.js';
import { executeMergeTool } from './execute-merge.js';
import { executeMergeRequestTool } from './execute-merge-request.js';
import { getMergeJobTool } from './get-merge-job.js';
import { getMergeRequestTool } from './get-merge-request.js';
import { listMergeRequestsTool } from './list-merge-requests.js';
import { previewMergeTool } from './preview-merge.js';
import { updateMergeRequestTool } from './update-merge-request.js';

export const mergeTools = defineTools({
  check_merge: checkMergeTool,
  preview_merge: previewMergeTool,
  execute_merge: executeMergeTool,
  create_merge_request: createMergeRequestTool,
  list_merge_requests: listMergeRequestsTool,
  get_merge_request: getMergeRequestTool,
  update_merge_request: updateMergeRequestTool,
  execute_merge_request: executeMergeRequestTool,
  get_merge_job: getMergeJobTool,
  cancel_merge_job: cancelMergeJobTool,
});
