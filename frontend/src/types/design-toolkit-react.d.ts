/**
 * Type declarations for @pantheon-systems/design-toolkit-react
 *
 * This package doesn't ship with TypeScript types, so we declare them here.
 * These are simplified declarations covering the components we use.
 */

declare module '@pantheon-systems/design-toolkit-react' {
  import { ComponentType, ReactNode, MouseEvent, ChangeEvent, FocusEvent } from 'react';

  // Button types
  export type ButtonType = 'primary' | 'secondary' | 'danger' | 'warning' | 'subtle' | 'tertiary' | 'primary-alternate';

  export interface ButtonProps {
    children: ReactNode;
    type?: ButtonType;
    disabled?: boolean;
    isLoading?: boolean;
    isSubmit?: boolean;
    onClick?: (e: MouseEvent<HTMLButtonElement>) => void;
    className?: string;
    'data-testid'?: string;
  }

  export const Button: ComponentType<ButtonProps>;
  export const ButtonPrimary: ComponentType<ButtonProps>;
  export const ButtonSecondary: ComponentType<ButtonProps>;
  export const ButtonDanger: ComponentType<ButtonProps>;
  export const ButtonWarning: ComponentType<ButtonProps>;
  export const ButtonSubtle: ComponentType<ButtonProps>;
  export const ButtonTertiary: ComponentType<ButtonProps>;
  export const SubmitButton: ComponentType<ButtonProps>;
  export const SubmitButtonPrimary: ComponentType<ButtonProps>;
  export const SubmitButtonSecondary: ComponentType<ButtonProps>;
  export const SubmitButtonDanger: ComponentType<ButtonProps>;

  // Modal types
  export interface ModalProps {
    ariaLabel: string;
    children: ReactNode;
    isOpen?: boolean;
    onDismiss?: () => void;
    size?: 'small' | 'medium' | 'large';
  }

  export const Modal: ComponentType<ModalProps>;

  export interface ModalHeaderProps {
    children?: ReactNode;
    title?: string;
    className?: string;
  }

  export const ModalHeader: ComponentType<ModalHeaderProps>;

  export interface ModalContentProps {
    children: ReactNode;
    className?: string;
  }

  export const ModalContent: ComponentType<ModalContentProps>;

  // TextInput types
  export interface TextInputProps {
    id?: string;
    name?: string;
    label?: string;
    value?: string;
    defaultValue?: string;
    placeholder?: string;
    disabled?: boolean;
    required?: boolean;
    type?: 'text' | 'email' | 'password' | 'number' | 'tel' | 'url' | 'search';
    onChange?: (e: ChangeEvent<HTMLInputElement>) => void;
    onBlur?: (e: FocusEvent<HTMLInputElement>) => void;
    onFocus?: (e: FocusEvent<HTMLInputElement>) => void;
    className?: string;
    error?: string;
    helpText?: string;
    'data-testid'?: string;
  }

  export const TextInput: ComponentType<TextInputProps>;

  // SelectField types
  export interface SelectOption {
    label: string;
    value: string;
    disabled?: boolean;
  }

  export interface SelectFieldProps {
    id?: string;
    name?: string;
    label?: string;
    value?: string;
    defaultValue?: string;
    options: SelectOption[];
    placeholder?: string;
    disabled?: boolean;
    required?: boolean;
    onChange?: (e: ChangeEvent<HTMLSelectElement>) => void;
    className?: string;
    error?: string;
    helpText?: string;
    'data-testid'?: string;
  }

  export const SelectField: ComponentType<SelectFieldProps>;

  // Alert types
  export type AlertType = 'info' | 'success' | 'warning' | 'danger';

  export interface AlertProps {
    children: ReactNode;
    type?: AlertType;
    title?: string;
    dismissible?: boolean;
    onDismiss?: () => void;
    className?: string;
  }

  export const Alert: ComponentType<AlertProps>;

  // Table types
  export interface TableProps {
    children: ReactNode;
    className?: string;
  }

  export const Table: ComponentType<TableProps>;

  // Tag types
  export interface TagProps {
    children: ReactNode;
    className?: string;
  }

  export const Tag: ComponentType<TagProps>;
  export const TagSubtle: ComponentType<TagProps>;

  // Breadcrumbs types
  export interface BreadcrumbItem {
    label: string;
    href?: string;
    onClick?: () => void;
  }

  export interface BreadcrumbsProps {
    items: BreadcrumbItem[];
    className?: string;
  }

  export const Breadcrumbs: ComponentType<BreadcrumbsProps>;

  // Toast/Toaster types
  export interface ToastProps {
    children: ReactNode;
    type?: 'info' | 'success' | 'warning' | 'error';
  }

  export const Toast: ComponentType<ToastProps>;
  export const Toaster: ComponentType<{ children: ReactNode }>;
  export function useToast(): {
    addToast: (message: string, options?: { type?: string }) => void;
    removeToast: (id: string) => void;
  };

  // Tabs types
  export interface TabProps {
    children: ReactNode;
    disabled?: boolean;
  }

  export const Tab: ComponentType<TabProps>;
  export const Tabs: ComponentType<{ children: ReactNode; index?: number; onChange?: (index: number) => void }>;
  export const TabList: ComponentType<{ children: ReactNode }>;
  export const TabPanel: ComponentType<{ children: ReactNode }>;
  export const TabPanels: ComponentType<{ children: ReactNode }>;

  // Panel types
  export interface PanelProps {
    children: ReactNode;
    className?: string;
  }

  export const Panel: ComponentType<PanelProps>;
  export const PanelHeader: ComponentType<PanelProps>;

  // Card types
  export interface CardProps {
    children: ReactNode;
    className?: string;
  }

  export const Card: ComponentType<CardProps>;
  export const CardContent: ComponentType<CardProps>;
  export const CardFooter: ComponentType<CardProps>;

  // FormGroup types
  export interface FormGroupProps {
    children: ReactNode;
    className?: string;
  }

  export const FormGroup: ComponentType<FormGroupProps>;
  export const InputGroup: ComponentType<FormGroupProps>;

  // CustomTextArea types
  export interface CustomTextAreaProps {
    id?: string;
    name?: string;
    label?: string;
    value?: string;
    defaultValue?: string;
    placeholder?: string;
    disabled?: boolean;
    required?: boolean;
    rows?: number;
    onChange?: (e: ChangeEvent<HTMLTextAreaElement>) => void;
    className?: string;
    error?: string;
    helpText?: string;
    'data-testid'?: string;
  }

  export const CustomTextArea: ComponentType<CustomTextAreaProps>;
}
