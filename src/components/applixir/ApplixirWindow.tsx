import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useThemeStore } from "../../store/useThemeStore";
import { getAfkPointsBalance, mintApplixirSession } from "../../services/nrc-service";
import { Button } from "../ui/buttons/Button";
import { Tooltip } from "../ui/Tooltip";
import { log } from "../../utils/logging-utils";

const appWindow = getCurrentWindow();

type AdState = "loading" | "playing" | "completed" | "finished" | "error";

function complementaryBackground(hex: string): string {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  const rgb = m
    ? {
        r: Number.parseInt(m[1], 16),
        g: Number.parseInt(m[2], 16),
        b: Number.parseInt(m[3], 16),
      }
    : { r: 34, g: 34, b: 34 };
  const r = Math.min(Math.floor(rgb.r * 0.1), 30);
  const g = Math.min(Math.floor(rgb.g * 0.1), 30);
  const b = Math.min(Math.floor(rgb.b * 0.1), 30);
  return `rgb(${r}, ${g}, ${b})`;
}

function BorderGlowEffects({ accent }: { accent: string }) {
  return (
    <>
      <div className="absolute top-0 left-0 right-0 h-[2px] pointer-events-none z-20" style={{ background: `linear-gradient(to right, transparent, ${accent}70, transparent)` }} />
      <div className="absolute bottom-0 left-0 right-0 h-[2px] pointer-events-none z-20" style={{ background: `linear-gradient(to right, transparent, ${accent}70, transparent)` }} />
      <div className="absolute top-0 bottom-0 left-0 w-[2px] pointer-events-none z-20" style={{ background: `linear-gradient(to bottom, transparent, ${accent}70, transparent)` }} />
      <div className="absolute top-0 bottom-0 right-0 w-[2px] pointer-events-none z-20" style={{ background: `linear-gradient(to bottom, transparent, ${accent}70, transparent)` }} />
    </>
  );
}

function Titlebar({ points }: { points: number }) {
  const { t } = useTranslation();
  const accentColor = useThemeStore((s) => s.accentColor);
  const rgb = accentColor.value;

  return (
    <div
      className="relative flex items-center justify-between h-14 px-6 select-none border-b-2 backdrop-blur-lg z-10"
      style={{
        borderColor: `${rgb}40`,
        backgroundColor: `rgba(${parseInt(rgb.slice(1, 3), 16)}, ${parseInt(rgb.slice(3, 5), 16)}, ${parseInt(rgb.slice(5, 7), 16)}, 0.01)`,
      }}
      data-tauri-drag-region
    >
      <div className="flex items-center gap-3" data-tauri-drag-region>
        <h1
          className="font-minecraft text-2xl tracking-wider font-bold lowercase text-shadow"
          data-tauri-drag-region
        >
          {t("applixir.window.title")}
        </h1>
      </div>

      <div className="flex items-center gap-4">
        <Tooltip content={t("applixir.window.afk_points")} position="bottom" delay={0}>
          <div
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-b-2 backdrop-blur-md transition-all duration-200 hover:brightness-110"
            style={{
              backgroundColor: `${accentColor.value}30`,
              borderColor: `${accentColor.value}80`,
              borderBottomColor: accentColor.dark,
            }}
          >
            <Icon
              icon="solar:bolt-circle-bold"
              className="w-4 h-4"
              style={{ color: accentColor.value, filter: `drop-shadow(0 0 4px ${accentColor.shadowValue})` }}
            />
            <span
              className="font-minecraft-ten text-xs"
              style={{ color: accentColor.light, transform: "translateY(-1px)" }}
            >
              {points}
            </span>
          </div>
        </Tooltip>
        <div
          onClick={() => appWindow.minimize()}
          className="w-5 h-5 flex items-center justify-center text-white/60 hover:text-white transition-colors cursor-pointer"
        >
          <Icon icon="pixel:minus-solid" className="w-4 h-4" />
        </div>
        <div
          onClick={() => appWindow.close()}
          className="w-5 h-5 flex items-center justify-center text-white/60 hover:text-red-500 transition-colors cursor-pointer"
        >
          <Icon icon="pixel:window-close-solid" className="w-4 h-4" />
        </div>
      </div>
    </div>
  );
}

function Overlay({
  icon,
  color,
  text,
  spin,
  action,
}: {
  icon: string;
  color: string;
  text: string;
  spin?: boolean;
  action?: { label: string; onClick: () => void; disabled?: boolean };
}) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-5 bg-black/80">
      <Icon icon={icon} className={`w-12 h-12${spin ? " animate-spin" : ""}`} style={{ color }} />
      <span className="font-minecraft-ten text-sm text-white/80 tracking-wide">
        {text}
      </span>
      {action && (
        <Button variant="flat" size="sm" onClick={action.onClick} disabled={action.disabled}>
          <span style={{ transform: "translateY(-2px)" }}>{action.label}</span>
        </Button>
      )}
    </div>
  );
}

function StreakTrack({ streakDays }: { streakDays: number }) {
  const { t } = useTranslation();
  const accentColor = useThemeStore((s) => s.accentColor);
  const accent = accentColor.value;
  const bgColor = complementaryBackground(accent);
  const filled = streakDays === 0 ? 0 : ((streakDays - 1) % 7) + 1;
  const progressPct = (Math.min(filled, 7) / 6) * 100;

  const active = streakDays > 0;

  return (
    <div className="shrink-0 mt-3 flex items-center gap-4 px-1">
      <div className="flex items-center gap-2 shrink-0">
        <Icon
          icon="solar:fire-bold"
          className="w-4 h-4"
          style={{
            color: active ? accentColor.value : accentColor.dark,
            filter: active ? `drop-shadow(0 0 5px ${accentColor.shadowValue})` : undefined,
          }}
        />
        <span
          className="font-minecraft-ten text-xs uppercase tracking-wider whitespace-nowrap"
          style={{ color: active ? accentColor.value : accentColor.dark }}
        >
          {streakDays} {t("applixir.window.streak_days")}
        </span>
      </div>

      <div className="flex-1 relative flex items-center justify-between mx-2">
        <div className="absolute left-0 right-0 top-1/2 -translate-y-1/2 h-[2px] rounded-full" style={{ backgroundColor: `${accentColor.value}18` }}>
          <div
            className="h-full rounded-full transition-all duration-500 ease-out"
            style={{ width: `${progressPct}%`, backgroundColor: accentColor.value }}
          />
        </div>
        {Array.from({ length: 7 }, (_, i) => {
          const isDone = i < filled;
          const isToday = i === filled;
          const isBonus = i === 6;
          const on = isDone || isToday;
          const icon = isBonus
            ? "solar:cup-star-bold"
            : isDone
              ? "solar:fire-bold"
              : isToday
                ? "solar:fire-bold"
                : "solar:lock-keyhole-minimalistic-bold";
          return (
            <Tooltip
              key={i}
              content={isBonus ? t("applixir.window.streak_bonus") : `${t("applixir.window.streak_day")} ${i + 1}`}
              position="top"
              delay={0}
            >
              <div
                className="relative flex items-center justify-center transition-all duration-300"
                style={{ background: `radial-gradient(circle, ${bgColor} 60%, transparent 70%)`, padding: "0 4px" }}
              >
                <Icon
                  icon={icon}
                  className={isToday ? "w-6 h-6" : "w-5 h-5"}
                  style={{
                    color: on ? accentColor.value : accentColor.dark,
                    filter: isDone || isToday ? `drop-shadow(0 0 5px ${accentColor.shadowValue})` : undefined,
                    opacity: on ? 1 : 0.55,
                  }}
                />
              </div>
            </Tooltip>
          );
        })}
      </div>
    </div>
  );
}

function RewardPop({ points, balance }: { points: number; balance: number }) {
  const { t } = useTranslation();
  const accentColor = useThemeStore((s) => s.accentColor);
  return (
    <div className="absolute inset-x-0 top-6 z-30 flex justify-center pointer-events-none">
      <div
        className="animate-slide-up-fade-in flex items-center gap-2 px-4 py-2 rounded-lg backdrop-blur-md"
        style={{
          background: `linear-gradient(135deg, ${accentColor.value}40, rgba(0,0,0,0.6))`,
          border: `1px solid ${accentColor.value}`,
          boxShadow: `0 0 18px ${accentColor.shadowValue}`,
        }}
      >
        <Icon icon="solar:bolt-circle-bold" className="w-5 h-5" style={{ color: accentColor.value }} />
        <span
          className="font-minecraft text-2xl lowercase leading-none"
          style={{ color: accentColor.value, transform: "translateY(-2px)" }}
        >
          +{points} {t("applixir.window.afk_points")}
        </span>
        <span className="font-minecraft-ten text-[10px] text-white/60 leading-none">
          {t("applixir.window.balance", { balance })}
        </span>
      </div>
    </div>
  );
}

function runCatchingJson(s: unknown): { points: number; balance: number; streakDays: number } | null {
  if (typeof s !== "string") return null;
  try {
    const o = JSON.parse(s);
    const points = typeof o?.afkPoints === "number" ? o.afkPoints : o?.coins;
    const balance = typeof o?.afkPointsBalance === "number" ? o.afkPointsBalance : o?.balance;
    const streakDays = typeof o?.streakDays === "number" ? o.streakDays : 0;
    if (typeof points === "number" && typeof balance === "number") {
      return { points, balance, streakDays };
    }
  } catch {
    // ignore
  }
  return null;
}

const STATE_META: Record<AdState, { icon: string; labelKey: string; spin?: boolean }> = {
  loading: { icon: "svg-spinners:ring-resize", labelKey: "applixir.window.loading" },
  playing: { icon: "solar:play-circle-bold", labelKey: "applixir.playing" },
  completed: { icon: "solar:check-circle-bold", labelKey: "applixir.completed" },
  finished: { icon: "solar:info-circle-bold", labelKey: "applixir.window.no_ad" },
  error: { icon: "solar:danger-triangle-bold", labelKey: "applixir.window.error" },
};

function Sidebar({ state }: { state: AdState }) {
  const { t } = useTranslation();
  const accentColor = useThemeStore((s) => s.accentColor);
  const meta = STATE_META[state];

  return (
    <div
      className="w-72 shrink-0 bg-black/10 backdrop-blur-lg p-5 flex flex-col gap-5 overflow-y-auto"
      style={{
        borderLeft: `2px solid ${accentColor.value}60`,
        boxShadow: `0 0 15px ${accentColor.value}30 inset`,
      }}
    >
      <div className="flex flex-col gap-2">
        <span className="font-minecraft-ten text-xs uppercase tracking-wider text-white/50">
          {t("applixir.window.status")}
        </span>
        <div
          className="flex items-center gap-3 px-3 py-2 rounded-lg"
          style={{
            background: `${accentColor.value}15`,
            border: `1px solid ${accentColor.value}30`,
          }}
        >
          <Icon
            icon={meta.icon}
            className={`w-4 h-4 flex-shrink-0${meta.spin ? " animate-spin" : ""}`}
            style={{ color: state === "error" ? "#ef4444" : accentColor.value }}
          />
          <span className="font-minecraft-ten text-xs text-white/80 tracking-wide">
            {t(meta.labelKey)}
          </span>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <span className="font-minecraft-ten text-xs uppercase tracking-wider text-white/50">
          {t("applixir.window.about_title")}
        </span>
        <p className="font-minecraft-ten text-xs text-white/70 leading-relaxed">
          {t("applixir.window.about_text")}
        </p>
      </div>

      <div className="mt-auto">
        <div className="flex items-start gap-3 px-3 py-3 rounded-lg border border-white/10 bg-black/30">
          <Icon
            icon="solar:gift-bold"
            className="w-4 h-4 flex-shrink-0 mt-0.5"
            style={{ color: accentColor.value }}
          />
          <span className="font-minecraft-ten text-xs text-white/60 leading-relaxed">
            {t("applixir.window.rewards_soon")}
          </span>
        </div>
      </div>
    </div>
  );
}

export function ApplixirWindow() {
  const { t } = useTranslation();
  const accentColor = useThemeStore((s) => s.accentColor);
  const bgColor = complementaryBackground(accentColor.value);

  const { initialToken, base, apiOrigin, initialResetConsent } = useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    const base = params.get("base") ?? "";
    return {
      initialToken: params.get("token") ?? "",
      base,
      apiOrigin: base ? new URL(base).origin : "",
      initialResetConsent: params.get("resetConsent") === "1",
    };
  }, []);

  const [token, setToken] = useState(initialToken);
  const [resetConsent, setResetConsent] = useState(initialResetConsent);
  const [attempt, setAttempt] = useState(0);
  const [streakDays, setStreakDays] = useState(0);
  const [points, setPoints] = useState(0);
  const [busy, setBusy] = useState(false);
  const [reward, setReward] = useState<{ points: number; balance: number; key: number } | null>(null);
  const [state, setState] = useState<AdState>(initialToken ? "loading" : "error");
  const adStartedRef = useRef(false);

  const pageUrl = base && token
    ? `${base}/applixir/page?token=${encodeURIComponent(token)}${resetConsent ? "&resetConsent=1" : ""}`
    : "";

  const watchAnother = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const fresh = await mintApplixirSession();
      if (!fresh) {
        log("warn", "[ApplixirWindow] watch another: mint returned null");
        return;
      }
      setToken(fresh);
      setResetConsent(false);
      setAttempt((a) => a + 1);
      setState("loading");
    } catch (e) {
      log("error", `[ApplixirWindow] watch another mint failed: ${JSON.stringify(e)}`);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    getAfkPointsBalance()
      .then((b) => {
        if (b) {
          setStreakDays(b.streakDays);
          setPoints(b.afkPoints);
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    log(
      "info",
      `[ApplixirWindow] mounted: token=${initialToken ? "yes" : "<none>"} apiOrigin=${apiOrigin || "<none>"}`,
    );
  }, [initialToken, apiOrigin]);

  useEffect(() => {
    log("info", `[ApplixirWindow] state → ${state}`);
  }, [state]);

  useEffect(() => {
    const themeStore = useThemeStore.getState();
    themeStore.applyAccentColorToDOM();
    themeStore.applyBorderRadiusToDOM();
  }, []);

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== apiOrigin) {
        log(
          "warn",
          `[ApplixirWindow] ignoring message from foreign origin=${e.origin} type=${e.data?.type}`,
        );
        return;
      }
      const type = e.data?.type;
      const detail = e.data?.detail;
      log("info", `[ApplixirWindow] message received: type=${type}${detail ? ` detail=${detail}` : ""}`);
      if (type === "nrc-ad-status" && (detail === "loaded" || detail === "start")) {
        adStartedRef.current = true;
      }
      if (type === "nrc-ad-complete") {
        setState("completed");
      }
      if (type === "nrc-ad-error") setState("error");
      if (type === "nrc-ad-done" || type === "nrc-ad-idle") {
        setState((prev) => (prev === "completed" ? "completed" : "finished"));
      }
      if (type === "nrc-reward") {
        const parsed = runCatchingJson(detail);
        if (parsed) {
          log("info", `[ApplixirWindow] reward received: +${parsed.points} → ${parsed.balance} (streak ${parsed.streakDays})`);
          setStreakDays(parsed.streakDays);
          setPoints(parsed.balance);
          setReward({ points: parsed.points, balance: parsed.balance, key: Date.now() });
        }
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [apiOrigin]);

  useEffect(() => {
    if (!reward) return;
    const timer = window.setTimeout(() => setReward(null), 4000);
    return () => window.clearTimeout(timer);
  }, [reward]);

  useEffect(() => {
    if (state !== "playing") return;
    adStartedRef.current = false;
    const timer = window.setTimeout(() => {
      if (!adStartedRef.current) {
        log("warn", "[ApplixirWindow] watchdog: no ad activity after 30s, treating as no-ad");
        setState("finished");
      }
    }, 30000);
    return () => window.clearTimeout(timer);
  }, [state]);

  return (
    <div
      className="flex flex-col h-screen w-screen text-white overflow-hidden relative backdrop-blur-lg border-2 select-none"
      style={{
        backgroundColor: bgColor,
        backgroundImage: `linear-gradient(to bottom right, ${bgColor}, rgba(0,0,0,0.9))`,
        borderColor: `${accentColor.value}30`,
        boxShadow: `0 0 15px ${accentColor.value}30, inset 0 0 10px ${accentColor.value}20`,
      }}
    >
      <BorderGlowEffects accent={accentColor.value} />
      <Titlebar points={points} />

      <div className="relative z-10 flex-1 min-h-0 flex">
        <div className="relative flex-1 p-4 flex flex-col min-h-0">
          <div className="relative flex-1 min-h-0 rounded-lg overflow-hidden border border-white/10 bg-black">
            {reward && <RewardPop key={reward.key} points={reward.points} balance={reward.balance} />}
            {pageUrl && (state === "loading" || state === "playing") && (
              <iframe
                key={attempt}
                src={pageUrl}
                title="AppLixir"
                className="w-full h-full border-0"
                sandbox="allow-scripts allow-same-origin allow-forms"
                allow="autoplay; fullscreen"
                onLoad={() => {
                  log("info", "[ApplixirWindow] iframe loaded");
                  setState((prev) => (prev === "loading" ? "playing" : prev));
                }}
              />
            )}

            {state === "loading" && (
              <Overlay
                icon="svg-spinners:ring-resize"
                color={accentColor.value}
                text={t("applixir.window.loading")}
              />
            )}
            {state === "completed" && (
              <Overlay
                icon="solar:check-circle-bold"
                color={accentColor.value}
                text={t("applixir.completed")}
                action={{ label: t("applixir.window.watch_another"), onClick: watchAnother, disabled: busy }}
              />
            )}
            {state === "finished" && (
              <Overlay
                icon="solar:info-circle-bold"
                color={accentColor.value}
                text={t("applixir.window.no_ad")}
                action={{ label: t("applixir.window.try_again"), onClick: watchAnother, disabled: busy }}
              />
            )}
            {state === "error" && (
              <Overlay
                icon="solar:danger-triangle-bold"
                color="#ef4444"
                text={t("applixir.window.error")}
                action={{ label: t("applixir.window.try_again"), onClick: watchAnother, disabled: busy }}
              />
            )}
          </div>

          <StreakTrack streakDays={streakDays} />
        </div>

        <Sidebar state={state} />
      </div>
    </div>
  );
}
