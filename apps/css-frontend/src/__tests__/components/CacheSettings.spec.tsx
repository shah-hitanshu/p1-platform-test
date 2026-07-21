/**
 * CacheSettings Component Tests (TDD - Red Phase)
 *
 * Tests for the CacheSettings component that manages
 * per-site CDN/ISR cache TTL configuration.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CacheSettings } from '../../components/CacheSettings';

vi.mock('@pantheon-systems/pds-toolkit-react', () => ({
  Spinner: ({ label, ...props }: Record<string, unknown>) => (
    <div role="status" aria-label={label as string} {...props} />
  ),
  Button: ({ label, children, onClick, disabled, isLoading, ...props }: Record<string, unknown>) => (
    <button
      onClick={onClick as () => void}
      disabled={(disabled as boolean) || (isLoading as boolean)}
      {...props}
    >
      {(label as string) || (children as React.ReactNode)}
    </button>
  ),
  TextInput: ({ label, value, onChange, disabled, placeholder, id, validationMessage, inputProps, ...props }: Record<string, unknown>) => (
    <div>
      <label htmlFor={id as string}>{label as React.ReactNode}</label>
      <input
        id={id as string}
        value={value as string}
        onChange={onChange as React.ChangeEventHandler<HTMLInputElement>}
        disabled={disabled as boolean}
        placeholder={placeholder as string}
        {...(inputProps as Record<string, unknown>)}
        {...props}
      />
      {validationMessage && <span>{validationMessage as string}</span>}
    </div>
  ),
}));

describe('CacheSettings', () => {
  const defaultProps = {
    settings: null,
    isLoading: false,
    onSave: vi.fn().mockResolvedValue(undefined),
    isSaving: false,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    defaultProps.onSave = vi.fn().mockResolvedValue(undefined);
  });

  describe('rendering with existing settings', () => {
    it('should display existing cache TTL values in the inputs', () => {
      render(
        <CacheSettings
          {...defaultProps}
          settings={{ cacheTtlMain: 120, cacheTtlBranch: 10 }}
        />
      );

      const mainInput = screen.getByTestId('cache-ttl-main-input') as HTMLInputElement;
      const branchInput = screen.getByTestId('cache-ttl-branch-input') as HTMLInputElement;

      expect(mainInput.value).toBe('120');
      expect(branchInput.value).toBe('10');
    });
  });

  describe('rendering with null/empty settings', () => {
    it('should show default placeholder values when settings are null', () => {
      render(<CacheSettings {...defaultProps} settings={null} />);

      const mainInput = screen.getByTestId('cache-ttl-main-input') as HTMLInputElement;
      const branchInput = screen.getByTestId('cache-ttl-branch-input') as HTMLInputElement;

      expect(mainInput.placeholder).toBe('60');
      expect(branchInput.placeholder).toBe('5');
      expect(mainInput.value).toBe('');
      expect(branchInput.value).toBe('');
    });

    it('should show default placeholders when settings object has undefined values', () => {
      render(
        <CacheSettings
          {...defaultProps}
          settings={{ cacheTtlMain: undefined, cacheTtlBranch: undefined }}
        />
      );

      const mainInput = screen.getByTestId('cache-ttl-main-input') as HTMLInputElement;
      const branchInput = screen.getByTestId('cache-ttl-branch-input') as HTMLInputElement;

      expect(mainInput.placeholder).toBe('60');
      expect(branchInput.placeholder).toBe('5');
    });
  });

  describe('input labels', () => {
    it('should display labels for both TTL inputs', () => {
      render(<CacheSettings {...defaultProps} settings={null} />);

      expect(screen.getByLabelText(/main branch cache ttl/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/preview branch cache ttl/i)).toBeInTheDocument();
    });
  });

  describe('explanation text', () => {
    it('should display brief explanation about CDN/ISR caching', () => {
      render(<CacheSettings {...defaultProps} settings={null} />);

      const explanation = screen.getByTestId('cache-settings-description');
      expect(explanation).toBeInTheDocument();
      expect(explanation.textContent).toBeTruthy();
    });
  });

  describe('reset to defaults', () => {
    it('should call onSave with null values when "Reset to defaults" is clicked', async () => {
      const user = userEvent.setup();
      const onSave = vi.fn().mockResolvedValue(undefined);

      render(
        <CacheSettings
          {...defaultProps}
          settings={{ cacheTtlMain: 120, cacheTtlBranch: 10 }}
          onSave={onSave}
        />
      );

      const resetButton = screen.getByTestId('cache-settings-reset-btn');
      expect(resetButton).toBeInTheDocument();

      await user.click(resetButton);

      expect(onSave).toHaveBeenCalledWith({
        cacheTtlMain: null,
        cacheTtlBranch: null,
      });
    });
  });

  describe('save', () => {
    it('should call onSave with entered values when Save is clicked', async () => {
      const user = userEvent.setup();
      const onSave = vi.fn().mockResolvedValue(undefined);

      render(
        <CacheSettings
          {...defaultProps}
          settings={null}
          onSave={onSave}
        />
      );

      const mainInput = screen.getByTestId('cache-ttl-main-input');
      const branchInput = screen.getByTestId('cache-ttl-branch-input');

      await user.type(mainInput, '300');
      await user.type(branchInput, '15');

      const saveButton = screen.getByTestId('cache-settings-save-btn');
      await user.click(saveButton);

      expect(onSave).toHaveBeenCalledWith({
        cacheTtlMain: 300,
        cacheTtlBranch: 15,
      });
    });

    it('should call onSave with only the filled-in values', async () => {
      const user = userEvent.setup();
      const onSave = vi.fn().mockResolvedValue(undefined);

      render(
        <CacheSettings
          {...defaultProps}
          settings={null}
          onSave={onSave}
        />
      );

      const mainInput = screen.getByTestId('cache-ttl-main-input');
      await user.type(mainInput, '300');

      const saveButton = screen.getByTestId('cache-settings-save-btn');
      await user.click(saveButton);

      await waitFor(() => {
        expect(onSave).toHaveBeenCalled();
      });

      const callArg = onSave.mock.calls[0][0];
      expect(callArg.cacheTtlMain).toBe(300);
    });
  });

  describe('loading state', () => {
    it('should show a loading indicator when isLoading is true', () => {
      render(<CacheSettings {...defaultProps} isLoading={true} />);

      expect(screen.getByTestId('cache-settings-loading')).toBeInTheDocument();
    });

    it('should not show inputs when loading', () => {
      render(<CacheSettings {...defaultProps} isLoading={true} />);

      expect(screen.queryByTestId('cache-ttl-main-input')).not.toBeInTheDocument();
    });
  });

  describe('saving state', () => {
    it('should disable the Save button when isSaving is true', () => {
      render(
        <CacheSettings
          {...defaultProps}
          settings={{ cacheTtlMain: 60, cacheTtlBranch: 5 }}
          isSaving={true}
        />
      );

      const saveButton = screen.getByTestId('cache-settings-save-btn');
      expect(saveButton).toBeDisabled();
    });

    it('should disable the Reset button when isSaving is true', () => {
      render(
        <CacheSettings
          {...defaultProps}
          settings={{ cacheTtlMain: 60, cacheTtlBranch: 5 }}
          isSaving={true}
        />
      );

      const resetButton = screen.getByTestId('cache-settings-reset-btn');
      expect(resetButton).toBeDisabled();
    });
  });

  describe('validation', () => {
    it('should not accept negative numbers', async () => {
      const user = userEvent.setup();
      const onSave = vi.fn().mockResolvedValue(undefined);

      render(
        <CacheSettings
          {...defaultProps}
          settings={null}
          onSave={onSave}
        />
      );

      const mainInput = screen.getByTestId('cache-ttl-main-input');
      await user.type(mainInput, '-10');

      const saveButton = screen.getByTestId('cache-settings-save-btn');
      await user.click(saveButton);

      expect(onSave).not.toHaveBeenCalled();
      expect(screen.getByTestId('cache-settings-validation-error')).toBeInTheDocument();
    });

    it('should not accept zero', async () => {
      const user = userEvent.setup();
      const onSave = vi.fn().mockResolvedValue(undefined);

      render(
        <CacheSettings
          {...defaultProps}
          settings={null}
          onSave={onSave}
        />
      );

      const mainInput = screen.getByTestId('cache-ttl-main-input');
      await user.type(mainInput, '0');

      const saveButton = screen.getByTestId('cache-settings-save-btn');
      await user.click(saveButton);

      expect(onSave).not.toHaveBeenCalled();
      expect(screen.getByTestId('cache-settings-validation-error')).toBeInTheDocument();
    });

    it('should not accept decimal numbers', async () => {
      const user = userEvent.setup();
      const onSave = vi.fn().mockResolvedValue(undefined);

      render(
        <CacheSettings
          {...defaultProps}
          settings={null}
          onSave={onSave}
        />
      );

      const mainInput = screen.getByTestId('cache-ttl-main-input');
      await user.type(mainInput, '1.5');

      const saveButton = screen.getByTestId('cache-settings-save-btn');
      await user.click(saveButton);

      expect(onSave).not.toHaveBeenCalled();
      expect(screen.getByTestId('cache-settings-validation-error')).toBeInTheDocument();
    });

    it('should accept positive integers', async () => {
      const user = userEvent.setup();
      const onSave = vi.fn().mockResolvedValue(undefined);

      render(
        <CacheSettings
          {...defaultProps}
          settings={null}
          onSave={onSave}
        />
      );

      const mainInput = screen.getByTestId('cache-ttl-main-input');
      await user.type(mainInput, '120');

      const saveButton = screen.getByTestId('cache-settings-save-btn');
      await user.click(saveButton);

      await waitFor(() => {
        expect(onSave).toHaveBeenCalled();
      });
    });
  });
});
