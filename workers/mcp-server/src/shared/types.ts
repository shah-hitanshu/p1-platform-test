export interface ActingUser {
  id: string;
  email: string;
}

export interface McpApiClientConfig {
  baseUrl: string;
  agentId: string;
  agentApiKey: string;
  actingUser?: ActingUser;
}
