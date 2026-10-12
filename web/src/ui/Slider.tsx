import * as RSl from '@radix-ui/react-slider';
import { cn } from './cn';

export interface SliderProps {
  value: number;
  onValueChange: (v: number) => void;
  /** Fires once on release; use it to commit expensive updates. */
  onValueCommit?: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
  'aria-label'?: string;
  className?: string;
}

export function Slider({ value, onValueChange, onValueCommit, min = 0, max = 100, step = 1, disabled, className, ...aria }: SliderProps) {
  return (
    <RSl.Root
      value={[value]}
      min={min}
      max={max}
      step={step}
      disabled={disabled}
      onValueChange={(v) => onValueChange(v[0] ?? min)}
      onValueCommit={(v) => onValueCommit?.(v[0] ?? min)}
      className={cn('relative flex h-5 w-full touch-none select-none items-center disabled:opacity-45', className)}
    >
      <RSl.Track className="relative h-[3px] grow rounded-full bg-surface-3">
        <RSl.Range className="absolute h-full rounded-full bg-accent" />
      </RSl.Track>
      <RSl.Thumb {...aria} className="block h-3.5 w-3.5 rounded-full border border-accent bg-bg transition-transform duration-150 ease-out hover:scale-110" />
    </RSl.Root>
  );
}
