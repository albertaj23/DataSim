import * as RS from '@radix-ui/react-select';
import { Check, ChevronDown } from 'lucide-react';
import { cn } from './cn';

export interface SelectOption<V extends string = string> { value: V; label: string; hint?: string; disabled?: boolean }

export interface SelectProps<V extends string = string> {
  value: V;
  onValueChange: (v: V) => void;
  options: SelectOption<V>[];
  placeholder?: string;
  disabled?: boolean;
  id?: string;
  'aria-label'?: string;
  size?: 'sm' | 'md';
  mono?: boolean;
  className?: string;
}

export function Select<V extends string = string>({ value, onValueChange, options, placeholder, disabled, id, size = 'md', mono, className, ...aria }: SelectProps<V>) {
  return (
    <RS.Root value={value} onValueChange={(v) => onValueChange(v as V)} disabled={disabled}>
      <RS.Trigger
        id={id}
        {...aria}
        className={cn(
          'inline-flex w-full items-center justify-between gap-2 rounded-md border border-line bg-surface px-2.5 text-sm text-fg transition-colors duration-150 ease-out hover:border-line-strong focus-visible:border-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent disabled:opacity-45 data-[placeholder]:text-faint',
          size === 'sm' ? 'h-7' : 'h-8',
          mono && 'font-mono',
          className,
        )}
      >
        <span className="truncate"><RS.Value placeholder={placeholder} /></span>
        <RS.Icon><ChevronDown size={14} className="text-faint" /></RS.Icon>
      </RS.Trigger>
      <RS.Portal>
        <RS.Content position="popper" sideOffset={4} collisionPadding={8} className="z-[80] max-h-[280px] min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-lg border border-line bg-surface-2 p-1">
          <RS.Viewport>
            {options.map((o) => (
              <RS.Item
                key={o.value}
                value={o.value}
                disabled={o.disabled}
                className={cn('relative flex h-7 cursor-default select-none items-center gap-2 rounded-md pl-2 pr-7 text-sm text-fg outline-none data-[disabled]:opacity-40 data-[highlighted]:bg-surface-3', mono && 'font-mono')}
              >
                <RS.ItemText>{o.label}</RS.ItemText>
                {o.hint && <span className="ml-auto text-xs text-faint">{o.hint}</span>}
                <RS.ItemIndicator className="absolute right-2"><Check size={14} className="text-accent" /></RS.ItemIndicator>
              </RS.Item>
            ))}
          </RS.Viewport>
        </RS.Content>
      </RS.Portal>
    </RS.Root>
  );
}
