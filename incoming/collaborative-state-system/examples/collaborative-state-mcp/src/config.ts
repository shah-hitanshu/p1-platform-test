/**
 * Configuration for the MCP Server
 *
 * Loads configuration from environment variables.
 */

export interface Config {
  workerApiUrl: string;
  agentId: string;
  agentApiKey: string;
  defaultSiteId?: string;
  defaultBranchId?: string;
}

/**
 * Load configuration from environment variables
 */
export function loadConfig(): Config {
  const workerApiUrl = process.env.WORKER_API_URL;
  const agentId = process.env.AGENT_ID;
  const agentApiKey = process.env.AGENT_API_KEY;

  if (!workerApiUrl) {
    throw new Error('WORKER_API_URL environment variable is required');
  }

  if (!agentId) {
    throw new Error('AGENT_ID environment variable is required');
  }

  if (!agentApiKey) {
    throw new Error('AGENT_API_KEY environment variable is required');
  }

  return {
    workerApiUrl,
    agentId,
    agentApiKey,
    defaultSiteId: process.env.DEFAULT_SITE_ID,
    defaultBranchId: process.env.DEFAULT_BRANCH_ID,
  };
}
