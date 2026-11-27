import { useEffect } from "react";
import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";
import { useServerPingStore } from "../../../../store/server-ping-store";
import { parseMotdToHtml } from "../../../../utils/motd-utils";
import { PingBars, signalBars, type ServerPingState } from "../../../profiles/v3/shared/McServerRow";

/** Shared ping cache: the last good result (even stale), else "pending" or "error". */
export function useServerPing(address: string | null): ServerPingState {
  const cached = useServerPingStore((s) => (address ? s.cache[address]?.info : undefined));
  const failed = useServerPingStore((s) => (address ? s.failed[address] !== undefined : false));
  const pinging = useServerPingStore((s) => (address ? s.pinging.has(address) : false));

  useEffect(() => {
    if (address) useServerPingStore.getState().triggerBackgroundPing(address);
  }, [address]);

  if (!address) return undefined;
  if (cached) return cached;
  return failed && !pinging ? "error" : "pending";
}

/** The friend's server in Minecraft's server-list style, sized for the rail. */
export function ServerCard({ address, ping }: { address: string; ping: ServerPingState }) {
  const { t } = useTranslation();
  const info = ping && typeof ping === "object" ? ping : null;
  const failed = ping === "error";
  const motd = info?.description_json ?? info?.description ?? null;

  return (
    <div className="fw-server">
      {info?.favicon_base64 ? (
        <img src={`data:image/png;base64,${info.favicon_base64}`} alt="" className="fw-server-icon" draggable={false} />
      ) : (
        <span className="fw-server-icon fw-server-icon-empty">
          <Icon icon="solar:server-bold" className="h-4 w-4" />
        </span>
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="fw-name fw-ink min-w-0 flex-1 truncate">{address}</span>
          <span className="shrink-0" aria-hidden>
            <PingBars bars={signalBars(info?.latency_ms)} failed={failed} />
          </span>
        </div>
        {ping === "pending" ? (
          <p className="fw-meta fw-faint mt-0.5">{t("profiles.v3.servers.pinging")}</p>
        ) : failed ? (
          <p className="fw-meta mt-0.5" style={{ color: "var(--fw-danger)" }}>{t("profiles.v3.servers.cantConnect")}</p>
        ) : (
          <>
            {motd && <p className="fw-server-motd" dangerouslySetInnerHTML={{ __html: parseMotdToHtml(motd) }} />}
            {info?.players_online != null && (
              <p className="fw-meta fw-faint fw-num mt-1 flex items-center gap-1">
                <Icon icon="solar:users-group-rounded-bold" className="h-3 w-3" />
                {t("friends.server_players", { players: info.players_online.toLocaleString() })}
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
