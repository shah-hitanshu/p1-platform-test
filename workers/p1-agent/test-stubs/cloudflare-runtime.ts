/**
 * Stand-ins for the `cloudflare:*` built-ins, which the node test loader rejects by scheme.
 * Identity is enough — nothing under test calls into them.
 */
export class RpcTarget {}
export class EmailMessage {}
export class DurableObject {}
export class WorkerEntrypoint {}
