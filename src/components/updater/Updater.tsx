"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Icon } from "@iconify/react";
import { useThemeStore } from "../../store/useThemeStore";
import { useFontStore } from "../../store/font-store";
import {
  BACKGROUND_EFFECTS,
  useBackgroundEffectStore,
} from "../../store/background-effect-store";
import { cn } from "../../lib/utils";
import { gsap } from "gsap";
import { Button } from "../ui/buttons/Button";
import { useTranslation } from "react-i18next";
import { NebulaGrid } from "../effects/NebulaGrid";
import { NebulaParticles } from "../effects/NebulaParticles";
import { NebulaWaves } from "../effects/NebulaWaves";
import { NebulaVoxels } from "../effects/NebulaVoxels";
import { NebulaLightning } from "../effects/NebulaLightning";
import { NebulaLiquidChrome } from "../effects/NebulaLiquidChrome";
import { MatrixRainEffect } from "../effects/MatrixRainEffect";
import { EnchantmentParticlesEffect } from "../effects/EnchantmentParticlesEffect";
import { useAnimationsEnabled, useEntranceAnimation } from "../../hooks/useEntranceAnimation";

interface UpdaterStatusPayload {
  message: string;
  status:
    | "checking"
    | "downloading"
    | "installing"
    | "uptodate"
    | "pending"
    | "error"
    | "finished"
    | "close";
  progress?: number;
  total?: number;
  chunk?: number;
}

export default function Updater() {
  const { t } = useTranslation();
  const animationsEnabled = useAnimationsEnabled();
  const [statusMessage, setStatusMessage] = useState<string>("");
  const [progress, setProgress] = useState<number | null>(null);
  const [status, setStatus] =
    useState<UpdaterStatusPayload["status"]>("checking");
  const [isThemeLoaded, setIsThemeLoaded] = useState(false);
  const logoRef = useRef<HTMLImageElement>(null);
  const progressRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const appWindow = useMemo(() => getCurrentWindow(), []);
  const closeTimerRef = useRef<NodeJS.Timeout | null>(null);

  const accentColor = useThemeStore((state) => state.accentColor);
  const currentEffect = useBackgroundEffectStore(
    (state) => state.currentEffect,
  );

  useEffect(() => {
    const checkThemeLoaded = () => {
      if (accentColor && accentColor.value) {
        setIsThemeLoaded(true);
        return;
      }
      setTimeout(checkThemeLoaded, 50);
    };
    checkThemeLoaded();
  }, [accentColor]);

  useEffect(() => {
    useFontStore.getState().applyFontToDOM();
  }, []);

  useEntranceAnimation(
    containerRef,
    { opacity: 0, y: 20, scale: 0.95 },
    { opacity: 1, y: 0, scale: 1, duration: 0.6, ease: "back.out(1.2)" },
  );

  useEffect(() => {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }

    const unlistenPromise = listen<UpdaterStatusPayload>(
      "updater_status",
      (event) => {
        const {
          message,
          status: newStatus,
          progress: eventProgress,
        } = event.payload;

        if (closeTimerRef.current) {
          clearTimeout(closeTimerRef.current);
          closeTimerRef.current = null;
        }

        setStatusMessage(message);
        setStatus(newStatus);

        if (
          newStatus === "downloading" &&
          typeof eventProgress === "number" &&
          eventProgress >= 0 &&
          eventProgress <= 100
        ) {
          setProgress(eventProgress);
          setStatusMessage(t('updater.downloading', { progress: eventProgress }));

        } else {
          setProgress(null);
        }

        switch (newStatus) {
          case "uptodate":
          case "finished":
            appWindow
              .close()
              .catch((err: Error) =>
                console.error(
                  "Failed to close updater window on completion:",
                  err,
                ),
              );
            break;
          case "error":
            break;
          case "close":
            appWindow
              .close()
              .catch((err: Error) =>
                console.error(
                  "Failed to close updater window on 'close' event:",
                  err,
                ),
              );
            break;
        }
      },
    );

    return () => {
      unlistenPromise
        .then((f) => f())
        .catch((err: Error) =>
          console.error("Failed to unlisten updater events:", err),
        );
      if (closeTimerRef.current) {
        clearTimeout(closeTimerRef.current);
      }
    };
  }, [appWindow, t]);

  useEffect(() => {
    const bar = progressRef.current;
    if (!bar) return;
    gsap.to(bar, {
      width: `${progress ?? 0}%`,
      duration: animationsEnabled ? 0.3 : 0,
      ease: "power1.out",
    });
    return () => { gsap.killTweensOf(bar, "width"); };
  }, [progress, animationsEnabled, isThemeLoaded]);

  const getStatusIcon = () => {
    switch (status) {
      case "checking":
        return (
          <Icon icon="solar:refresh-bold" aria-hidden="true" className={`w-4 h-4 shrink-0 ${animationsEnabled ? "animate-spin" : ""}`} />
        );
      case "downloading":
        return <Icon icon="solar:download-bold" aria-hidden="true" className="w-4 h-4 shrink-0" />;
      case "installing":
        return <Icon icon="solar:box-bold" aria-hidden="true" className="w-4 h-4 shrink-0" />;
      case "uptodate":
      case "finished":
        return <Icon icon="solar:check-circle-bold" aria-hidden="true" className="w-4 h-4 shrink-0" />;
      case "error":
        return <Icon icon="solar:danger-triangle-bold" aria-hidden="true" className="w-4 h-4 shrink-0" />;
      default:
        return <Icon icon="solar:info-circle-bold" aria-hidden="true" className="w-4 h-4 shrink-0" />;
    }
  };

  const handleManualClose = () => {
    appWindow
      .close()
      .catch((err: Error) =>
        console.error("Failed to close updater window:", err),
      );
  };

  const renderBackgroundEffect = () => {
    const effect = currentEffect || BACKGROUND_EFFECTS.NEBULA_GRID;
    switch (effect) {
      case BACKGROUND_EFFECTS.NEBULA_PARTICLES:
        return <NebulaParticles opacity={0.1} />;
      case BACKGROUND_EFFECTS.NEBULA_WAVES:
        return <NebulaWaves opacity={0.1} />;
      case BACKGROUND_EFFECTS.NEBULA_VOXELS:
        return <NebulaVoxels opacity={0.1} />;
      case BACKGROUND_EFFECTS.NEBULA_LIGHTNING:
        return <NebulaLightning opacity={0.1} />;
      case BACKGROUND_EFFECTS.NEBULA_LIQUID_CHROME:
        return <NebulaLiquidChrome opacity={0.1} />;
      case BACKGROUND_EFFECTS.MATRIX_RAIN:
        return <MatrixRainEffect opacity={0.1} />;
      case BACKGROUND_EFFECTS.ENCHANTMENT_PARTICLES:
        return <EnchantmentParticlesEffect opacity={0.1} />;
      case BACKGROUND_EFFECTS.NEBULA_GRID:
      default:
        return <NebulaGrid opacity={0.1} />;
    }
  };

  if (!isThemeLoaded || !accentColor || !accentColor.value) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-black">
        <div className={cn("text-white text-xs font-smallcaps", animationsEnabled && "animate-pulse")}>
          {t('updater.loading_theme')}
        </div>
      </div>
    );
  }

  const safeAccentColor = accentColor.value || "#FFFFFF";

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-black/80 backdrop-blur-md flex items-center justify-center">
      {renderBackgroundEffect()}

      <div
        ref={containerRef}
        className={cn(
          "relative flex flex-col items-center justify-between text-center",
          "border rounded-none",
          "w-full h-full",
        )}
        style={{
          backgroundColor: `${safeAccentColor}30`,
          borderColor: `${safeAccentColor}70`,
        }}
      >
        <div className="w-full h-6 shrink-0" />

        <div className="flex-1 min-h-0 min-w-0 w-full overflow-y-auto overflow-x-hidden custom-scrollbar px-6">
        <div className="min-h-full w-full flex flex-col items-center justify-center gap-8">
          <div className="shrink-0 flex flex-col items-center">
            <img
              ref={logoRef}
              src="/logo.png"
              alt="NoRiskClient Logo"
              className="w-32 h-32 object-contain mb-1"
            />
            <p className="text-xs font-smallcaps text-white/70">
              {t('updater.title')}
            </p>
          </div>

          <div role={status === "error" ? "alert" : "status"} className="shrink-0 min-w-0 w-full flex items-center justify-center mb-4">
            {status === "uptodate" || status === "finished" ? (
              <div
                className={cn(
                  "min-w-0 max-w-full flex items-center justify-center gap-2 py-2 px-4",
                  "border rounded-md",
                )}
                style={{
                  backgroundColor: `${safeAccentColor}30`,
                  borderColor: `${safeAccentColor}70`,
                }}
              >
                <Icon
                  icon="solar:check-circle-bold"
                  aria-hidden="true"
                  className="w-5 h-5 shrink-0 text-green-400"
                />
                <span className="min-w-0 font-smallcaps text-xs text-white [overflow-wrap:anywhere]">
                  {t('updater.complete')}
                </span>
              </div>
            ) : status === "error" ? (
              <div
                className={cn(
                  "min-w-0 max-w-full flex items-start justify-center gap-2 py-2 px-4",
                  "border rounded-md",
                )}
                style={{
                  backgroundColor: "#ef444430",
                  borderColor: "#ef444470",
                }}
              >
                <Icon
                  icon="solar:danger-triangle-bold"
                  aria-hidden="true"
                  className="w-5 h-5 shrink-0 text-red-400"
                />
                <span className="min-w-0 font-smallcaps text-xs text-white [overflow-wrap:anywhere]">
                  {statusMessage}
                </span>
              </div>
            ) : (
              <div
                className={cn(
                  "min-w-0 max-w-full flex items-center justify-center gap-2 py-2 px-4",
                  "border rounded-md",
                )}
                style={{
                  backgroundColor: `${safeAccentColor}30`,
                  borderColor: `${safeAccentColor}70`,
                }}
              >
                {getStatusIcon()}
                <span className="min-w-0 font-smallcaps text-xs text-white [overflow-wrap:anywhere]">
                  {statusMessage || t('updater.initializing')}
                </span>
              </div>
            )}
          </div>

            <div
              role={progress !== null ? "progressbar" : undefined}
              aria-label={t("updater.title")}
              aria-valuemin={progress !== null ? 0 : undefined}
              aria-valuemax={progress !== null ? 100 : undefined}
              aria-valuenow={progress ?? undefined}
              aria-hidden={progress === null}
              className="shrink-0 w-3/4 h-2.5 rounded-md overflow-hidden border"
              style={{
                backgroundColor: `${safeAccentColor}15`,
                borderColor: `${safeAccentColor}50`,
                visibility: progress === null ? "hidden" : "visible",
              }}
            >
              <div
                ref={progressRef}
                className="h-full rounded-sm"
                style={{
                  width: "0%",
                  backgroundColor: safeAccentColor,
                }}
              />
            </div>
        </div>
        </div>

        <div className="w-full h-[5.625rem] shrink-0 p-6 flex items-center justify-center">
          {status === "error" && (
            <Button
              variant="destructive"
              size="sm"
              onClick={handleManualClose}
              icon={<Icon icon="solar:close-circle-bold" className="w-4 h-4" />}
            >
              {t('common.close')}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
