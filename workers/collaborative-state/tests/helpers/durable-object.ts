import { vi, type Mock } from 'vitest';

export interface MockDurableObjectStub {
  fetch: Mock;
}

export type MockDurableObjectNamespace = DurableObjectNamespace & {
  idFromName: Mock;
  get: Mock;
};

function unsupported(member: string): () => never {
  return () => {
    throw new Error(`DurableObjectNamespace.${member} is not mocked`);
  };
}

/**
 * A `DOCUMENT_STATE` binding covering the two members the realtime routes use.
 *
 * The members the routes never call throw instead of returning a stub value, so
 * a route that starts reaching for one fails loudly here.
 */
export function makeDurableObjectNamespace(
  stub: MockDurableObjectStub,
  id: { toString: () => string },
): MockDurableObjectNamespace {
  return {
    idFromName: vi.fn().mockReturnValue(id),
    get: vi.fn().mockReturnValue(stub),
    newUniqueId: unsupported('newUniqueId'),
    idFromString: unsupported('idFromString'),
    getByName: unsupported('getByName'),
    jurisdiction: unsupported('jurisdiction'),
  };
}
