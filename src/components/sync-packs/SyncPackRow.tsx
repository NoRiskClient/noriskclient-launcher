"use client";

import type { ReactNode } from "react";
import { Icon } from "@iconify/react";

import { Tooltip } from "../ui/Tooltip";

import type { SyncTargetKind } from "../../types/syncPacks";

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
  danger?: boolean;
  disabled?: boolean;
  title?: string;
}

export function RowAction({
  label,
  onClick,
  danger,
  disabled,
  title,
}: RowActionProps) {
  const button = (
    <button
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      disabled={disabled}
      className={`flex-shrink-0 px-2 py-1 text-[10px] font-minecraft uppercase tracking-wider text-white/0 transition-colors group-hover/row:text-white/30 disabled:opacity-30 ${
        danger ? "hover:!text-red-400" : "hover:!text-white"
      }`}
    >
      {label}
    </button>
  );

  if (!title) return button;

  return (
    <Tooltip content={title} position="top" wrapperClassName="flex-shrink-0">
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
}: SyncPackRowProps) {
  return (
    <div
      onClick={onClick}
      className={`group/row flex h-[52px] items-center gap-3 px-3 transition-colors hover:bg-white/[0.04] ${
        onClick ? "cursor-pointer" : ""
      } ${dimmed ? "opacity-45" : ""}`}
    >
      <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center overflow-hidden rounded border border-white/10 bg-black/30">
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
          <Icon icon={icon} className="h-4 w-4 text-white/45" />
        ) : (
          <span className="font-minecraft text-sm uppercase text-white/30">
            {fallbackLetter ?? "?"}
          </span>
        )}
      </div>

      <div className="min-w-0 flex-1">
        <Tooltip content={title} position="top" wrapperClassName="min-w-0 max-w-full">
          <div className="w-full truncate text-sm font-minecraft text-white/85">
            {title}
          </div>
        </Tooltip>
        {subtitle &&
          (subtitleTitle ? (
            <Tooltip
              content={subtitleTitle}
              position="top"
              wrapperClassName="min-w-0 max-w-full"
            >
              <div className="w-full truncate font-mono text-[11px] text-white/25">
                {subtitle}
              </div>
            </Tooltip>
          ) : (
            <div className="truncate font-mono text-[11px] text-white/25">
              {subtitle}
            </div>
          ))}
      </div>

      {actions}
      {trailing}
    </div>
  );
}
