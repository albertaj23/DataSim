import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from './cn';
import { Tooltip } from './Tooltip';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md';

const base =
  'inline-flex shrink-0 select-none items-center justify-center gap-1.5 whitespace-nowrap rounded-md border text-sm font-medium transition-colors duration-150 ease-out disabled:pointer-events-none disabled:opacity-45 [&_svg]:shrink-0';
const variants: Record<ButtonVariant, string> = {
  primary: 'border-transparent bg-accent text-accent-fg hover:bg-accent/85',
  secondary: 'border-line bg-surface-2 text-fg hover:border-line-strong hover:bg-surface-3',
  ghost: 'border-transparent bg-transparent text-muted hover:bg-surface-2 hover:text-fg',
  danger: 'border-bad/40 bg-bad/10 text-bad hover:bg-bad/20',
};
const sizes: Record<ButtonSize, string> = { sm: 'h-7 px-2.5', md: 'h-8 px-3' };
const iconSizes: Record<ButtonSize, string> = { sm: 'h-7 w-7', md: 'h-8 w-8' };

/** `iconOnly` gives a square button (no horizontal padding). */
export function buttonClass(variant: ButtonVariant = 'secondary', size: ButtonSize = 'md', extra?: string, iconOnly = false) {
  return cn(base, variants[variant], (iconOnly ? iconSizes : sizes)[size], extra);
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Leading icon (a lucide element, size 16). */
  icon?: ReactNode;
  /** Shows a spinner, disables the button and sets aria-busy. */
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', icon, loading, disabled, className, children, type = 'button', ...rest },
  ref,
) {
  return (
    <button ref={ref} type={type} disabled={disabled || loading} aria-busy={loading || undefined} className={buttonClass(variant, size, className)} {...rest}>
      {loading ? <Loader2 size={14} strokeWidth={1.5} className="ds-spin" /> : icon}
      {children}
    </button>
  );
});

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  /** Required: used as aria-label and tooltip text. */
  label: string;
  icon: ReactNode;
  variant?: ButtonVariant;
  size?: ButtonSize;
  shortcut?: string;
  tooltipSide?: 'top' | 'right' | 'bottom' | 'left';
  loading?: boolean;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, icon, variant = 'ghost', size = 'md', shortcut, tooltipSide = 'top', loading, disabled, className, type = 'button', ...rest },
  ref,
) {
  const dim = size === 'sm' ? 'h-7 w-7' : 'h-8 w-8';
  return (
    <Tooltip content={label} side={tooltipSide} shortcut={shortcut}>
      <button
        ref={ref}
        type={type}
        aria-label={label}
        disabled={disabled || loading}
        className={cn(base, variants[variant], dim, className)}
        {...rest}
      >
        {loading ? <Loader2 size={14} strokeWidth={1.5} className="ds-spin" /> : icon}
      </button>
    </Tooltip>
  );
});
