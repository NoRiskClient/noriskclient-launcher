import { Icon } from "@iconify/react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { useAsyncResource } from "../../../hooks/useAsyncResource";
import { listClips } from "../../../services/clip-service";
import { getImageThumbnail, listProfileScreenshots } from "../../../services/tauri-service";
import { timeOf } from "../../../utils/profile-sort";
import { useRecentProfiles } from "./useRecentProfiles";
import { WidgetLoading, WidgetMessage } from "./WidgetParts";

const VISIBLE_ITEMS = 4;
const THUMBNAIL_SIZE = 256;

interface Tile {
  key: string;
  src: string | null;
  label?: string;
}

function TileGrid({ tiles, onOpen }: { tiles: Tile[]; onOpen: () => void }) {
  return (
    <div className="grid grid-cols-2 gap-1.5">
      {tiles.map((tile) => (
        <button
          key={tile.key}
          onClick={onOpen}
          className="group relative aspect-video rounded overflow-hidden bg-black/40 hover:ring-2 hover:ring-white/30 transition"
        >
          {tile.src && <img src={tile.src} alt="" className="w-full h-full object-cover" />}
          {tile.label && (
            <>
              <div className="absolute inset-0 bg-gradient-to-t from-black/80 to-transparent" />
              <Icon
                icon="solar:play-bold"
                className="absolute inset-0 m-auto w-6 h-6 text-white opacity-0 group-hover:opacity-100 transition-opacity"
              />
              <span className="absolute left-1 right-1 bottom-0.5 font-minecraft text-[10px] text-white/80 truncate normal-case text-left">
                {tile.label}
              </span>
            </>
          )}
        </button>
      ))}
    </div>
  );
}

export function ClipsWidget() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { data: tiles, loading } = useAsyncResource<Tile[]>(
    async () =>
      (await listClips())
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(0, VISIBLE_ITEMS)
        .map((clip) => ({ key: clip.path, src: clip.thumbnail && convertFileSrc(clip.thumbnail), label: clip.name })),
    [],
    [],
  );
  if (loading) return <WidgetLoading />;
  if (tiles.length === 0) return <WidgetMessage icon="solar:videocamera-record-bold" text={t("rail_widgets.clips.empty")} />;
  return <TileGrid tiles={tiles} onOpen={() => navigate("/clips")} />;
}

export function ScreenshotsWidget() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [profile] = useRecentProfiles(1);
  const { data: tiles, loading } = useAsyncResource<Tile[]>(
    profile
      ? async () => {
          const recent = (await listProfileScreenshots(profile.id))
            .sort((a, b) => timeOf(b.modified) - timeOf(a.modified))
            .slice(0, VISIBLE_ITEMS);
          return Promise.all(
            recent.map(async (shot) => ({
              key: shot.path,
              src: convertFileSrc(await getImageThumbnail(shot.path, THUMBNAIL_SIZE)),
            })),
          );
        }
      : null,
    [profile?.id],
    [],
  );
  if (!profile) return <WidgetMessage icon="solar:gallery-bold" text={t("rail_widgets.no_profile")} />;
  if (loading) return <WidgetLoading />;
  if (tiles.length === 0) return <WidgetMessage icon="solar:gallery-bold" text={t("rail_widgets.screenshots.empty")} />;
  return (
    <div className="flex flex-col gap-1">
      <div className="px-1 font-minecraft text-[11px] text-white/40 normal-case truncate">
        {t("rail_widgets.screenshots.from", { profile: profile.name })}
      </div>
      <TileGrid tiles={tiles} onOpen={() => navigate(`/profiles/${profile.id}`)} />
    </div>
  );
}
