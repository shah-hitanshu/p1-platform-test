export interface ActingUser {
  id: string;
  email: string;
  name?: string;
}

export interface McpApiClientConfig {
  baseUrl: string;
  /** Agent id for actor attribution headers; omitted on the agent-key pass-through. */
  agentId?: string;
  /** Agent API key; forwarded as X-API-Key for autonomous-agent requests. */
  agentApiKey?: string;
  /** Auth0 access token for the signed-in user; forwarded as Authorization: Bearer. */
  accessToken?: string;
  actingUser?: ActingUser;
  /** Service binding fetcher; bypasses worker-to-worker fetch restrictions. */
  fetcher?: Fetcher;
  /** When true, apply_document_edits and create_page validate ops against the component registry */
  enableValidation?: boolean;
}
