import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

vi.mock('../../auth/P1AuthProvider', () => ({
  useP1Auth: () => ({ getToken: () => Promise.resolve('test-token') }),
}));

import { P1RouterContext, type P1Router } from '../../p1/router-context';
import { P1QueryProvider } from '../../data/query-provider';
import { CreatePageForm } from '../../p1/pages/create-page-form';

const TEMPLATE = {
  id: 'tmpl-oped',
  name: 'oped',
  label: 'Oped',
  version: 7,
  components: [],
  updatedAt: '2026-06-29T00:00:00.000Z',
};

function createMockRouter(): P1Router {
  return {
    refresh: vi.fn(),
    replace: vi.fn(),
    pathname: '/structure',
    searchParams: new URLSearchParams(),
  };
}

function createWrapper(router: P1Router) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(
      P1QueryProvider,
      null,
      React.createElement(P1RouterContext.Provider, { value: router }, children),
    );
  };
}

describe('CreatePageForm — template binding', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('sends templateId + templateVersion when a template is selected', async () => {
    const router = createMockRouter();
    const calls: { url: string; body: unknown }[] = [];

    const mockFetch = vi.fn(async (url: string, init?: RequestInit) => {
      // Template list (loaded on mount)
      if (url.includes('/templates')) {
        return {
          ok: true,
          json: () => Promise.resolve({ templates: [TEMPLATE] }),
        } as Response;
      }
      // Structure create POST
      const body = init?.body ? JSON.parse(init.body as string) : undefined;
      calls.push({ url, body });
      return {
        ok: true,
        json: () => Promise.resolve({ ok: true, path: '/oped5' }),
      } as Response;
    });
    vi.stubGlobal('fetch', mockFetch);

    const Wrapper = createWrapper(router);
    render(
      <Wrapper>
        <CreatePageForm
          baseUrl="https://css.example"
          siteId="site-1"
          branchId="main"
          userRole="admin"
        />
      </Wrapper>,
    );

    // Wait for the template dropdown to populate.
    const select = await screen.findByRole('combobox');
    await waitFor(() => expect(screen.getByText('Oped')).toBeTruthy());

    // Select the template.
    fireEvent.change(select, { target: { value: TEMPLATE.id } });

    // Set the path and submit.
    const pathInput = screen.getByPlaceholderText('/contact-us');
    fireEvent.change(pathInput, { target: { value: '/oped5' } });
    fireEvent.click(screen.getByText('Add page'));

    await waitFor(() => expect(calls.length).toBe(1));

    const posted = calls[0].body as Record<string, unknown>;
    expect(calls[0].url).toBe('/p1/api/structure/page');
    expect(posted.path).toBe('/oped5');
    expect(posted.templateId).toBe(TEMPLATE.id);
    expect(posted.templateVersion).toBe(TEMPLATE.version);
  });
});
