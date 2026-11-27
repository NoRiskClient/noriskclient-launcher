import { useTranslation } from "react-i18next";
import { parseMotdToHtml } from "../../../../utils/motd-utils";
import type { ServerPingInfo } from "../../../../types/minecraft";
import { McIcon } from "./McIcon";

export type ServerPingState = ServerPingInfo | "pending" | "error" | undefined;

const BAR_HEIGHTS = [2, 3, 4, 5, 6];

export function signalBars(latency: number | null | undefined): number {
  if (latency == null) return 0;
  if (latency < 150) return 5;
  if (latency < 300) return 4;
  if (latency < 600) return 3;
  if (latency < 1000) return 2;
  return 1;
}

export function PingBars({ bars, failed }: { bars: number; failed: boolean }) {
  return (
    <div className="flex items-end gap-[2px] h-3.5" style={{ imageRendering: "pixelated" }}>
      {BAR_HEIGHTS.map((height, index) => (
        <span
          key={height}
          className="w-[2px]"
          style={{
            height: height * 2,
            backgroundColor: failed ? "#3f3f3f" : index < bars ? "#55ff55" : "#3f3f3f",
          }}
        />
      ))}
    </div>
  );
}

interface McServerRowProps {
  name: string;
  pingState: ServerPingState;
  savedIcon?: string | null;
  className?: string;
  onPlay?: () => void;
  playDisabled?: boolean;
}

export function McServerRow({ name, pingState, savedIcon, className = "", onPlay, playDisabled }: McServerRowProps) {
  const { t } = useTranslation();
  const pending = pingState === "pending";
  const failed = pingState === "error" || (!!pingState && typeof pingState === "object" && !!pingState.error);
  const ping = pingState && typeof pingState === "object" && !pingState.error ? pingState : null;
  const motd = ping?.description_json ?? ping?.description ?? "";
  const icon = ping?.favicon_base64 ?? savedIcon ?? null;

  return (
    <div className={`flex gap-1.5 font-minecraft normal-case tracking-normal leading-[18px] select-none ${className}`}>
      <McIcon
        src={icon ? `data:image/png;base64,${icon}` : null}
        fallback="solar:server-bold-duotone"
        onPlay={onPlay}
        playDisabled={playDisabled}
      />
      <div className="flex-1 min-w-0">
        <div className="flex items-start gap-2">
          <span className="flex-1 truncate text-[16px] text-white" dangerouslySetInnerHTML={{ __html: parseMotdToHtml(name) }} />
          {ping?.players_online != null && ping.players_max != null && (
            <span className="text-[16px] text-[#aaaaaa] tabular-nums">
              {ping.players_online}
              <span className="text-[#555555]">/</span>
              {ping.players_max}
            </span>
          )}
          <PingBars bars={signalBars(ping?.latency_ms)} failed={failed || pending} />
        </div>
        {failed ? (
          <div className="text-[16px] text-[#aa0000]">{t("profiles.v3.servers.cantConnect")}</div>
        ) : pending ? (
          <div className="text-[16px] text-[#808080]">{t("profiles.v3.servers.pinging")}</div>
        ) : (
          motd && (
            <div
              className="w-[534px] max-w-full text-[16px] text-[#808080] whitespace-pre-wrap line-clamp-2"
              dangerouslySetInnerHTML={{ __html: parseMotdToHtml(motd) }}
            />
          )
        )}
      </div>
    </div>
  );
}
