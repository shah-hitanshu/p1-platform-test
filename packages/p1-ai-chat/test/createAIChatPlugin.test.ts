import { describe, it, expect, afterEach, vi } from 'vitest';
import { createAIChatPlugin } from '../src/index.js';

// Reads the options AIFieldsOverride is called with, without rendering React.
function resolvedOptions(plugin: ReturnType<typeof createAIChatPlugin>) {
  const fields = plugin.overrides!.fields as unknown as (props: {
    children: null;
    isLoading: false;
  }) => { props: { options: unknown } };
  const element = fields({ children: null, isLoading: false });
  return element.props.options as { agentUrl: string; mediaWorkerUrl?: string };
}

describe('createAIChatPlugin', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('falls back to NEXT_PUBLIC_MEDIA_WORKER_URL when mediaWorkerUrl is omitted', () => {
    vi.stubEnv('NEXT_PUBLIC_MEDIA_WORKER_URL', 'https://media.staging.example.com');
    const options = resolvedOptions(createAIChatPlugin({ agentUrl: 'http://agent.test' }));
    expect(options.mediaWorkerUrl).toBe('https://media.staging.example.com');
  });

  it('prefers an explicit mediaWorkerUrl over the env var', () => {
    vi.stubEnv('NEXT_PUBLIC_MEDIA_WORKER_URL', 'https://media.staging.example.com');
    const options = resolvedOptions(
      createAIChatPlugin({ agentUrl: 'http://agent.test', mediaWorkerUrl: 'https://media.example.com' }),
    );
    expect(options.mediaWorkerUrl).toBe('https://media.example.com');
  });

  // A bare `NEXT_PUBLIC_MEDIA_WORKER_URL=` in an env file inlines to '', which `??` would
  // pass through as a configured-but-empty base URL.
  it('treats an empty env value as unset rather than an empty base URL', () => {
    vi.stubEnv('NEXT_PUBLIC_MEDIA_WORKER_URL', '');
    const options = resolvedOptions(createAIChatPlugin({ agentUrl: 'http://agent.test' }));
    expect(options.mediaWorkerUrl).toBeUndefined();
  });

  it('treats an empty explicit option as unset, and still reads the env behind it', () => {
    vi.stubEnv('NEXT_PUBLIC_MEDIA_WORKER_URL', 'https://media.staging.example.com');
    const options = resolvedOptions(
      createAIChatPlugin({ agentUrl: 'http://agent.test', mediaWorkerUrl: '' }),
    );
    expect(options.mediaWorkerUrl).toBe('https://media.staging.example.com');
  });

  it('leaves mediaWorkerUrl undefined when neither is set, so attachments are not kept', () => {
    const options = resolvedOptions(createAIChatPlugin({ agentUrl: 'http://agent.test' }));
    expect(options.mediaWorkerUrl).toBeUndefined();
  });
});
