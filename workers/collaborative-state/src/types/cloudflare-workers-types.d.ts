/**
 * Alias module for `@cloudflare/workers-types` (see "paths" in tsconfig.json).
 *
 * The real package ships two parallel copies of its ~15k-line type surface:
 * ambient globals in index.d.ts (loaded via tsconfig "types", and used by the
 * `cloudflare:workers` module) and a module-flavored index.ts (what
 * `import type { ... } from '@cloudflare/workers-types'` resolves to under
 * moduleResolution "bundler"). Mixing the two copies — e.g. passing a
 * module-flavored `DurableObjectState` to a class extending the global
 * `DurableObject` — makes tsc structurally relate the two enormous type
 * graphs (1296-member union vs. 1296-member union) and effectively hang
 * (PCC-3376). This shim re-exports the ambient globals under the package
 * specifier so both spellings are the *same* types and no structural
 * comparison is ever needed.
 */

type GlobalDurableObjectState<Props = unknown> = DurableObjectState<Props>;
type GlobalDurableObjectNamespace<
  T extends Rpc.DurableObjectBranded | undefined = undefined,
> = DurableObjectNamespace<T>;
type GlobalDurableObjectId = DurableObjectId;
type GlobalDurableObjectStub<
  T extends Rpc.DurableObjectBranded | undefined = undefined,
> = DurableObjectStub<T>;
type GlobalDurableObjectStorage = DurableObjectStorage;
type GlobalExecutionContext<Props = unknown> = ExecutionContext<Props>;

export type {
  GlobalDurableObjectState as DurableObjectState,
  GlobalDurableObjectNamespace as DurableObjectNamespace,
  GlobalDurableObjectId as DurableObjectId,
  GlobalDurableObjectStub as DurableObjectStub,
  GlobalDurableObjectStorage as DurableObjectStorage,
  GlobalExecutionContext as ExecutionContext,
};
