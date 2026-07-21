import { AsyncLocalStorage } from "node:async_hooks";

const authStorage = new AsyncLocalStorage<string>();

export function runWithAuthToken<T>(token: string, fn: () => T): T {
  return authStorage.run(token, fn);
}

export function getRequestAuthToken(): string | undefined {
  return authStorage.getStore();
}
