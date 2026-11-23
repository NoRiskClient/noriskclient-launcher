import { useRef, useState } from "react";
import { Icon } from "@iconify/react";
import { ThemedDropdown, ThemedDropdownItem } from "../profiles/v3/shared/ThemedDropdown";

export interface FilterOption {
  value: string;
  label: string;
}

export const ALL_FILTER_VALUE = "all";

interface BaseProps {
  options: FilterOption[];
  icon?: string;
  className?: string;
}

interface SingleProps extends BaseProps {
  multiple?: false;
  value: string;
  onChange: (value: string) => void;
}

interface MultiProps extends BaseProps {
  multiple: true;
  value: string[];
  onChange: (value: string[]) => void;
}

export function FilterDropdown(props: SingleProps | MultiProps) {
  const { options, icon, className } = props;
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const selectedValues: string[] = props.multiple === true ? props.value : [props.value];
  const isSelected = (value: string) =>
    value === ALL_FILTER_VALUE ? selectedValues.length === 0 || selectedValues[0] === ALL_FILTER_VALUE : selectedValues.includes(value);
  const labelOf = (value: string) => options.find((option) => option.value === value)?.label ?? value;
  const picked = selectedValues.filter((value) => value !== ALL_FILTER_VALUE);
  const label =
    picked.length === 0
      ? labelOf(ALL_FILTER_VALUE)
      : picked.length === 1
        ? labelOf(picked[0])
        : `${labelOf(picked[0])} +${picked.length - 1}`;

  const pick = (value: string) => {
    if (props.multiple !== true) {
      props.onChange(value);
      setOpen(false);
      return;
    }
    props.onChange(
      value === ALL_FILTER_VALUE ? [] : picked.includes(value) ? picked.filter((v) => v !== value) : [...picked, value],
    );
  };

  return (
    <div className={`relative ${className ?? ""}`}>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        title={picked.length > 1 ? picked.map(labelOf).join(", ") : undefined}
        className={`w-full h-[42px] px-3 flex items-center justify-between gap-2 rounded-lg border font-minecraft text-sm text-white transition-colors ${
          open ? "bg-white/[0.06] border-white/25" : "bg-black/50 border-white/10 hover:border-white/20"
        }`}
      >
        <span className="flex items-center gap-2 min-w-0">
          {icon && <Icon icon={icon} className="w-4 h-4 shrink-0 text-white/50" />}
          <span className="truncate normal-case">{label}</span>
        </span>
        <Icon
          icon="solar:alt-arrow-down-bold"
          className={`w-4 h-4 shrink-0 text-white/50 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>
      <ThemedDropdown
        open={open}
        onClose={() => setOpen(false)}
        align="left"
        scrollable
        triggerRef={triggerRef}
        matchTriggerWidth
      >
        {options.map((option) => (
          <ThemedDropdownItem key={option.value} selected={isSelected(option.value)} onClick={() => pick(option.value)}>
            {option.label}
          </ThemedDropdownItem>
        ))}
      </ThemedDropdown>
    </div>
  );
}
