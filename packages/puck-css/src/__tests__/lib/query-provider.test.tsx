import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import React from 'react';
import { useQueryClient } from '@tanstack/react-query';

import { P1QueryProvider } from '../../data/query-provider';

function QueryClientCheck({ onClient }: { onClient: (client: unknown) => void }) {
  const client = useQueryClient();
  onClient(client);
  return <div>ok</div>;
}

describe('P1QueryProvider', () => {
  it('provides a QueryClient to children', () => {
    let captured: unknown = null;
    render(
      <P1QueryProvider>
        <QueryClientCheck onClient={(c) => { captured = c; }} />
      </P1QueryProvider>
    );
    expect(captured).not.toBeNull();
    expect(captured).toBeDefined();
  });
});
