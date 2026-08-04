import { describe, it, expect } from 'vitest';
import { repairMarkdown } from '../src/streamedMarkdown.js';

describe('repairMarkdown', () => {
  it('closes a fence that has not been closed yet', () => {
    expect(repairMarkdown('Here:\n```js\nconst a = 1;')).toBe('Here:\n```js\nconst a = 1;\n```');
  });

  it('leaves a balanced pair alone', () => {
    const done = 'Here:\n```js\nconst a = 1;\n```';
    expect(repairMarkdown(done)).toBe(done);
  });

  it('closes the second fence of three', () => {
    expect(repairMarkdown('```\na\n```\ntext\n```\nb')).toBe('```\na\n```\ntext\n```\nb\n```');
  });

  it('holds back a table row that has not finished arriving', () => {
    expect(repairMarkdown('Plans:\n\n| Plan | Price |\n| --')).toBe('Plans:\n\n| Plan | Price |');
  });

  it('keeps a table whose last row is complete', () => {
    const table = '| Plan | Price |\n| --- | --- |\n| Pro | $20 |\n';
    expect(repairMarkdown(table)).toBe(table);
  });

  it('leaves prose untouched', () => {
    expect(repairMarkdown('Just a sentence.')).toBe('Just a sentence.');
  });

  it('is a no-op on empty text', () => {
    expect(repairMarkdown('')).toBe('');
  });
});
