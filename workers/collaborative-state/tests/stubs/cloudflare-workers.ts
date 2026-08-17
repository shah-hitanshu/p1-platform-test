/**
 * Stub for the cloudflare:workers built-in module, which Node cannot resolve.
 * Individual specs still vi.mock('cloudflare:workers') when they need to
 * observe or control it; vi.mock takes precedence over this alias.
 */

export class DurableObject<Env = unknown> {
  ctx: DurableObjectState;
  env: Env;

  constructor(ctx: DurableObjectState, env: Env) {
    this.ctx = ctx;
    this.env = env;
  }
}

export class WorkerEntrypoint<Env = unknown> {
  ctx: ExecutionContext;
  env: Env;

  constructor(ctx: ExecutionContext, env: Env) {
    this.ctx = ctx;
    this.env = env;
  }
}

export const cache = {
  purge: (): Promise<{ success: boolean; errors: never[] }> =>
    Promise.resolve({ success: true, errors: [] }),
};

export const exports: Record<string, unknown> = {};
