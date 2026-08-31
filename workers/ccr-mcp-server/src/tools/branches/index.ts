import { defineTools } from '../shared/define-tools.functions.js';
import { archiveBranchTool } from './archive-branch.js';
import { createBranchTool } from './create-branch.js';
import { getBranchTool } from './get-branch.js';
import { listBranchesTool } from './list-branches.js';
import { restoreBranchTool } from './restore-branch.js';
import { updateBranchTool } from './update-branch.js';

export const branchTools = defineTools({
  list_branches: listBranchesTool,
  create_branch: createBranchTool,
  get_branch: getBranchTool,
  update_branch: updateBranchTool,
  archive_branch: archiveBranchTool,
  restore_branch: restoreBranchTool,
});
