import { defineTools } from '../shared/define-tools.functions.js';
import { createSiteTool } from './create-site.js';
import { getSiteTool } from './get-site.js';
import { getSiteSettingsTool } from './get-site-settings.js';
import { listSitesTool } from './list-sites.js';
import { updateSiteTool } from './update-site.js';
import { updateSiteSettingsTool } from './update-site-settings.js';

export const siteTools = defineTools({
  list_sites: listSitesTool,
  create_site: createSiteTool,
  get_site: getSiteTool,
  update_site: updateSiteTool,
  get_site_settings: getSiteSettingsTool,
  update_site_settings: updateSiteSettingsTool,
});
