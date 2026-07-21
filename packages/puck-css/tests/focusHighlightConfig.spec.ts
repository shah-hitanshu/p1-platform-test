/**
 * Focus Highlight Config Tests (TDD)
 *
 * Tests for createFocusHighlightConfig which wraps Puck component render
 * functions to add visual focus highlighting for collaborative editing.
 */

import { describe, it, expect } from 'vitest';
import React from 'react';
import { render } from '@testing-library/react';
import type { FocusHighlight } from '../src/collaboration/utils/focusRegionMap.js';

// =============================================================================
// Mock Config
// =============================================================================

const mockConfig = {
  components: {
    Text: {
      render: (props: { id: string; content: string }) => {
        return React.createElement('p', { 'data-testid': props.id }, props.content);
      },
    },
    Image: {
      render: (props: { id: string; src: string; alt: string }) => {
        return React.createElement('img', {
          'data-testid': props.id,
          src: props.src,
          alt: props.alt,
        });
      },
    },
    Button: {
      render: (props: { id: string; label: string }) => {
        return React.createElement('button', { 'data-testid': props.id }, props.label);
      },
    },
  },
};

// =============================================================================
// createFocusHighlightConfig Tests
// =============================================================================

describe('createFocusHighlightConfig', () => {
  const getModule = async () => import('../src/collaboration/utils/focusHighlightConfig.js');

  describe('wrapper behavior', () => {
    it('should wrap component render functions', async () => {
      const { createFocusHighlightConfig } = await getModule();
      const focusMap = new Map<string, FocusHighlight>();

      const wrappedConfig = createFocusHighlightConfig(mockConfig, focusMap);

      expect(wrappedConfig.components).toBeDefined();
      expect(wrappedConfig.components.Text).toBeDefined();
      expect(wrappedConfig.components.Text.render).toBeDefined();
      expect(typeof wrappedConfig.components.Text.render).toBe('function');
    });

    it('should preserve other config properties', async () => {
      const { createFocusHighlightConfig } = await getModule();
      const configWithExtras = {
        ...mockConfig,
        root: { render: () => React.createElement('div') },
        categories: { layout: { title: 'Layout' } },
      };
      const focusMap = new Map<string, FocusHighlight>();

      const wrappedConfig = createFocusHighlightConfig(configWithExtras, focusMap);

      expect(wrappedConfig.root).toBeDefined();
      expect(wrappedConfig.categories).toBeDefined();
    });

    it('should preserve component config properties other than render', async () => {
      const { createFocusHighlightConfig } = await getModule();
      const configWithFields = {
        components: {
          Text: {
            fields: { content: { type: 'text' } },
            defaultProps: { content: 'Default' },
            render: (props: { id: string; content: string }) =>
              React.createElement('p', null, props.content),
          },
        },
      };
      const focusMap = new Map<string, FocusHighlight>();

      const wrappedConfig = createFocusHighlightConfig(configWithFields, focusMap);

      expect(wrappedConfig.components.Text.fields).toEqual({ content: { type: 'text' } });
      expect(wrappedConfig.components.Text.defaultProps).toEqual({ content: 'Default' });
    });
  });

  describe('non-focused components', () => {
    it('should pass through render for non-focused components', async () => {
      const { createFocusHighlightConfig } = await getModule();
      const focusMap = new Map<string, FocusHighlight>();
      // No entries in focusMap

      const wrappedConfig = createFocusHighlightConfig(mockConfig, focusMap);
      const result = wrappedConfig.components.Text.render({
        id: 'text-1',
        content: 'Hello',
      });

      // Should render without wrapper
      const { container } = render(result);
      const element = container.querySelector('[data-testid="text-1"]');
      expect(element).not.toBeNull();
      expect(element?.tagName).toBe('P');
      expect(element?.textContent).toBe('Hello');

      // Should have inactive focus highlight wrapper
      const wrapper = container.querySelector('.focus-region-highlight--inactive');
      expect(wrapper).not.toBeNull();
    });
  });

  describe('focused components', () => {
    it('should wrap focused component with highlight div', async () => {
      const { createFocusHighlightConfig } = await getModule();
      const focusMap = new Map<string, FocusHighlight>([
        [
          'text-1',
          {
            actorId: 'user-alice',
            actorName: 'Alice',
            color: '#6366f1',
            isEditing: false,
          },
        ],
      ]);

      const wrappedConfig = createFocusHighlightConfig(mockConfig, focusMap);
      const result = wrappedConfig.components.Text.render({
        id: 'text-1',
        content: 'Hello',
      });

      const { container } = render(result);

      // Should have focus highlight wrapper
      const wrapper = container.querySelector('.focus-region-highlight');
      expect(wrapper).not.toBeNull();

      // Original content should still be rendered inside
      const element = container.querySelector('[data-testid="text-1"]');
      expect(element).not.toBeNull();
      expect(element?.textContent).toBe('Hello');
    });

    it('should add editing class when actor is editing', async () => {
      const { createFocusHighlightConfig } = await getModule();
      const focusMap = new Map<string, FocusHighlight>([
        [
          'text-1',
          {
            actorId: 'user-alice',
            actorName: 'Alice',
            color: '#6366f1',
            isEditing: true,
          },
        ],
      ]);

      const wrappedConfig = createFocusHighlightConfig(mockConfig, focusMap);
      const result = wrappedConfig.components.Text.render({
        id: 'text-1',
        content: 'Hello',
      });

      const { container } = render(result);
      const wrapper = container.querySelector('.focus-region-highlight--editing');
      expect(wrapper).not.toBeNull();
    });

    it('should not add editing class when actor is not editing', async () => {
      const { createFocusHighlightConfig } = await getModule();
      const focusMap = new Map<string, FocusHighlight>([
        [
          'text-1',
          {
            actorId: 'user-alice',
            actorName: 'Alice',
            color: '#6366f1',
            isEditing: false,
          },
        ],
      ]);

      const wrappedConfig = createFocusHighlightConfig(mockConfig, focusMap);
      const result = wrappedConfig.components.Text.render({
        id: 'text-1',
        content: 'Hello',
      });

      const { container } = render(result);
      const wrapper = container.querySelector('.focus-region-highlight');
      expect(wrapper).not.toBeNull();

      const editingWrapper = container.querySelector('.focus-region-highlight--editing');
      expect(editingWrapper).toBeNull();
    });

    it('should set actor color as CSS variable', async () => {
      const { createFocusHighlightConfig } = await getModule();
      const focusMap = new Map<string, FocusHighlight>([
        [
          'text-1',
          {
            actorId: 'user-alice',
            actorName: 'Alice',
            color: '#ff5500',
            isEditing: false,
          },
        ],
      ]);

      const wrappedConfig = createFocusHighlightConfig(mockConfig, focusMap);
      const result = wrappedConfig.components.Text.render({
        id: 'text-1',
        content: 'Hello',
      });

      const { container } = render(result);
      const wrapper = container.querySelector('.focus-region-highlight') as HTMLElement;
      expect(wrapper).not.toBeNull();
      expect(wrapper.style.getPropertyValue('--focus-color')).toBe('#ff5500');
    });

    it('should add actor ID data attribute', async () => {
      const { createFocusHighlightConfig } = await getModule();
      const focusMap = new Map<string, FocusHighlight>([
        [
          'text-1',
          {
            actorId: 'user-alice',
            actorName: 'Alice',
            color: '#6366f1',
            isEditing: false,
          },
        ],
      ]);

      const wrappedConfig = createFocusHighlightConfig(mockConfig, focusMap);
      const result = wrappedConfig.components.Text.render({
        id: 'text-1',
        content: 'Hello',
      });

      const { container } = render(result);
      const wrapper = container.querySelector('[data-actor-id="user-alice"]');
      expect(wrapper).not.toBeNull();
    });

    it('should render actor name badge', async () => {
      const { createFocusHighlightConfig } = await getModule();
      const focusMap = new Map<string, FocusHighlight>([
        [
          'text-1',
          {
            actorId: 'user-alice',
            actorName: 'Alice',
            color: '#6366f1',
            isEditing: false,
          },
        ],
      ]);

      const wrappedConfig = createFocusHighlightConfig(mockConfig, focusMap);
      const result = wrappedConfig.components.Text.render({
        id: 'text-1',
        content: 'Hello',
      });

      const { container } = render(result);
      const badge = container.querySelector('.focus-region-highlight__badge');
      expect(badge).not.toBeNull();
      // Badge shows first letter of actor name
      expect(badge?.textContent).toBe('A');
    });
  });

  describe('multiple components', () => {
    it('should handle multiple focused components', async () => {
      const { createFocusHighlightConfig } = await getModule();
      const focusMap = new Map<string, FocusHighlight>([
        [
          'text-1',
          {
            actorId: 'user-alice',
            actorName: 'Alice',
            color: '#ff0000',
            isEditing: false,
          },
        ],
        [
          'image-1',
          {
            actorId: 'user-bob',
            actorName: 'Bob',
            color: '#00ff00',
            isEditing: true,
          },
        ],
      ]);

      const wrappedConfig = createFocusHighlightConfig(mockConfig, focusMap);

      // Render text component
      const textResult = wrappedConfig.components.Text.render({
        id: 'text-1',
        content: 'Hello',
      });
      const { container: textContainer } = render(textResult);
      expect(textContainer.querySelector('[data-actor-id="user-alice"]')).not.toBeNull();

      // Render image component
      const imageResult = wrappedConfig.components.Image.render({
        id: 'image-1',
        src: '/img.png',
        alt: 'Test',
      });
      const { container: imageContainer } = render(imageResult);
      expect(imageContainer.querySelector('[data-actor-id="user-bob"]')).not.toBeNull();
      expect(
        imageContainer.querySelector('.focus-region-highlight--editing')
      ).not.toBeNull();

      // Button not focused - should not have wrapper
      const buttonResult = wrappedConfig.components.Button.render({
        id: 'button-1',
        label: 'Click',
      });
      const { container: buttonContainer } = render(buttonResult);
      expect(buttonContainer.querySelector('.focus-region-highlight--inactive')).not.toBeNull();
    });
  });

  describe('empty focus map', () => {
    it('should work correctly with empty focus map', async () => {
      const { createFocusHighlightConfig } = await getModule();
      const focusMap = new Map<string, FocusHighlight>();

      const wrappedConfig = createFocusHighlightConfig(mockConfig, focusMap);

      // Should still have wrapped components
      expect(wrappedConfig.components.Text).toBeDefined();

      // Rendering should work without highlights
      const result = wrappedConfig.components.Text.render({
        id: 'text-1',
        content: 'Hello',
      });
      const { container } = render(result);
      expect(container.querySelector('[data-testid="text-1"]')).not.toBeNull();
      expect(container.querySelector('.focus-region-highlight--inactive')).not.toBeNull();
    });
  });
});
