"use client";

import type { ReactNode } from "react";
import { Icon } from "@iconify/react";

import { Tooltip } from "../ui/Tooltip";
import { useIsTruncated } from "../../hooks/useIsTruncated";
import { CheckboxV2 } from "../ui/CheckboxV2";
import { useThemeStore } from "../../store/useThemeStore";

import type { SyncTargetKind } from "../../types/syncPacks";

export type SyncSelectionKind = "target" | "mod" | "jar";

export function selectionKey(
  packId: string,
  kind: SyncSelectionKind,
  id: string,
): string {
  return `${packId}|${kind}|${id}`;
}

export function parseSelectionKey(key: string): {
  packId: string;
  kind: SyncSelectionKind;
  id: string;
} {
  const [packId, kind, ...rest] = key.split("|");
  return { packId, kind: kind as SyncSelectionKind, id: rest.join("|") };
}

function MaybeTooltip({
  content,
  truncated,
  children,
}: {
  content: ReactNode;
  truncated: boolean;
  children: React.ReactNode;
}) {
  if (!truncated) return <>{children}</>;
  return (
    <Tooltip
      content={content}
      position="top"
      wrapperClassName="min-w-0 w-full max-w-full"
    >
      {children}
    </Tooltip>
  );
}

export function targetIcon(kind: SyncTargetKind): string {
  switch (kind.type) {
    case "dir_link":
      return "solar:folder-bold";
    case "mods":
      return "solar:box-minimalistic-bold";
    default:
      return "solar:file-text-bold";
  }
}

export function prettyPath(path: string): string {
  return path.replace(/^\\\\\?\\/, "");
}

export interface RowActionProps {
  label: string;
  onClick: () => void;
  icon?: string;
  danger?: boolean;
  disabled?: boolean;
  title?: string;
}

export function RowAction({
  label,
  onClick,
  icon,
  danger,
  disabled,
  title,
}: RowActionProps) {
  const handleClick = (event: React.MouseEvent) => {
    event.stopPropagation();
    onClick();
  };

  const button = icon ? (
    <button
      onClick={handleClick}
      disabled={disabled}
      aria-label={label}
      className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md border border-white/10 bg-black/40 text-white/45 opacity-0 transition-all duration-200 hover:border-white/20 hover:bg-black/60 disabled:opacity-30 group-hover/row:opacity-100 ${
        danger ? "hover:!text-red-400" : "hover:!text-white"
      }`}
    >
      <Icon icon={icon} className="h-4 w-4" />
    </button>
  ) : (
    <button
      onClick={handleClick}
      disabled={disabled}
      className={`flex-shrink-0 px-2 py-1 text-[10px] font-minecraft uppercase tracking-wider text-white/0 transition-colors group-hover/row:text-white/30 disabled:opacity-30 ${
        danger ? "hover:!text-red-400" : "hover:!text-white"
      }`}
    >
      {label}
    </button>
  );

  return (
    <Tooltip content={title ?? label} position="top" wrapperClassName="flex-shrink-0">
      {button}
    </Tooltip>
  );
}

export interface SyncPackRowProps {
  icon?: string;
  iconUrl?: string | null;
  fallbackLetter?: string;
  title: string;
  subtitle?: ReactNode;
  subtitleTitle?: string;
  actions?: ReactNode;
  trailing?: ReactNode;
  dimmed?: boolean;
  onClick?: () => void;
  selectable?: boolean;
  selected?: boolean;
  onToggleSelect?: () => void;
}

export function SyncPackRow({
  icon,
  iconUrl,
  fallbackLetter,
  title,
  subtitle,
  subtitleTitle,
  actions,
  trailing,
  dimmed,
  onClick,
  selectable,
  selected,
  onToggleSelect,
}: SyncPackRowProps) {
  const accentColor = useThemeStore((state) => state.accentColor);
  const titleFit = useIsTruncated<HTMLDivElement>();
  const subtitleFit = useIsTruncated<HTMLDivElement>();

  return (
    <div
      onClick={onClick}
      style={
        selected
          ? {
              backgroundColor: `${accentColor.value}1a`,
              borderColor: `${accentColor.value}66`,
            }
          : undefined
      }
      className={`group/row flex items-center gap-4 rounded-lg border p-3 transition-colors ${
        selected
          ? ""
          : "border-white/10 bg-black/20 hover:border-white/20 hover:bg-black/30"
      } ${onClick ? "cursor-pointer" : ""} ${dimmed ? "opacity-55" : ""}`}
    >
      {selectable && (
        <div
          onClick={(event) => event.stopPropagation()}
          className={`flex-shrink-0 transition-opacity ${
            selected ? "opacity-100" : "opacity-0 group-hover/row:opacity-100"
          }`}
        >
          <CheckboxV2
            size="sm"
            checked={selected ?? false}
            onChange={() => onToggleSelect?.()}
          />
        </div>
      )}
      <div className="flex h-14 w-14 flex-shrink-0 items-center justify-center overflow-hidden rounded-lg bg-white/5 ring-1 ring-white/10">
        {iconUrl ? (
          <img
            src={iconUrl}
            alt=""
            className="h-full w-full object-cover"
            onError={(event) => {
              (event.currentTarget as HTMLImageElement).style.display = "none";
            }}
          />
        ) : icon ? (
          <Icon icon={icon} className="h-6 w-6 text-white/50" />
        ) : (
          <span className="font-minecraft text-lg uppercase text-white/30">
            {fallbackLetter ?? "?"}
          </span>
        )}
      </div>

      <div className="flex min-w-0 w-full flex-1 flex-col items-start">
        <MaybeTooltip content={title} truncated={titleFit.truncated}>
          <div
            ref={titleFit.ref}
            className={`w-full truncate text-sm font-minecraft normal-case text-white ${dimmed ? "line-through" : ""}`}
            style={
              dimmed
                ? { textDecorationColor: accentColor.value, textDecorationThickness: "2px" }
                : undefined
            }
          >
            {title}
          </div>
        </MaybeTooltip>
        {subtitle && (
          <MaybeTooltip
            content={subtitleTitle ?? subtitle}
            truncated={subtitleFit.truncated}
          >
            <div
              ref={subtitleFit.ref}
              className="mt-1 w-full truncate font-minecraft text-xs text-white/60"
            >
              {subtitle}
            </div>
          </MaybeTooltip>
        )}
      </div>

      {actions}
      {trailing}
    </div>
  );
}
