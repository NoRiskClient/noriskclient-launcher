"use client";

import { Icon } from "@iconify/react";
import { SyncPackIcon } from "../../../../sync-packs/SyncPackIcon";

interface ContentGroupDividerProps {
  label: string;
  tag?: string;
  count: number;
  packId?: string;
  packIcon?: string | null;
  collapsed: boolean;
  onToggle: () => void;
  onOpen?: () => void;
  openLabel?: string;
}

export function ContentGroupDivider({
  label,
  tag,
  count,
  packId,
  packIcon,
  collapsed,
  onToggle,
  onOpen,
  openLabel,
}: ContentGroupDividerProps) {
  return (
    <div className="flex items-center gap-2">
      <button
        onClick={onToggle}
        className="group/divider flex min-w-0 flex-1 items-center gap-2.5 py-1 text-left"
      >
        <Icon
          icon="solar:alt-arrow-down-linear"
          className="h-3.5 w-3.5 flex-shrink-0 text-white/35 transition-transform duration-200 group-hover/divider:text-white/70"
          style={{ transform: collapsed ? "rotate(-90deg)" : undefined }}
        />
        {packId ? (
          <SyncPackIcon packId={packId} icon={packIcon ?? null} size="xs" />
        ) : (
          <div className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded border border-white/10 bg-white/5">
            <Icon icon="solar:user-rounded-bold" className="h-3 w-3 text-white/60" />
          </div>
        )}
        <span className="min-w-0 truncate font-minecraft text-xs uppercase tracking-wider text-white/60 transition-colors group-hover/divider:text-white">
          {label}
        </span>
        {tag && (
          <span className="flex flex-shrink-0 items-center gap-1 font-minecraft text-[10px] uppercase tracking-wider text-white/30">
            <Icon icon="solar:link-round-bold" className="h-3 w-3" />
            {tag}
          </span>
        )}
        <span className="flex-shrink-0 rounded bg-white/5 px-1.5 font-minecraft text-[10px] text-white/40">
          {count}
        </span>
        <div className="h-px flex-1 bg-white/10" />
      </button>
      {onOpen && (
        <button
          onClick={onOpen}
          className="flex flex-shrink-0 items-center gap-1 rounded px-2 py-1 font-minecraft text-[10px] uppercase tracking-wider text-white/40 transition-colors hover:bg-white/10 hover:text-white"
        >
          {openLabel}
          <Icon icon="solar:arrow-right-up-linear" className="h-3 w-3" />
        </button>
      )}
    </div>
  );
}
