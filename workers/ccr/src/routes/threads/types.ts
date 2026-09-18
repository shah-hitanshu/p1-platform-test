import type { Env } from '../../env';
import type { MASClient } from '../../services/mas-client';
import type { AuthenticatedPrincipal } from '../../types';

export type * from '../../types/threads';

export interface ThreadsRouteContext {
  siteId: string;
  threadId?: string;
  /** `comments` or `status` under a thread; absent on the thread itself. */
  subResource?: string;
  contextType?: string;
  contextId?: string;
  principal: AuthenticatedPrincipal;
  masClient?: MASClient;
  ctx?: ExecutionContext;
  env?: Env;
}
