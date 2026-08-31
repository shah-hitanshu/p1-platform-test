import { defineTools } from '../shared/define-tools.functions.js';
import { addNavigationItemTool } from './add-navigation-item.js';
import { getNavigationTool } from './get-navigation.js';
import { listStructuresTool } from './list-structures.js';
import { moveNavigationItemTool } from './move-navigation-item.js';
import { removeNavigationItemTool } from './remove-navigation-item.js';
import { reorderNavigationItemsTool } from './reorder-navigation-items.js';
import { updateNavigationItemTool } from './update-navigation-item.js';

export const navigationTools = defineTools({
  list_structures: listStructuresTool,
  get_navigation: getNavigationTool,
  add_navigation_item: addNavigationItemTool,
  update_navigation_item: updateNavigationItemTool,
  move_navigation_item: moveNavigationItemTool,
  reorder_navigation_items: reorderNavigationItemsTool,
  remove_navigation_item: removeNavigationItemTool,
});
