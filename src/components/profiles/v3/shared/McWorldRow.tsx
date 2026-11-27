import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { convertFileSrc } from "@tauri-apps/api/core";
import type { WorldInfo } from "../../../../types/minecraft";
import * as WorldService from "../../../../services/world-service";
import { McIcon } from "./McIcon";

interface McWorldRowProps {
  world: WorldInfo;
  onPlay?: () => void;
  playDisabled?: boolean;
  nameSlot?: ReactNode;
}

export function McWorldRow({ world, onPlay, playDisabled, nameSlot }: McWorldRowProps) {
  const { t, i18n } = useTranslation();
  const name = world.display_name ?? world.folder_name;
  const date = world.last_played
    ? new Intl.DateTimeFormat(i18n.language, { dateStyle: "short", timeStyle: "short" }).format(world.last_played)
    : null;
  const mode = world.is_hardcore ? t("worlds.hardcore") : WorldService.getGameModeString(world.game_mode ?? 0);
  const info = [mode, world.version_name].filter(Boolean).join(", ");

  return (
    <div className="flex flex-1 min-w-0 gap-1.5 font-minecraft normal-case tracking-normal leading-[18px] select-none">
      <McIcon
        src={world.icon_path ? convertFileSrc(world.icon_path) : null}
        fallback="solar:planet-bold-duotone"
        onPlay={onPlay}
        playDisabled={playDisabled}
      />
      <div className="flex-1 min-w-0 text-[16px]">
        {nameSlot ?? <div className="truncate text-white">{name}</div>}
        <div className="truncate text-[#808080]">
          {world.folder_name}
          {date && ` (${date})`}
        </div>
        <div className={`truncate ${world.is_hardcore ? "text-[#ff5555]" : "text-[#808080]"}`}>{info}</div>
      </div>
    </div>
  );
}
