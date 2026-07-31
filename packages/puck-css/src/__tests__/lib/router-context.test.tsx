import { describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import React from 'react';

import {
  P1RouterContext,
  useP1Router,
  type P1Router,
} from '../../p1/router-context';

function RouterCapture({ onRouter }: { onRouter: (r: P1Router) => void }) {
  const router = useP1Router();
  onRouter(router);
  return <div>ok</div>;
}

describe('P1RouterContext', () => {
  it('throws when used outside provider', () => {
    const orig = console.error;
    console.error = () => {};
    try {
      expect(() =>
        render(<RouterCapture onRouter={() => {}} />)
      ).toThrow();
    } finally {
      console.error = orig;
    }
  });

  it('provides router to children', () => {
    const mockRouter: P1Router = {
      refresh: vi.fn(),
      replace: vi.fn(),
      pathname: '/test',
      searchParams: new URLSearchParams('a=1'),
    };

    let captured: P1Router | null = null;
    render(
      <P1RouterContext.Provider value={mockRouter}>
        <RouterCapture onRouter={(r) => { captured = r; }} />
      </P1RouterContext.Provider>
    );

    expect(captured).not.toBeNull();
    expect((captured as P1Router).pathname).toBe('/test');
    expect((captured as P1Router).searchParams.get('a')).toBe('1');
  });

  it('refresh and replace are callable', () => {
    const mockRouter: P1Router = {
      refresh: vi.fn(),
      replace: vi.fn(),
      pathname: '/',
      searchParams: new URLSearchParams(),
    };

    let captured: P1Router | null = null;
    render(
      <P1RouterContext.Provider value={mockRouter}>
        <RouterCapture onRouter={(r) => { captured = r; }} />
      </P1RouterContext.Provider>
    );

    expect(captured).not.toBeNull();
    (captured as P1Router).refresh();
    (captured as P1Router).replace('/new', { scroll: false });

    expect(mockRouter.refresh).toHaveBeenCalledOnce();
    expect(mockRouter.replace).toHaveBeenCalledWith('/new', { scroll: false });
  });
});
