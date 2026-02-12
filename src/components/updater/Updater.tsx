"use client";

import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Icon } from "@iconify/react";
import { useThemeStore } from "../../store/useThemeStore";
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
  const [statusMessage, setStatusMessage] = useState<string>("");
  const [progress, setProgress] = useState<number | null>(null);
  const [status, setStatus] =
    useState<UpdaterStatusPayload["status"]>("checking");
  const [isThemeLoaded, setIsThemeLoaded] = useState(false);
  const logoRef = useRef<HTMLImageElement>(null);
  const progressRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const appWindow = getCurrentWindow();
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
    if (containerRef.current) {
      gsap.fromTo(
        containerRef.current,
        { opacity: 0, y: 20, scale: 0.95 },
        { opacity: 1, y: 0, scale: 1, duration: 0.6, ease: "back.out(1.2)" },
      );
    }
  }, []);

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

          if (progressRef.current) {
            gsap.to(progressRef.current, {
              width: `${eventProgress}%`,
              duration: 0.3,
              ease: "power1.out",
            });
          }
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
  }, [appWindow]);

  const getStatusIcon = () => {
    switch (status) {
      case "checking":
        return (
          <Icon icon="solar:refresh-bold" className="w-4 h-4 animate-spin" />
        );
      case "downloading":
        return <Icon icon="solar:download-bold" className="w-4 h-4" />;
      case "installing":
        return <Icon icon="solar:box-bold" className="w-4 h-4" />;
      case "uptodate":
      case "finished":
        return <Icon icon="solar:check-circle-bold" className="w-4 h-4" />;
      case "error":
        return <Icon icon="solar:danger-triangle-bold" className="w-4 h-4" />;
      default:
        return <Icon icon="solar:info-circle-bold" className="w-4 h-4" />;
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
        <div className="animate-pulse text-white text-lg font-minecraft">
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
        <div className="w-full pt-6" />

        <div className="flex-1 w-full flex flex-col items-center justify-center px-6 gap-8">
          <div className="flex flex-col items-center">
            <img
              ref={logoRef}
              src="/logo.png"
              alt="NoRiskClient Logo"
              className="w-32 h-32 object-contain mb-1"
            />
            <p className="text-lg font-minecraft text-white/70 lowercase">
              {t('updater.title')}
            </p>
          </div>

          <div className="flex items-center justify-center mb-4">
            {status === "uptodate" || status === "finished" ? (
              <div
                className={cn(
                  "flex items-center justify-center gap-2 py-2 px-4",
                  "border rounded-md",
                )}
                style={{
                  backgroundColor: `${safeAccentColor}30`,
                  borderColor: `${safeAccentColor}70`,
                }}
              >
                <Icon
                  icon="solar:check-circle-bold"
                  className="w-5 h-5 text-green-400"
                />
                <span className="font-minecraft text-lg text-white">
                  {t('updater.complete')}
                </span>
              </div>
            ) : status === "error" ? (
              <div
                className={cn(
                  "flex items-center justify-center gap-2 py-2 px-4",
                  "border rounded-md",
                )}
                style={{
                  backgroundColor: "#ef444430",
                  borderColor: "#ef444470",
                }}
              >
                <Icon
                  icon="solar:danger-triangle-bold"
                  className="w-5 h-5 text-red-400"
                />
                <span className="font-minecraft text-lg text-white">
                  {statusMessage}
                </span>
              </div>
            ) : (
              <div
                className={cn(
                  "flex items-center justify-center gap-2 py-2 px-4",
                  "border rounded-md",
                )}
                style={{
                  backgroundColor: `${safeAccentColor}30`,
                  borderColor: `${safeAccentColor}70`,
                }}
              >
                {getStatusIcon()}
                <span className="font-minecraft text-lg text-white">
                  {statusMessage || t('updater.initializing')}
                </span>
              </div>
            )}
          </div>

          {progress !== null && (
            <div
              className="w-3/4 h-2.5 rounded-md overflow-hidden border"
              style={{
                backgroundColor: `${safeAccentColor}15`,
                borderColor: `${safeAccentColor}50`,
              }}
            >
              <div
                ref={progressRef}
                className="h-full rounded-sm"
                style={{
                  width: `${progress}%`,
                  backgroundColor: safeAccentColor,
                }}
              />
            </div>
          )}
        </div>

        <div className="w-full p-6 flex justify-center">
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
