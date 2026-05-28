"use client";

import { useState } from "react";
import { Icon } from "@iconify/react";
import { open } from "@tauri-apps/plugin-dialog";
import { convertFileSrc } from "@tauri-apps/api/core";
import { useTranslation } from "react-i18next";
import { toast } from "react-hot-toast";
import { Modal } from "../ui/Modal";
import { Button } from "../ui/buttons/Button";
import { cn } from "../../lib/utils";
import { useThemeStore } from "../../store/useThemeStore";
import { BLOCK_ICONS } from "../../data/block-icons";
import { useProfileIconLibraryStore } from "../../store/useProfileIconLibraryStore";

/** A chosen icon — either a remote image URL or an absolute file path on disk. */
export type ChosenIcon = { url: string } | { path: string };

interface IconPickerProps {
  /** Currently selected icon, used to highlight the active tile. */
  selected?: ChosenIcon | null;
  /** Called with the chosen icon. The picker closes itself afterwards. */
  onSelect: (icon: ChosenIcon) => void;
  onClose: () => void;
}

const GRID_STYLE: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fill, minmax(72px, 1fr))",
  gap: "10px",
};

// Tunes how an icon image renders once its real dimensions are known:
//  - tiny textures (<=64px) render crisp (pixelated) instead of blurry
//  - animated MC textures are vertical sprite sheets (height > width) — anchor
//    to the top so only the first animation frame shows instead of two halves
export function handleIconImgLoad(e: React.SyntheticEvent<HTMLImageElement>) {
  const img = e.currentTarget;
  if (img.naturalWidth === 0) return;
  // Assigned definitively (with defaults) so a reused <img> element resets
  // correctly when its src changes from e.g. a block texture to a photo.
  img.style.imageRendering = img.naturalWidth <= 64 ? "pixelated" : "auto";
  img.style.objectPosition = img.naturalHeight > img.naturalWidth ? "top" : "center";
}

export function IconPicker({ selected, onSelect, onClose }: IconPickerProps) {
  const { t } = useTranslation();
  const accentColor = useThemeStore((state) => state.accentColor);
  const { customIcons, addCustomFile, addCustomUrl, removeCustomIcon } =
    useProfileIconLibraryStore();
  const [showUrlInput, setShowUrlInput] = useState(false);
  const [urlValue, setUrlValue] = useState("");

  const pick = (icon: ChosenIcon) => {
    onSelect(icon);
    onClose();
  };

  const isSelected = (icon: ChosenIcon): boolean => {
    if (!selected) return false;
    if ("url" in icon && "url" in selected) return icon.url === selected.url;
    if ("path" in icon && "path" in selected) return icon.path === selected.path;
    return false;
  };

  const handleUpload = async () => {
    try {
      const selectedPath = await open({
        title: t("profiles.iconPicker.uploadFile"),
        multiple: false,
        directory: false,
        filters: [
          { name: "Images", extensions: ["png", "jpg", "jpeg", "webp", "gif"] },
        ],
      });
      if (typeof selectedPath === "string" && selectedPath) {
        addCustomFile(selectedPath);
      }
    } catch (err) {
      if (err instanceof Error && err.message.includes("Dialog cancelled")) return;
      console.error("Failed to select custom icon file:", err);
      toast.error(t("profiles.errors.image_dialog_failed"));
    }
  };

  const handleAddUrl = () => {
    const trimmed = urlValue.trim();
    try {
      const parsed = new URL(trimmed);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        throw new Error("unsupported protocol");
      }
    } catch {
      toast.error(t("profiles.iconPicker.invalidUrl"));
      return;
    }
    addCustomUrl(trimmed);
    setUrlValue("");
    setShowUrlInput(false);
  };

  const tileClass = (active: boolean) =>
    cn(
      "relative aspect-square rounded-lg overflow-hidden border-2 transition-all duration-150",
      active ? "" : "border-white/10 hover:border-white/25",
    );

  const activeStyle = (active: boolean): React.CSSProperties =>
    active
      ? { borderColor: accentColor.value, boxShadow: `0 0 0 2px ${accentColor.value}55` }
      : {};

  return (
    <Modal
      title={t("profiles.iconPicker.title")}
      titleIcon={<Icon icon="solar:gallery-bold" className="w-6 h-6" />}
      onClose={onClose}
      width="lg"
    >
      <div className="p-6 space-y-6">
        {/* Blocks */}
        <section className="space-y-3">
          <h3 className="font-minecraft text-2xl text-white lowercase">
            {t("profiles.iconPicker.blocks")}
          </h3>
          <div style={GRID_STYLE}>
            {BLOCK_ICONS.map((block) => {
              const active = isSelected({ url: block.url });
              return (
                <button
                  key={block.id}
                  type="button"
                  title={block.name}
                  className={cn(tileClass(active), "bg-black/30 hover:scale-105")}
                  style={activeStyle(active)}
                  onClick={() => pick({ url: block.url })}
                >
                  <img
                    src={block.url}
                    alt={block.name}
                    loading="lazy"
                    className="w-full h-full object-cover"
                    onLoad={handleIconImgLoad}
                  />
                </button>
              );
            })}
          </div>
        </section>

        {/* Custom */}
        <section className="space-y-3">
          <h3 className="font-minecraft text-2xl text-white lowercase">
            {t("profiles.iconPicker.custom")}
          </h3>

          {showUrlInput && (
            <div className="flex items-center gap-2">
              <input
                type="text"
                autoFocus
                value={urlValue}
                onChange={(e) => setUrlValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleAddUrl();
                  if (e.key === "Escape") setShowUrlInput(false);
                }}
                placeholder={t("profiles.iconPicker.addUrlPlaceholder")}
                className="flex-1 bg-black/50 border border-white/10 rounded-lg px-3 py-2 text-white placeholder-white/40 font-minecraft-ten text-sm outline-none focus:border-white/25"
              />
              <Button size="sm" variant="flat" onClick={handleAddUrl}>
                {t("profiles.iconPicker.add")}
              </Button>
            </div>
          )}

          <div style={GRID_STYLE}>
            {/* Upload file tile */}
            <button
              type="button"
              title={t("profiles.iconPicker.uploadFile")}
              onClick={handleUpload}
              className="relative aspect-square rounded-lg border-2 border-dashed border-white/15 hover:border-white/35 bg-black/20 flex flex-col items-center justify-center gap-1 transition-colors"
            >
              <Icon icon="solar:upload-bold" className="w-6 h-6 text-white/60" />
              <span className="font-minecraft-ten text-[10px] text-white/50 lowercase">
                {t("profiles.iconPicker.uploadFile")}
              </span>
            </button>

            {/* Add URL tile */}
            <button
              type="button"
              title={t("profiles.iconPicker.addUrl")}
              onClick={() => setShowUrlInput((v) => !v)}
              className="relative aspect-square rounded-lg border-2 border-dashed border-white/15 hover:border-white/35 bg-black/20 flex flex-col items-center justify-center gap-1 transition-colors"
            >
              <Icon icon="solar:link-bold" className="w-6 h-6 text-white/60" />
              <span className="font-minecraft-ten text-[10px] text-white/50 lowercase">
                {t("profiles.iconPicker.addUrl")}
              </span>
            </button>

            {/* Custom icons */}
            {customIcons.map((ci) => {
              const chosen: ChosenIcon =
                ci.kind === "file" ? { path: ci.value } : { url: ci.value };
              const src = ci.kind === "file" ? convertFileSrc(ci.value) : ci.value;
              const active = isSelected(chosen);
              return (
                <div
                  key={ci.id}
                  className={cn(tileClass(active), "bg-black/30 group")}
                  style={activeStyle(active)}
                >
                  <button
                    type="button"
                    className="w-full h-full"
                    onClick={() => pick(chosen)}
                  >
                    <img
                      src={src}
                      alt=""
                      loading="lazy"
                      className="w-full h-full object-cover"
                      onLoad={handleIconImgLoad}
                    />
                  </button>
                  <button
                    type="button"
                    title={t("profiles.iconPicker.remove")}
                    onClick={() => removeCustomIcon(ci.id)}
                    className="absolute top-0.5 right-0.5 w-5 h-5 flex items-center justify-center rounded bg-black/70 text-white/80 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <Icon icon="solar:trash-bin-trash-bold" className="w-3.5 h-3.5" />
                  </button>
                </div>
              );
            })}
          </div>
        </section>
      </div>
    </Modal>
  );
}
