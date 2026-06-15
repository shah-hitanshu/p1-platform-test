export interface ActingUser {
  id: string;
  email: string;
  name?: string;
}

export interface McpApiClientConfig {
  baseUrl: string;
  agentId: string;
  agentApiKey: string;
  actingUser?: ActingUser;
  /** Service binding fetcher — bypasses worker-to-worker fetch restrictions */
  fetcher?: Fetcher;
  /** When true, apply_document_edits and create_page validate ops against the component registry */
  enableValidation?: boolean;
}
