/**
 * Stub module for @pantheon-systems/pds-toolkit-react.
 * Individual tests override these with vi.mock() as needed.
 * This file exists only to satisfy module resolution during testing —
 * the real package is a peer dependency not installed in dev.
 */
import * as React from 'react';

export const TextInput = () => null;
export const Textarea = () => null;
export const Select = () => null;
export const RadioGroup = () => null;
// SegmentedButton stub: renders radio-like buttons for value-based selection testing
export const SegmentedButton = (props: Record<string, unknown>) => {
  const options = (props.options ?? []) as { label: string; value: string; disabled?: boolean }[];
  const isActive = (value: string) => props.value === value;
  return React.createElement(
    'div',
    { id: props.id as string, role: 'group', 'aria-label': props.label as string },
    ...options.map((opt) =>
      React.createElement(
        'button',
        {
          key: opt.value,
          type: 'button',
          className: [
            'pds-button',
            'pds-button--secondary',
            'pds-button--sm',
            isActive(opt.value) ? 'pds-button--active' : '',
          ]
            .filter(Boolean)
            .join(' '),
          'aria-pressed': isActive(opt.value),
          disabled: opt.disabled ?? false,
          onClick: () => {
            if (!opt.disabled) {
              (props.onChange as (v: string) => void)?.(opt.value);
            }
          },
        },
        opt.label,
      ),
    ),
  );
};
export const Icon = () => null;
export const PantheonLogo = (props: Record<string, unknown>) => {
  return React.createElement('span', { 'data-testid': props['data-testid'], className: 'pds-pantheon-logo' });
};
// IconButton stub: renders a <button> forwarding data-testid, aria-label, disabled, onClick
export const IconButton = (props: Record<string, unknown>) => {
  return React.createElement('button', {
    'data-testid': props['data-testid'],
    'aria-label': props.ariaLabel,
    disabled: props.disabled,
    onClick: props.onClick,
    type: 'button',
  });
};
// Button stub: renders a <button> so data-testid, onClick, etc. are accessible in tests
export const Button = (props: Record<string, unknown>) => {
  return React.createElement(
    'button',
    {
      'data-testid': props['data-testid'],
      onClick: props.onClick,
      type: props.buttonType ?? 'button',
      'aria-label': props.ariaLabel ?? props.label,
      disabled: props.disabled,
    },
    props.label as string,
  );
};

// Avatar stub: renders a div with the PDS avatar class structure
export const Avatar = (props: Record<string, unknown>) => {
  const size = (props.size as string) ?? 's';
  const hasImage = !!props.imageSrc;
  return React.createElement(
    'div',
    {
      className: `pds-avatar pds-avatar--${size}${hasImage ? ' pds-avatar--image' : ''}`,
      'data-testid': props['data-testid'],
    },
    React.createElement(
      'span',
      { className: 'pds-avatar__content' },
      hasImage
        ? React.createElement('img', { alt: '', className: 'pds-avatar__image', src: props.imageSrc as string })
        : props.hasUserFallback
          ? React.createElement('span', { className: 'pds-avatar__user-icon' }, '👤')
          : null,
    ),
  );
};

// Tooltip stub: wraps trigger in a span with title so getByTitle works in tests
export const Tooltip = (props: Record<string, unknown>) => {
  return React.createElement(
    'span',
    { title: props.content as string },
    props.customTrigger ?? props.children,
  );
};

// StatusIndicator stub: renders a div with dot + label matching the real component's structure
export const StatusIndicator = (props: Record<string, unknown>) => {
  const type = (props.type as string) ?? 'neutral';
  return React.createElement(
    'div',
    { className: `pds-status-indicator pds-status-indicator--${type}`, 'data-testid': props['data-testid'] },
    React.createElement('span', { 'aria-hidden': 'true', className: 'pds-status-indicator__icon', role: 'img' }),
    props.label && React.createElement('span', { className: 'pds-status-indicator__label' }, props.label as string),
  );
};

interface MockMenuItem {
  label: string;
  description?: string;
  callback?: (item?: MockMenuItem) => void;
  iconName?: string;
  disabled?: boolean;
  isSeparator?: boolean;
  isHeading?: boolean;
}

// MenuButton stub: renders trigger button with label + menu items inline for testing
export const MenuButton = (props: Record<string, unknown>) => {
  const items = (props.menuItems ?? []) as MockMenuItem[];
  return React.createElement(
    'span',
    { className: 'pds-menu-button', 'data-testid': props.testId, id: props.id },
    React.createElement(
      'button',
      {
        type: 'button',
        className: 'pds-button pds-menu-button__trigger',
        'aria-haspopup': 'true',
        disabled: props.disabled,
      },
      props.label,
    ),
    React.createElement(
      'ul',
      { role: 'menu' },
      ...items
        .filter((item: MockMenuItem) => !item.isSeparator && !item.isHeading)
        .map((item: MockMenuItem) =>
          React.createElement(
            'li',
            {
              key: item.label,
              role: 'menuitem',
              onClick: () => item.callback?.(item),
            },
            item.label,
          ),
        ),
    ),
  );
};

// SectionMessage stub: renders a status container and passes through message content
export const SectionMessage = (props: Record<string, unknown>) => {
  return React.createElement(
    'div',
    { className: 'pds-section-message', role: 'status', id: props.id as string },
    props.message,
  );
};

// Toaster stub: renders nothing (toasts are tested via __toastCalls)
export const Toaster = () => null;

// ToastType enum matching the real PDS values
export const ToastType = {
  Critical: 'critical',
  Info: 'info',
  Success: 'success',
  Warning: 'warning',
  Working: 'working',
} as const;

// useToast stub: captures calls in __toastCalls for test inspection
export const __toastCalls: {
  type: string;
  content: unknown;
  options?: Record<string, unknown>;
}[] = [];
export const __mockToastApi = { dismiss: () => {} };

export const useToast = () => {
  const addToast = (type: string, content: unknown, options?: Record<string, unknown>) => {
    __toastCalls.push({ type, content, options });
    return '';
  };
  return [addToast, __mockToastApi, () => {}] as const;
};

// InlineMessage stub: renders title + optional message with type as data attribute
export const InlineMessage = (props: Record<string, unknown>) => {
  return React.createElement(
    'div',
    { role: props.type === 'critical' ? 'alert' : 'status', 'data-type': props.type as string },
    React.createElement('span', null, props.title),
    props.message && React.createElement('span', null, props.message),
  );
};

// UtilityButton stub: renders a button with label and onClick
export const UtilityButton = (props: Record<string, unknown>) => {
  const extraProps = (props.buttonProps ?? {}) as Record<string, unknown>;
  return React.createElement(
    'button',
    {
      type: 'button',
      'data-testid': props['data-testid'],
      onClick: props.onClick,
      disabled: props.disabled,
      ...extraProps,
    },
    props.label as string,
  );
};

// SplitButton stub: renders primary button + menu trigger + hidden menu items
export const SplitButton = (props: Record<string, unknown>) => {
  const [menuOpen, setMenuOpen] = React.useState(false);
  const items = (props.actionItems ?? []) as MockMenuItem[];
  const primary = items[0];
  const menuItems = items.slice(1);
  return React.createElement(
    'span',
    { className: 'pds-split-button', id: props.id, 'data-testid': props['data-testid'] },
    primary &&
      React.createElement(
        'button',
        {
          type: 'button',
          'aria-label': primary.label,
          disabled: props.disabled,
          onClick: () => primary.callback?.(),
        },
        primary.label,
      ),
    menuItems.length > 0 &&
      React.createElement(
        'button',
        {
          type: 'button',
          'aria-label': (props.moreActionsLabel as string) ?? 'More actions',
          onClick: () => setMenuOpen((prev: boolean) => !prev),
        },
      ),
    menuOpen &&
      React.createElement(
        'div',
        { role: 'menu' },
        ...menuItems.map((item: MockMenuItem) =>
          React.createElement(
            'button',
            {
              key: item.label,
              type: 'button',
              role: 'menuitem',
              disabled: item.disabled,
              onClick: () => { if (!item.disabled) item.callback?.(); },
            },
            item.label,
          ),
        ),
      ),
  );
};
