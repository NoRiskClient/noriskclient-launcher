import { cn } from "../../lib/utils";

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
}

interface SegmentedControlProps<T extends string> {
  options: SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  disabled?: boolean;
  stretch?: boolean;
  ariaLabel?: string;
}

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  disabled = false,
  stretch = false,
  ariaLabel,
}: SegmentedControlProps<T>) {
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className={cn(
        "gap-1 p-1 rounded-lg bg-black/40 border border-white/10",
        stretch ? "grid" : "inline-flex",
        disabled && "opacity-50",
      )}
      style={stretch ? { gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` } : undefined}
    >
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="tab"
            aria-selected={selected}
            disabled={disabled}
            onClick={() => !selected && onChange(option.value)}
            className={cn(
              "rounded-md font-minecraft normal-case transition-colors truncate",
              "px-3 py-2 text-sm",
              selected ? "bg-white/10 text-white cursor-default" : "text-white/45 hover:text-white/80 hover:bg-white/5",
              disabled && "pointer-events-none",
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

export function FieldLabel({ htmlFor, children }: { htmlFor?: string; children: string }) {
  return (
    <label htmlFor={htmlFor} className="block font-minecraft text-sm normal-case text-white/60">
      {children}
    </label>
  );
}
