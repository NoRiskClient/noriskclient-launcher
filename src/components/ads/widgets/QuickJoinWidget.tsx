import { useEffect, useState } from "react";
import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";
import { useAsyncResource } from "../../../hooks/useAsyncResource";
import { useProfileLaunch } from "../../../hooks/useProfileLaunch";
import { getServersForProfile, pingMinecraftServer } from "../../../services/world-service";
import { parseMotdToHtml } from "../../../utils/motd-utils";
import type { ServerInfo, ServerPingInfo } from "../../../types/minecraft";
import { useRecentProfiles } from "./useRecentProfiles";
import { displayAddress, quickJoinServers, serverDisplayName, type QuickJoinServer } from "./server-list";
import { PixelImage, StatusDot, WidgetLoading, WidgetMessage, WidgetRow } from "./WidgetParts";

const VISIBLE_SERVERS = 6;
const NO_SERVERS: ServerInfo[] = [];

export function QuickJoinWidget() {
  const { t } = useTranslation();
  const [profile] = useRecentProfiles(1);
  const { data: saved, loading } = useAsyncResource(
    profile ? () => getServersForProfile(profile.id) : null,
    [profile?.id],
    NO_SERVERS,
  );
  const { handleQuickPlayLaunch, isLaunching, statusMessage } = useProfileLaunch({ profileId: profile?.id ?? "" });
  const [joining, setJoining] = useState<string | null>(null);

  useEffect(() => {
    if (!isLaunching) setJoining(null);
  }, [isLaunching]);

  if (!profile) return <WidgetMessage icon="solar:server-bold" text={t("rail_widgets.no_profile")} />;
  if (loading) return <WidgetLoading />;
  const servers = quickJoinServers(saved, VISIBLE_SERVERS);
  if (servers.length === 0) return <WidgetMessage icon="solar:server-bold" text={t("rail_widgets.quick_join.empty")} />;

  return (
    <div className="flex flex-col gap-0.5">
      {servers.map((server) => (
        <ServerRow
          key={server.address}
          server={server}
          disabled={isLaunching}
          status={isLaunching && joining === server.address ? statusMessage || t("profiles.card.starting") : null}
          onJoin={() => {
            setJoining(server.address);
            void handleQuickPlayLaunch(undefined, server.address);
          }}
        />
      ))}
    </div>
  );
}

const toImageSrc = (icon: string) => (icon.startsWith("data:") ? icon : `data:image/png;base64,${icon}`);

interface ServerRowProps {
  server: QuickJoinServer;
  disabled: boolean;
  status: string | null;
  onJoin: () => void;
}

function ServerRow({ server, disabled, status, onJoin }: ServerRowProps) {
  const { t } = useTranslation();
  const { data: ping, loading } = useAsyncResource<ServerPingInfo | null>(
    () => pingMinecraftServer(server.address),
    [server.address],
    null,
  );
  const reachable = !!ping && !ping.error;
  const icon = server.icon_base64 ?? ping?.favicon_base64;

  return (
    <WidgetRow
      media={
        <div className="w-full h-full flex items-center justify-center bg-black/40">
          {icon ? <PixelImage src={toImageSrc(icon)} /> : <Icon icon="solar:server-bold" className="w-4 h-4 text-white/40" />}
        </div>
      }
      title={<span dangerouslySetInnerHTML={{ __html: parseMotdToHtml(serverDisplayName(server)) }} />}
      tooltip={displayAddress(server.address)}
      launchable
      launching={!!status}
      disabled={disabled}
      onClick={onJoin}
      trailing={
        status ? (
          <span className="max-w-[45%] font-minecraft text-[11px] text-white/60 truncate">{status}</span>
        ) : (
          !loading && (
            <span className="flex items-center gap-1.5 font-minecraft text-[11px] tabular-nums text-white/40">
              {reachable ? (ping.players_online ?? 0).toLocaleString() : t("rail_widgets.quick_join.offline")}
              <StatusDot color={reachable ? "#4ade80" : "rgba(255,255,255,0.2)"} />
            </span>
          )
        )
      }
    />
  );
}
