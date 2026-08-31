import { defineTools } from '../shared/define-tools.functions.js';
import { getQueryTool } from './get-query.js';
import { getQueryResultsTool } from './get-query-results.js';
import { listDatasourcesTool } from './list-datasources.js';
import { listQueriesTool } from './list-queries.js';

export const dataTools = defineTools({
  list_datasources: listDatasourcesTool,
  list_queries: listQueriesTool,
  get_query: getQueryTool,
  get_query_results: getQueryResultsTool,
});
