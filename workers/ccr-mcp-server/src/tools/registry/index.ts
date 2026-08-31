import { defineTools } from '../shared/define-tools.functions.js';
import { listComponentsTool } from './list-components.js';
import { listTemplatesTool } from './list-templates.js';

export const registryTools = defineTools({
  list_components: listComponentsTool,
  list_templates: listTemplatesTool,
});
