/**
 * Throttle Utility
 *
 * Creates a throttled version of a function that executes immediately
 * on the first call (leading edge), then suppresses subsequent calls
 * within the interval, firing once more after the interval with the
 * latest arguments if any calls were made during the wait (trailing edge).
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyFunction = (...args: any[]) => void;

interface ThrottledFunction<T extends AnyFunction> {
  (...args: Parameters<T>): void;
  cancel: () => void;
  flush: () => void;
  isPending: () => boolean;
}

/**
 * Creates a throttled function that invokes func at most once per
 * interval. The first call executes immediately (leading edge).
 * Subsequent calls during the interval are coalesced, and the
 * function fires once more after the interval with the latest
 * arguments (trailing edge).
 *
 * @param func - The function to throttle
 * @param interval - The minimum time between executions in milliseconds
 * @returns A throttled version of the function with cancel, flush, and isPending methods
 */
export function throttle<T extends AnyFunction>(func: T, interval: number): ThrottledFunction<T> {
  let timerId: ReturnType<typeof setTimeout> | null = null;
  let storedArgs: Parameters<T> | null = null;

  const startTimer = (): void => {
    timerId = setTimeout(() => {
      timerId = null;
      if (storedArgs !== null) {
        func(...storedArgs);
        storedArgs = null;
        startTimer();
      }
    }, interval);
  };

  const throttled = ((...args: Parameters<T>): void => {
    if (timerId === null) {
      // No timer running -- execute immediately (leading edge) and start timer
      func(...args);
      startTimer();
    } else {
      // Timer running -- store latest args for trailing edge
      storedArgs = args;
    }
  }) as ThrottledFunction<T>;

  throttled.cancel = (): void => {
    if (timerId !== null) {
      clearTimeout(timerId);
      timerId = null;
    }
    storedArgs = null;
  };

  throttled.flush = (): void => {
    if (timerId !== null) {
      clearTimeout(timerId);
      timerId = null;
    }
    if (storedArgs !== null) {
      func(...storedArgs);
      storedArgs = null;
    }
  };

  throttled.isPending = (): boolean => {
    return storedArgs !== null;
  };

  return throttled;
}
