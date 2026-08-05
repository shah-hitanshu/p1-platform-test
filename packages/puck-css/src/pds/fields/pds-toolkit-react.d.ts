/**
 * Ambient type declarations for @pantheon-systems/pds-toolkit-react.
 * This peer dependency is not installed in dev; these declarations satisfy
 * the TypeScript compiler for the components used in this package.
 */
declare module '@pantheon-systems/pds-toolkit-react' {
  import type { FC, SVGProps } from 'react';

  export interface TextInputProps {
    id?: string;
    value?: string;
    type?: string;
    onChange?: (e: { target: { value: string } }) => void;
    disabled?: boolean;
    [key: string]: unknown;
  }

  export interface TextareaProps {
    id?: string;
    value?: string;
    onChange?: (e: { target: { value: string } }) => void;
    disabled?: boolean;
    [key: string]: unknown;
  }

  export interface SelectOption {
    label: string;
    value: string;
  }

  export interface SelectProps {
    id?: string;
    value?: string;
    options?: SelectOption[];
    onOptionSelect?: (opt: SelectOption) => void;
    disabled?: boolean;
    [key: string]: unknown;
  }

  export interface RadioOption {
    id?: string;
    label: string;
    value: string;
  }

  export interface RadioGroupProps {
    value?: string;
    onValueChange?: (value: string) => void;
    options?: RadioOption[];
    disabled?: boolean;
    [key: string]: unknown;
  }

  export interface SegmentedButtonOption {
    label: string;
    value: string;
    disabled?: boolean;
  }

  export interface SegmentedButtonProps {
    id: string;
    label: string;
    options: SegmentedButtonOption[];
    value?: string;
    onChange?: (value: string) => void;
    disabled?: boolean;
    size?: 's' | 'm';
    className?: string;
    [key: string]: unknown;
  }

  export const TextInput: FC<TextInputProps>;
  export const Textarea: FC<TextareaProps>;
  export const Select: FC<SelectProps>;
  export const RadioGroup: FC<RadioGroupProps>;
  export const SegmentedButton: FC<SegmentedButtonProps>;
  // `size` (not `iconSize`) is the real prop name — the component destructures
  // `size` and spreads the rest onto the <svg>, so a misspelling silently lands
  // in the DOM and React warns about an unknown attribute. Typed as the union
  // rather than `string` so a bad value fails at compile time.
  export const Icon: FC<
    { iconName: string; size?: 's' | 'm' | 'l' | 'xl' | '2xl' | '3xl' } & SVGProps<SVGSVGElement>
  >;
  export interface MenuItemType {
    label: string;
    description?: string;
    callback?: (item?: MenuItemType) => void;
    disabled?: boolean;
    iconName?: string;
    id?: string;
    isCritical?: boolean;
    criticalLabel?: string;
    testId?: string;
  }

  export const SplitButton: FC<{
    actionItems: MenuItemType[];
    className?: string;
    disabled?: boolean;
    id: string;
    moreActionsLabel?: string;
    size?: 's' | 'm';
    variant?: 'primary' | 'secondary';
    [key: string]: unknown;
  }>;

  export type StatusType = 'info' | 'success' | 'warning' | 'critical' | 'discovery';

  export const StatusIndicator: FC<{
    className?: string;
    label: string;
    size?: 'xs' | 's';
    type: StatusType | 'disabled' | 'neutral' | 'working';
    [key: string]: unknown;
  }>;

  export const Avatar: FC<{
    ariaLabel?: string;
    className?: string;
    hasUserFallback?: boolean;
    imageSrc?: string;
    linkContent?: import('react').ReactNode;
    size?: 'xs' | 's' | 'm' | 'l';
    uniqueId?: string;
    [key: string]: unknown;
  }>;

  export interface HeadingItemType {
    isHeading: true;
    label: string;
  }

  export interface SeparatorItemType {
    isSeparator: true;
  }

  export interface LinkItemType {
    isLink: true;
    linkContent: import('react').ReactNode;
    id?: string;
    testId?: string;
    description?: string;
    disabled?: boolean;
    iconName?: string;
  }

  export interface NodeItemType {
    isNode: true;
    nodeContent: import('react').ReactNode;
    isCritical?: boolean;
    criticalLabel?: string;
  }

  export type MenuButtonItemType =
    | MenuItemType
    | HeadingItemType
    | SeparatorItemType
    | LinkItemType
    | NodeItemType;

  export const MenuButton: FC<{
    className?: string;
    disabled?: boolean;
    displayType?: 'icon-end' | 'icon-only';
    iconName?: string;
    id: string;
    isSplitButton?: boolean;
    label: import('react').ReactNode;
    menuItems: MenuButtonItemType[];
    menuPosition?: 'start' | 'end';
    onClick?: () => void;
    size?: 's' | 'm';
    testId?: string;
    undefinedLabel?: string;
    variant?: 'primary' | 'secondary' | 'navbar';
    withinNavbar?: boolean;
    [key: string]: unknown;
  }>;

  export const Button: FC<{
    label: import('react').ReactNode;
    variant?: 'primary' | 'secondary' | 'subtle' | 'brand' | 'critical' | 'navbar' | 'inline';
    size?: 'sm' | 'md' | 'lg';
    onClick?: (e: import('react').MouseEvent<HTMLElement>) => void;
    disabled?: boolean;
    buttonType?: 'button' | 'submit' | 'reset';
    ariaLabel?: string;
    displayType?: string;
    iconName?: string;
    isLoading?: boolean;
    isFullWidth?: boolean;
    [key: string]: unknown;
  }>;

  export type InlineMessageType = 'info' | 'success' | 'warning' | 'critical' | 'working';

  export const InlineMessage: FC<{
    type: InlineMessageType;
    title: import('react').ReactNode;
    message?: import('react').ReactNode;
    className?: string;
    [key: string]: unknown;
  }>;

  export type PantheonLogoDisplayType = 'full' | 'icon' | 'wordmark' | 'sub-brand' | 'sub-brand-small';

  export const PantheonLogo: FC<{
    className?: string;
    colorType?: 'default' | 'reverse';
    displayType?: PantheonLogoDisplayType;
    linkContent?: import('react').ReactNode;
    subBrand?: import('react').ReactNode | string;
    'data-testid'?: string;
    [key: string]: unknown;
  }>;

  export const UtilityButton: FC<{
    label: string;
    onClick?: () => void;
    disabled?: boolean;
    hasBorder?: boolean;
    iconName?: string;
    iconPosition?: 'before' | 'after';
    isCritical?: boolean;
    isLoading?: boolean;
    isWorking?: boolean;
    isMonospace?: boolean;
    tooltipText?: string;
    className?: string;
    buttonProps?: import('react').ButtonHTMLAttributes<HTMLButtonElement>;
    linkContent?: import('react').ReactNode;
    [key: string]: unknown;
  }>;
}
