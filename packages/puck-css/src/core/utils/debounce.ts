/**
 * Debounce Utility
 *
 * Creates a debounced version of a function that delays execution
 * until after a specified wait time has elapsed since the last call.
 */

type AnyFunction = (...args: unknown[]) => void;

interface DebouncedFunction<T extends AnyFunction> {
  (...args: Parameters<T>): void;
  cancel: () => void;
  flush: () => void;
  pause: () => void;
  resume: () => void;
  isPaused: () => boolean;
}

/**
 * Creates a debounced function that delays invoking func until after
 * wait milliseconds have elapsed since the last time the debounced
 * function was invoked.
 *
 * @param func - The function to debounce
 * @param wait - The number of milliseconds to delay
 * @returns A debounced version of the function
 */
export function debounce<T extends AnyFunction>(func: T, wait: number): DebouncedFunction<T> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  let lastArgs: Parameters<T> | null = null;
  let paused = false;

  const startTimer = (): void => {
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
    }

    timeoutId = setTimeout(() => {
      timeoutId = null;
      if (!paused && lastArgs !== null) {
        func(...lastArgs);
        lastArgs = null;
      }
    }, wait);
  };

  const debounced = ((...args: Parameters<T>): void => {
    lastArgs = args;

    // Don't start timer if paused, but still save args
    if (paused) {
      return;
    }

    startTimer();
  }) as DebouncedFunction<T>;

  debounced.cancel = (): void => {
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
    lastArgs = null;
  };

  debounced.flush = (): void => {
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
    if (lastArgs !== null) {
      func(...lastArgs);
      lastArgs = null;
    }
  };

  debounced.pause = (): void => {
    paused = true;
    // Cancel any pending timer
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
  };

  debounced.resume = (): void => {
    paused = false;
    // If there are pending args, restart the timer
    if (lastArgs !== null) {
      startTimer();
    }
  };

  debounced.isPaused = (): boolean => {
    return paused;
  };

  return debounced;
}
