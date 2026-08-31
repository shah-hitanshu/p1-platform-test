import { McpApiClient } from '../../shared/api-client';
import { ActingUser } from '../../shared/types';

export interface P1McpToolContext {
  apiClient: McpApiClient;
  actingUser?: ActingUser;
  requestedById?: string;
  trigger: 'human_requested' | 'autonomous';
}
