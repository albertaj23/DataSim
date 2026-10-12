import * as RSw from '@radix-ui/react-switch';
import { cn } from './cn';

export interface SwitchProps {
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
  disabled?: boolean;
  id?: string;
  'aria-label'?: string;
  className?: string;
}

export function Switch({ checked, onCheckedChange, disabled, id, className, ...aria }: SwitchProps) {
  return (
    <RSw.Root
      id={id}
      checked={checked}
      onCheckedChange={onCheckedChange}
      disabled={disabled}
      {...aria}
      className={cn('inline-flex h-[18px] w-8 shrink-0 items-center rounded-full border border-line bg-surface-3 transition-colors duration-150 ease-out data-[state=checked]:border-accent data-[state=checked]:bg-accent disabled:opacity-45', className)}
    >
      <RSw.Thumb className="block h-3 w-3 translate-x-[2px] rounded-full bg-muted transition-transform duration-150 ease-out data-[state=checked]:translate-x-[16px] data-[state=checked]:bg-accent-fg" />
    </RSw.Root>
  );
}
