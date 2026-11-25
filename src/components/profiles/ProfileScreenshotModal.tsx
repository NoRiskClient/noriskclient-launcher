import { useEffect, useRef, useState } from "react";
import { Icon } from "@iconify/react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { toast } from "react-hot-toast";
import { useTranslation } from "react-i18next";
import { createPortal } from "react-dom";
import { Tooltip } from "../ui/Tooltip";
import { cn } from "../../lib/utils";
import type { ScreenshotInfo } from "../../types/profile";
import {
  copyScreenshotImage,
  revealScreenshot,
} from "../../utils/screenshot-actions";
import { getImageThumbnail } from "../../services/tauri-service";
import { formatRelativeTime } from "../../utils/format-relative-time";
import { useZoomPan } from "../../hooks/useZoomPan";
import { parseErrorMessage } from "../../utils/error-utils";

const PLACEHOLDER_SIZE = 512;
const ZOOM_BADGE_MS = 900;
const IMAGE_INSET = 16;

interface ProfileScreenshotModalProps {
  isOpen: boolean;
  onClose: () => void;
  screenshot: ScreenshotInfo | null;
  sharing: boolean;
  onShare: () => void;
  onDelete: () => void;
  onRename: (name: string) => Promise<void>;
  position?: { index: number; total: number };
  onNavigate?: (delta: -1 | 1) => void;
}

export function ProfileScreenshotModal({
  isOpen,
  onClose,
  screenshot,
  sharing,
  onShare,
  onDelete,
  onRename,
  position,
  onNavigate,
}: ProfileScreenshotModalProps) {
  const { t } = useTranslation();
  const [placeholder, setPlaceholder] = useState<string | null>(null);
  const [size, setSize] = useState<{ width: number; height: number } | null>(
    null,
  );
  const [copying, setCopying] = useState(false);
  const path = isOpen ? screenshot?.path : undefined;
  const viewer = useZoomPan(path);
  const [zoomBadge, setZoomBadge] = useState(false);
  const shownZoom = useRef({ path, zoom: viewer.zoom });
  const stem = screenshot ? screenshot.filename.replace(/\.[^.]+$/, "") : "";
  const [draftName, setDraftName] = useState(stem);
  const nameInput = useRef<HTMLInputElement>(null);

  useEffect(() => setDraftName(stem), [stem]);

  useEffect(() => {
    const previous = shownZoom.current;
    shownZoom.current = { path, zoom: viewer.zoom };
    if (!path || previous.path !== path || previous.zoom === viewer.zoom)
      return;
    setZoomBadge(true);
    const timer = window.setTimeout(() => setZoomBadge(false), ZOOM_BADGE_MS);
    return () => window.clearTimeout(timer);
  }, [viewer.zoom, path]);

  useEffect(() => {
    if (!path) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowLeft") onNavigate?.(-1);
      else if (e.key === "ArrowRight") onNavigate?.(1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [path, onClose, onNavigate]);

  useEffect(() => {
    setPlaceholder(null);
    setSize(null);
    if (!path) return;
    let current = true;
    getImageThumbnail(path, PLACEHOLDER_SIZE)
      .then((thumbnail) => current && setPlaceholder(convertFileSrc(thumbnail)))
      .catch(() => {});
    return () => {
      current = false;
    };
  }, [path]);

  if (!isOpen || !screenshot) return null;

  const copy = async () => {
    if (copying) return;
    setCopying(true);
    await copyScreenshotImage(screenshot.path, t);
    setCopying(false);
  };

  const spinner = <Icon icon="svg-spinners:ring-resize" className="w-4 h-4" />;
  const details = [
    formatRelativeTime(screenshot.modified),
    size && `${size.width} × ${size.height}`,
  ]
    .filter(Boolean)
    .join(" · ");

  const commitName = async () => {
    const name = draftName.trim();
    if (!name || name === stem) {
      setDraftName(stem);
      return;
    }
    try {
      await onRename(name);
    } catch (err) {
      toast.error(parseErrorMessage(err));
      setDraftName(stem);
    }
  };

  const insideImage = (box: HTMLElement, x: number, y: number) => {
    const rect = box.getBoundingClientRect();
    const width = rect.width - 2 * IMAGE_INSET;
    const height = rect.height - 2 * IMAGE_INSET;
    const ratio = size ? size.width / size.height : width / height;
    const shownWidth = Math.min(width, height * ratio);
    const shownHeight = shownWidth / ratio;
    const left = rect.left + IMAGE_INSET + (width - shownWidth) / 2;
    const top = rect.top + IMAGE_INSET + (height - shownHeight) / 2;
    return (
      x >= left && x <= left + shownWidth && y >= top && y <= top + shownHeight
    );
  };

  const action = (
    label: string,
    icon: string,
    onClick: () => void,
    options: { busy?: boolean; danger?: boolean } = {},
  ) => (
    <Tooltip content={label} position="bottom">
      <button
        onClick={onClick}
        disabled={options.busy}
        className={cn(
          "w-9 h-9 rounded-md flex items-center justify-center transition-colors disabled:opacity-50",
          options.danger
            ? "text-rose-300 hover:bg-rose-500/20"
            : "text-white/70 hover:text-white hover:bg-white/10",
        )}
      >
        {options.busy ? spinner : <Icon icon={icon} className="w-5 h-5" />}
      </button>
    </Tooltip>
  );

  return createPortal(
    <div className="fixed inset-0 z-[1000] flex flex-col bg-black/90 backdrop-blur-md select-none animate-in fade-in duration-150">
      <div className="flex items-center gap-3 h-14 px-4 shrink-0 font-minecraft normal-case">
        <Icon
          icon="solar:gallery-bold"
          className="w-5 h-5 text-white/60 shrink-0"
        />
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <input
              ref={nameInput}
              value={draftName}
              onChange={(e) => setDraftName(e.target.value)}
              onBlur={() => void commitName()}
              onKeyDown={(e) => {
                if (e.key === "Enter") e.currentTarget.blur();
                if (e.key === "Escape") {
                  e.stopPropagation();
                  setDraftName(stem);
                  e.currentTarget.blur();
                }
              }}
              spellCheck={false}
              title={t("screenshots.rename")}
              size={Math.max(draftName.length, 1)}
              className="min-w-0 max-w-[28rem] -mx-1 px-1 rounded-sm bg-transparent hover:bg-white/5 focus:bg-white/10 text-sm text-white outline-none select-text transition-colors"
            />
            <Tooltip content={t("screenshots.rename")} position="bottom">
              <button
                onClick={() => nameInput.current?.select()}
                className="w-6 h-6 rounded flex items-center justify-center text-white/40 hover:text-white hover:bg-white/10 transition-colors"
              >
                <Icon icon="solar:pen-bold" className="w-3.5 h-3.5" />
              </button>
            </Tooltip>
          </div>
          <div className="text-xs text-white/45">
            {position && `${position.index + 1} / ${position.total} · `}
            {details}
          </div>
        </div>
        <div className="ml-auto flex items-center gap-1">
          {action(t("screenshots.share"), "solar:cloud-upload-bold", onShare, {
            busy: sharing,
          })}
          {action(t("screenshots.copy_image"), "solar:copy-bold", copy, {
            busy: copying,
          })}
          {action(
            t("clips.gallery.reveal"),
            "solar:folder-open-bold",
            () => void revealScreenshot(screenshot.path, t),
          )}
          {action(
            t("clips.gallery.delete"),
            "solar:trash-bin-trash-bold",
            onDelete,
            { danger: true },
          )}
          <div className="w-px h-6 bg-white/10 mx-2" />
          {action(t("common.close"), "solar:close-circle-bold", onClose)}
        </div>
      </div>
      <div
        ref={viewer.viewport}
        {...viewer.handlers}
        onClick={(e) => {
          if (
            viewer.zoom === 1 &&
            !insideImage(e.currentTarget, e.clientX, e.clientY)
          )
            onClose();
          else viewer.toggleAt(e.clientX, e.clientY);
        }}
        className={cn(
          "relative flex-1 min-h-0 overflow-hidden touch-none",
          viewer.zoom > 1
            ? viewer.dragging
              ? "cursor-grabbing"
              : "cursor-zoom-out"
            : "cursor-zoom-in",
        )}
      >
        <div
          className={cn(
            "absolute inset-4 pointer-events-none",
            !viewer.dragging && "transition-transform duration-150 ease-out",
          )}
          style={{ transform: viewer.transform }}
        >
          {placeholder && (
            <img
              src={placeholder}
              alt=""
              draggable={false}
              className="absolute inset-0 w-full h-full object-contain"
            />
          )}
          <img
            src={convertFileSrc(screenshot.path)}
            alt=""
            draggable={false}
            className={cn(
              "absolute inset-0 w-full h-full object-contain transition-opacity duration-300",
              size ? "opacity-100" : "opacity-0",
            )}
            onLoad={(e) =>
              setSize({
                width: e.currentTarget.naturalWidth,
                height: e.currentTarget.naturalHeight,
              })
            }
          />
        </div>
        {onNavigate && position && (
          <>
            {position.index > 0 && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onNavigate(-1);
                }}
                onPointerDown={(e) => e.stopPropagation()}
                className="absolute left-3 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full flex items-center justify-center bg-black/50 text-white/70 hover:text-white hover:bg-black/70 opacity-60 hover:opacity-100 transition"
              >
                <Icon icon="solar:alt-arrow-left-linear" className="w-5 h-5" />
              </button>
            )}
            {position.index < position.total - 1 && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onNavigate(1);
                }}
                onPointerDown={(e) => e.stopPropagation()}
                className="absolute right-3 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full flex items-center justify-center bg-black/50 text-white/70 hover:text-white hover:bg-black/70 opacity-60 hover:opacity-100 transition"
              >
                <Icon icon="solar:alt-arrow-right-linear" className="w-5 h-5" />
              </button>
            )}
          </>
        )}
        <div
          className={cn(
            "absolute top-3 left-1/2 -translate-x-1/2 px-2.5 py-1 rounded-md bg-black/70 text-xs text-white/80 font-minecraft tabular-nums pointer-events-none transition-opacity duration-300",
            zoomBadge ? "opacity-100" : "opacity-0",
          )}
        >
          {Math.round(viewer.zoom * 100)}%
        </div>
      </div>
    </div>,
    document.body,
  );
}
