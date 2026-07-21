import type { ReactNode, ReactElement, ComponentPropsWithoutRef, MouseEvent, ForwardRefExoticComponent, RefAttributes } from 'react';

/**
 * Module augmentation to expose components from @pantheon-systems/pds-toolkit-react
 * whose .d.ts files import CSS files (e.g. react-toastify, relative .css) that
 * TypeScript cannot resolve from outside node_modules. The augmentations below
 * make the types available without relying on that broken resolution chain.
 */
declare module '@pantheon-systems/pds-toolkit-react' {
  // ---------------------------------------------------------------------------
  // Toaster / useToast / ToastType
  // ---------------------------------------------------------------------------

  // Declared as a const object (not enum) because TypeScript module augmentations
  // do not allow enum declarations.
  export declare const ToastType: {
    readonly Critical: 'critical';
    readonly Info: 'info';
    readonly Success: 'success';
    readonly Warning: 'warning';
    readonly Working: 'working';
  };
  export type ToastType = (typeof ToastType)[keyof typeof ToastType];

  export interface ToasterProps extends ComponentPropsWithoutRef<'div'> {
    autoCloseDuration?: number | false;
    className?: string;
    limit?: number;
    position?: 'bottom-right' | 'top-right';
  }
  export declare const Toaster: (props: ToasterProps) => ReactElement;

  export interface ToastApiLike {
    dismiss(id?: string | number): void;
  }
  export declare const useToast: () => [
    (
      type: (typeof ToastType)[keyof typeof ToastType],
      message: string | ReactElement,
      options?: { toastId?: string | number; autoClose?: number | false },
    ) => string | number,
    ToastApiLike,
    unknown,
  ];

  export interface PDSTooltipProps {
    content: string;
    customTrigger?: ReactNode;
    preferredPlacement?: 'top' | 'bottom' | 'left' | 'right' | 'top-start' | 'top-end' | 'bottom-start' | 'bottom-end';
    offsetValue?: number | { mainAxis?: number; crossAxis?: number; alignmentAxis?: number };
    triggerAccessibleText?: string;
    triggerIcon?: 'circleInfo' | 'circleQuestion' | 'circleExclamation';
    triggerIconColor?: 'default' | 'default-secondary' | 'critical';
    triggerIconSize?: 's' | 'm' | 'l';
    zIndex?: number;
    className?: string;
  }
  export const Tooltip: (props: PDSTooltipProps) => JSX.Element;

  export interface IconButtonProps extends ComponentPropsWithoutRef<'button'> {
    ariaLabel: string;
    buttonType?: 'button' | 'submit' | 'reset';
    className?: string;
    disabled?: boolean;
    hasBorder?: boolean;
    hasTooltip?: boolean;
    icon2Name?: string;
    iconName: string;
    onClick?: (e: MouseEvent<HTMLElement>) => void;
    size?: 's' | 'm';
    variant?: 'standard' | 'reverse' | 'critical';
  }
  export const IconButton: ForwardRefExoticComponent<IconButtonProps & RefAttributes<HTMLButtonElement>>;
}
