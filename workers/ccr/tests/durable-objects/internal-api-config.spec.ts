import { describe, it, expect } from 'vitest';
import { internalApiConfig } from '../../src/durable-objects/internal-api-config';

describe('internalApiConfig', () => {
  it('pairs the url with its secret when both are set', () => {
    expect(internalApiConfig({ INTERNAL_API_URL: 'http://api', INTERNAL_SECRET: 's3' }))
      .toEqual({ url: 'http://api', secret: 's3' });
  });

  it('is undefined when either half is missing', () => {
    expect(internalApiConfig({ INTERNAL_API_URL: 'http://api' })).toBeUndefined();
    expect(internalApiConfig({ INTERNAL_SECRET: 's3' })).toBeUndefined();
    expect(internalApiConfig({})).toBeUndefined();
  });
});
