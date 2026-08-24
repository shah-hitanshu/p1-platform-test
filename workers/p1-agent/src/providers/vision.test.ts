import { describe, it, expect } from 'vitest';
import type { Env } from '../env.js';
import type { Attachment } from '../types.js';
import { imageParts, modelSeesImages } from './vision.js';

const PNG = 'data:image/png;base64,QUJD';

const image = (dataUrl = PNG): Attachment => ({ kind: 'image', filename: 'hero.png', dataUrl });

describe('imageParts', () => {
  it('presents an attached image as the content part the gateway accepts', () => {
    expect(imageParts([image()])).toEqual([{ type: 'image_url', image_url: { url: PNG } }]);
  });

  it('keeps the order they were attached in', () => {
    const second = 'data:image/webp;base64,REVG';

    expect(imageParts([image(), image(second)]).map(p => p.image_url.url)).toEqual([PNG, second]);
  });

  it('takes nothing from a turn that attached only a document', () => {
    expect(imageParts([{ kind: 'document', filename: 'brief.md', text: 'a brief' }])).toEqual([]);
    expect(imageParts([])).toEqual([]);
  });

});

describe('modelSeesImages', () => {
  const DEFAULT = '@cf/moonshotai/kimi-k2.7-code';
  const env = (vision?: string): Env => ({ ...(vision === undefined ? {} : { AGENT_MODEL_VISION: vision }) } as Env);

  it('believes the flag when it is set either way', () => {
    expect(modelSeesImages(env('true'), '@cf/some/text-only', DEFAULT)).toBe(true);
    expect(modelSeesImages(env('false'), DEFAULT, DEFAULT)).toBe(false);
  });

  it('does not read "false" as set', () => {
    expect(modelSeesImages(env('false'), '@cf/some/vision', DEFAULT)).toBe(false);
  });

  it('ignores a value that means nothing, rather than believing it', () => {
    expect(modelSeesImages(env('yes'), '@cf/some/text-only', DEFAULT)).toBe(false);
    expect(modelSeesImages(env(''), DEFAULT, DEFAULT)).toBe(true);
  });

  it('assumes only the models whose capability we know', () => {
    expect(modelSeesImages(env(), DEFAULT, DEFAULT)).toBe(true);
    expect(modelSeesImages(env(), 'anthropic/claude-sonnet-4-5', DEFAULT)).toBe(true);
    expect(modelSeesImages(env(), '@cf/meta/llama-3-8b-instruct', DEFAULT)).toBe(false);
  });
});
