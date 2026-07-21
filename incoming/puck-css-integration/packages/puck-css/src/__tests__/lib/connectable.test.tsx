import { describe, expect, it } from 'vitest';

import { renderItemTemplate } from '../../editor/components/connectable';

describe('renderItemTemplate', () => {
  it('interpolates item.field placeholders', () => {
    const result = renderItemTemplate(
      'Hello {{ item.name }}',
      { name: 'Luke', id: '1' },
      0
    );
    expect(result).toBe('Hello Luke');
  });

  it('interpolates {{ index }} placeholder', () => {
    const result = renderItemTemplate(
      'Item #{{ index }}',
      { name: 'X' },
      3
    );
    expect(result).toBe('Item #3');
  });

  it('handles dotted paths', () => {
    const result = renderItemTemplate(
      '{{ item.address.city }}',
      { address: { city: 'Portland' } },
      0
    );
    expect(result).toBe('Portland');
  });

  it('returns empty string for missing fields', () => {
    const result = renderItemTemplate(
      '{{ item.missing }}',
      { name: 'Luke' },
      0
    );
    expect(result).toBe('');
  });

  it('handles bare {{ item }} as empty', () => {
    const result = renderItemTemplate('{{ item }}', { name: 'X' }, 0);
    expect(result).toBe('');
  });
});
