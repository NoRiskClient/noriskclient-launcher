"use client";

import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";

import { useAppDragDropStore, type DragHoverKind } from "../../store/appStore";
import { useThemeStore } from "../../store/useThemeStore";

const MAX_NAMED_FILES = 3;

const KIND_ICON: Record<DragHoverKind, string> = {
  modpack: "solar:box-bold",
  content: "solar:widget-add-bold",
  world: "solar:planet-bold",
  unsupported: "solar:close-circle-bold",
};

export function DragDropOverlay() {
  const { t } = useTranslation();
  const dragHover = useAppDragDropStore((state) => state.dragHover);
  const accentColor = useThemeStore((state) => state.accentColor);

  if (!dragHover) return null;

  const { kind, fileNames } = dragHover;
  const rejected = kind === "unsupported";
  const color = rejected ? "#f87171" : accentColor.value;

  const named = fileNames.slice(0, MAX_NAMED_FILES);
  const remaining = fileNames.length - named.length;

  return (
    <div
      className="fixed inset-0 z-[2000] flex items-center justify-center p-8 pointer-events-none animate-in fade-in duration-150"
      style={{ backgroundColor: `${rejected ? "#000000" : color}26`, backdropFilter: "blur(6px)" }}
    >
      <div
        className="flex flex-col items-center gap-4 rounded-2xl px-12 py-10 border-4 border-dashed"
        style={{
          borderColor: `${color}cc`,
          backgroundColor: "rgba(0,0,0,0.55)",
        }}
      >
        <Icon icon={KIND_ICON[kind]} className="w-16 h-16" style={{ color }} />

        <p className="text-2xl text-white font-minecraft tracking-wide text-center">
          {t(`dragdrop.overlay.${kind}`)}
        </p>

        {named.length > 0 && (
          <div className="flex flex-col items-center gap-1">
            {named.map((name) => (
              <span
                key={name}
                className="text-sm text-white/60 font-minecraft tracking-wide break-all text-center max-w-md"
              >
                {name}
              </span>
            ))}
            {remaining > 0 && (
              <span className="text-sm text-white/40 font-minecraft tracking-wide">
                {t("dragdrop.overlay.more_files", { count: remaining })}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
