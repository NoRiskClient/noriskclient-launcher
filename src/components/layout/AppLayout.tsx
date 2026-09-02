"use client";

import type React from "react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { gsap } from "gsap";
import { Icon } from "@iconify/react";

import { VerticalNavbar } from ".././navigation/VerticalNavbar";
import { UserProfileBar } from ".././header/UserProfileBar";
import { NavigationHistory } from "../ui/NavigationHistory";
import { useThemeStore } from "../../store/useThemeStore";
import {
  BACKGROUND_EFFECTS,
  useBackgroundEffectStore,
} from "../../store/background-effect-store";
import { useQualitySettingsStore } from "../../store/quality-settings-store";
import { MatrixRainEffect } from ".././effects/MatrixRainEffect";
import { EnchantmentParticlesEffect } from ".././effects/EnchantmentParticlesEffect";
import { NebulaWaves } from ".././effects/NebulaWaves";
import { NebulaParticles } from ".././effects/NebulaParticles";
import { NebulaGrid } from ".././effects/NebulaGrid";
import { NebulaVoxels } from ".././effects/NebulaVoxels";
import { NebulaLightning } from ".././effects/NebulaLightning";
import { NebulaLiquidChrome } from ".././effects/NebulaLiquidChrome";
import { RetroGridEffect } from "../effects/RetroGridEffect";
import PlainBackground from "../effects/PlainBackground";
import CustomMediaBackground from "../effects/CustomMediaBackground";
import { Snowfall } from "../../features/snow-effect/Snowfall";
import { useSnowEffectStore } from "../../store/snow-effect-store";
import { useLauncherTheme } from "../../hooks/useLauncherTheme";
import * as ConfigService from "../../services/launcher-config-service";
import { SocialsModal } from "../modals/SocialsModal";
import { FriendsSidebar } from "../friends/FriendsSidebar";
import { FullRiskTopNavbar } from "../navigation/FullRiskTopNavbar";
// TODO: Re-enable when WebSocket is stable
// import { useFriendsWebSocket } from "../../hooks/useFriendsWebSocket";
import { useFriendsStore } from "../../store/friends-store";
import { useChatStore } from "../../store/chat-store";
import {
  checkUpdateAvailable,
  downloadAndInstallUpdate,
} from "../../services/nrc-service";
import type { UpdateInfo } from "../../types/updater";
import { ProfileWizardV2Modal } from "../modals/ProfileWizardV2Modal";
import { ProfileSettingsModal } from "../modals/ProfileSettingsModal";
import { SettingsModal } from "../modals/SettingsModal";
import { ProfileDuplicateModal } from "../modals/ProfileDuplicateModal";
import { exit, relaunch } from "@tauri-apps/plugin-process";
import { Tooltip } from "../ui/Tooltip";
import { HeaderInfoCarousel } from "../header/HeaderInfoCarousel";
import { toast } from "react-hot-toast";
import { useTranslation } from "react-i18next";
import { parseErrorMessage } from "../../utils/error-utils";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { ColorPicker } from "../ColorPicker";
import { RangeSlider } from ".././ui/RangeSlider";
import { Button } from "../ui/buttons/Button";
import { ThemeSelector } from "../ThemeSelector";
import { parseErrorMessage } from "../../utils/error-utils";

const appConfig = {
  version: "v0.5.22",
};

interface AppLayoutProps {
  children: ReactNode;
  activeTab: string;
  onNavChange: (tabId: string) => void;
}

export function AppLayout({
  children,
  activeTab,
  onNavChange,
}: AppLayoutProps) {
  const { t } = useTranslation();
  const launcherRef = useRef<HTMLDivElement>(null);
  const backgroundPatternRef = useRef<HTMLDivElement>(null);
  const minimizeRef = useRef<HTMLDivElement>(null);
  const maximizeRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLDivElement>(null);
  const {
    currentEffect,
    customMediaUrl,
    customMediaOnlyOnPlay,
    customMediaHideEffects,
  } = useBackgroundEffectStore();
  const isCustomMediaVisible =
    Boolean(customMediaUrl) && (!customMediaOnlyOnPlay || activeTab === "play");
  const shouldShowEffects = !(isCustomMediaVisible && customMediaHideEffects);

  const navItems = [
    { id: "play", icon: "solar:play-bold", label: t("nav.play") },
    { id: "profiles", icon: "solar:user-id-bold", label: t("nav.profiles") },
    { id: "mods", icon: "solar:widget-bold", label: t("nav.mods") },
    {
      id: "skins",
      icon: "solar:emoji-funny-circle-bold",
      label: t("nav.skins"),
    },
    { id: "capes", icon: "solar:shop-bold", label: t("nav.capes") },
    // DISABLED: Advent Calendar (seasonal feature)
    // { id: "advent-calendar", icon: "solar:gift-bold", label: t("nav.advent") },
    {
      id: "settings",
      icon: "solar:settings-bold",
      label: t("nav.settings"),
      isAction: true,
    },
  ];
  const { qualityLevel } = useQualitySettingsStore();
  const {
    isBackgroundAnimationEnabled,
    accentColor: themeAccentColor,
    accentColor,
    uiStylePreset,
    customLauncherBackground,
    customLauncherBackgroundType,
    hasCompletedFirstInstallSetupWizard,
  } = useThemeStore();
  const isFullRiskStyle = uiStylePreset === "fullrisk";
  const navItems = isFullRiskStyle
    ? [
        {
          id: "skins",
          icon: "solar:emoji-funny-circle-bold",
          label: t("nav.skins"),
        },
        { id: "capes", icon: "solar:shop-bold", label: "cape" },
        { id: "servers", icon: "solar:server-bold", label: "servers" },
        { id: "play", icon: "solar:play-bold", label: t("nav.play") },
        {
          id: "profiles",
          icon: "solar:user-id-bold",
          label: t("nav.profiles"),
        },
        { id: "mods", icon: "solar:widget-bold", label: "addons" },
        {
          id: "settings",
          icon: "solar:settings-bold",
          label: t("nav.settings"),
        },
      ]
    : [
        { id: "play", icon: "solar:play-bold", label: t("nav.play") },
        { id: "mods", icon: "solar:widget-bold", label: t("nav.mods") },
        {
          id: "skins",
          icon: "solar:emoji-funny-circle-bold",
          label: t("nav.skins"),
        },
        { id: "capes", icon: "solar:shop-bold", label: t("nav.capes") },
        {
          id: "profiles",
          icon: "solar:user-id-bold",
          label: t("nav.profiles"),
        },
        { id: "servers", icon: "solar:server-bold", label: "servers" },
        {
          id: "settings",
          icon: "solar:settings-bold",
          label: t("nav.settings"),
        },
      ];
  const { isEnabled: isSnowEnabled } = useSnowEffectStore();
  const { selectedTheme, isThemeActive } = useLauncherTheme();
  const { connectWebSocket, loadCurrentUser, loadFriends } = useFriendsStore();
  const { loadChats } = useChatStore();

  // TODO: Re-enable when WebSocket is stable
  // useFriendsWebSocket();

  useEffect(() => {
    const initFriends = async () => {
      try {
        await loadCurrentUser();
        await loadFriends();
        await loadChats();
        // TODO: Re-enable when WebSocket is stable
        // await connectWebSocket();
      } catch (e) {
        // Silently fail - user might not be logged in yet
      }
    };
    initFriends();
  }, []);

  const getComplementaryBackground = () => {
    const hexToRgb = (hex: string) => {
      const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
      return result
        ? {
            r: Number.parseInt(result[1], 16),
            g: Number.parseInt(result[2], 16),
            b: Number.parseInt(result[3], 16),
          }
        : { r: 34, g: 34, b: 34 };
    };

    const rgb = hexToRgb(themeAccentColor.value);

    const darkR = Math.floor(rgb.r * 0.1);
    const darkG = Math.floor(rgb.g * 0.1);
    const darkB = Math.floor(rgb.b * 0.1);

    const finalR = Math.min(darkR, 30);
    const finalG = Math.min(darkG, 30);
    const finalB = Math.min(darkB, 30);

    return `rgb(${finalR}, ${finalG}, ${finalB})`;
  };

  const getComplementaryBackgroundWithAlpha = (alpha: number) => {
    const rgb = getComplementaryBackground();
    return rgb.replace("rgb(", "rgba(").replace(")", `, ${alpha})`);
  };

  const backgroundColor = getComplementaryBackground();

  const getQualityParams = () => {
    switch (qualityLevel) {
      case "low":
        return { particleCount: 30, opacity: 0.2, speed: 0.5 };
      case "high":
        return { particleCount: 80, opacity: 0.4, speed: 1.5 };
      default:
        return { particleCount: 50, opacity: 0.3, speed: 1 };
    }
  };

  const qualityParams = getQualityParams();

  useEffect(() => {
    const ctx = gsap.context(() => {
      gsap.from(launcherRef.current, {
        opacity: 0,
        scale: 0.95,
        duration: 0.8,
        ease: "power3.out",
      });

      if (backgroundPatternRef.current) {
        gsap.to(backgroundPatternRef.current, {
          backgroundPosition: "100% 100%",
          duration: 120,
          repeat: -1,
          ease: "none",
        });
      }
    });

    const setupWindowControls = async () => {
      try {
        const tauriModule = await import("@tauri-apps/api/window").catch(
          () => null,
        );

        if (tauriModule) {
          const { Window } = tauriModule;
          const currentWindow = Window.getCurrent();

          if (minimizeRef.current) {
            minimizeRef.current.addEventListener("click", () =>
              currentWindow.minimize(),
            );
          }

          if (maximizeRef.current) {
            maximizeRef.current.addEventListener("click", () =>
              currentWindow.toggleMaximize(),
            );
          }

          if (closeRef.current) {
            closeRef.current.addEventListener("click", () => exit(0));
          }
        } else {
          console.log(
            "Tauri API not available, window controls will be decorative only",
          );
        }
      } catch (error) {
        console.error("Failed to initialize window controls:", error);
      }
    };

    setupWindowControls();

    return () => ctx.revert();
  }, []);

  const resolvedCustomBackground =
    customLauncherBackground && customLauncherBackgroundType === "absolutePath"
      ? convertFileSrc(customLauncherBackground)
      : customLauncherBackground;

  const renderCustomBackground = () => {
    if (!resolvedCustomBackground || qualityLevel === "potato") {
      return null;
    }

    return (
      <>
        <div
          className="absolute inset-0 bg-cover bg-center bg-no-repeat"
          style={{ backgroundImage: `url(${resolvedCustomBackground})` }}
        />
        <div className="absolute inset-0 bg-black/70" />
      </>
    );
  };

  const renderBackgroundEffect = () => {
    if (qualityLevel === "potato") {
      return null;
    }

    // Show theme background image only on play screen - override all other effects
    if (
      isThemeActive &&
      selectedTheme?.backgroundImage &&
      activeTab === "play"
    ) {
      return (
        <div
          className="absolute inset-0 bg-cover bg-center bg-no-repeat"
          style={{
            backgroundImage: `url(${selectedTheme.backgroundImage})`,
          }}
        />
      );
    }

    // Regular background effects for other tabs or when no theme background
    switch (currentEffect) {
      case BACKGROUND_EFFECTS.MATRIX_RAIN:
        return (
          <MatrixRainEffect
            speed={qualityParams.speed}
            opacity={qualityParams.opacity}
            forceEnable={false}
          />
        );
      case BACKGROUND_EFFECTS.ENCHANTMENT_PARTICLES:
        return (
          <EnchantmentParticlesEffect
            opacity={qualityParams.opacity}
            particleCount={qualityParams.particleCount}
            speed={qualityParams.speed}
            forceEnable={false}
          />
        );
      case BACKGROUND_EFFECTS.NEBULA_WAVES:
        return (
          <NebulaWaves
            opacity={qualityParams.opacity}
            speed={qualityParams.speed}
          />
        );
      case BACKGROUND_EFFECTS.NEBULA_PARTICLES:
        return (
          <NebulaParticles
            opacity={qualityParams.opacity}
            particleCount={qualityParams.particleCount}
            speed={qualityParams.speed}
          />
        );
      case BACKGROUND_EFFECTS.NEBULA_GRID:
        return (
          <NebulaGrid
            opacity={qualityParams.opacity}
            speed={qualityParams.speed}
            gridSize={30}
          />
        );
      case BACKGROUND_EFFECTS.NEBULA_VOXELS:
        return (
          <NebulaVoxels
            opacity={qualityParams.opacity}
            cubeCount={qualityParams.particleCount}
            speed={qualityParams.speed}
          />
        );
      case BACKGROUND_EFFECTS.NEBULA_LIGHTNING:
        return (
          <NebulaLightning
            opacity={qualityParams.opacity * 2}
            speed={qualityParams.speed}
            intensity={qualityParams.speed * 1.2}
            size={1.5}
          />
        );
      case BACKGROUND_EFFECTS.NEBULA_LIQUID_CHROME:
        return (
          <NebulaLiquidChrome
            opacity={qualityParams.opacity * 2}
            speed={qualityParams.speed * 0.2}
            amplitude={0.5}
            frequencyX={3}
            frequencyY={2}
          />
        );
      case BACKGROUND_EFFECTS.RETRO_GRID:
        const hexToRgbaWithLowOpacity = (hex: string) => {
          const r = parseInt(hex.slice(1, 3), 16);
          const g = parseInt(hex.slice(3, 5), 16);
          const b = parseInt(hex.slice(5, 7), 16);
          return `rgba(${r}, ${g}, ${b}, 0.05)`;
        };
        return (
          <div
            className="absolute inset-0"
            style={{
              backgroundColor: hexToRgbaWithLowOpacity(themeAccentColor.value),
            }}
          ></div>
        );
      case BACKGROUND_EFFECTS.PLAIN_BACKGROUND:
        return <PlainBackground accentColorValue={themeAccentColor.value} />;
      default:
        return (
          <div className="absolute inset-0 bg-red-500/20">
            Unknown effect: {currentEffect}
          </div>
        );
    }
  };

  return (
    <div
      ref={launcherRef}
      className="h-screen w-full overflow-hidden relative flex"
      style={{
        backgroundColor: backgroundColor,
        backgroundSize: "cover",
        backgroundPosition: "center",
        backgroundImage: isCustomMediaVisible
          ? `linear-gradient(to bottom right, ${getComplementaryBackgroundWithAlpha(0.3)}, rgba(0,0,0,0.5))`
          : `linear-gradient(to bottom right, ${backgroundColor}, rgba(0,0,0,0.9))`,
        border: isFullRiskStyle
          ? `0 solid ${themeAccentColor.value}00`
          : undefined,
        boxShadow: isFullRiskStyle
          ? "none"
          : `0 0 15px ${themeAccentColor.value}30, inset 0 0 10px ${themeAccentColor.value}20`,
      }}
    >
      {qualityLevel !== "potato" && (
        <BorderGlowEffects accentColor={themeAccentColor.value} />
      )}

      {!isFullRiskStyle && (
        <VerticalNavbar
          items={navItems}
          activeItem={activeTab}
          onItemClick={onNavChange}
          className="h-full border-r-2 z-10"
          version={appConfig.version}
        />
      )}

      <div className="flex-1 flex flex-col h-full overflow-hidden">
        <HeaderBar
          minimizeRef={minimizeRef}
          maximizeRef={maximizeRef}
          closeRef={closeRef}
        />
        {isFullRiskStyle && (
          <FullRiskTopNavbar
            items={navItems.map(({ id, label }) => ({ id, label }))}
            activeItem={activeTab}
            onItemClick={onNavChange}
          />
        )}

        <div className="flex-1 relative overflow-hidden">
          <CustomMediaBackground activeTab={activeTab} />
          {shouldShowEffects && renderBackgroundEffect()}
          {/* Snow overlay - independent of theme/background */}
          {shouldShowEffects && isSnowEnabled && <Snowfall />}

          <div className="relative z-10 h-full overflow-hidden custom-scrollbar">
            {children}
          </div>
        </div>
      </div>
      {/* Global Modals Portal */}
      <SocialsModal />
      <ProfileWizardV2Modal />
      <ProfileSettingsModal />
      <SettingsModal />
      <ProfileDuplicateModal />
      <FriendsSidebar />
      {!hasCompletedFirstInstallSetupWizard && <FirstInstallSetupWizard />}
    </div>
  );
}

function FirstInstallSetupWizard() {
  const {
    accentColor,
    borderRadius,
    setBorderRadius,
    setCustomLauncherBackground,
    completeFirstInstallSetupWizard,
  } = useThemeStore();
  const { qualityLevel, setQualityLevel } = useQualitySettingsStore();
  const { currentEffect, setCurrentEffect } = useBackgroundEffectStore();
  const [step, setStep] = useState(0);
  const [removeDefaults, setRemoveDefaults] = useState(true);
  const [backgroundUrl, setBackgroundUrl] = useState("");
  const [busy, setBusy] = useState(false);

  const steps = ["profiles", "performance", "theme", "background"];
  const isLastStep = step === steps.length - 1;

  const applyPerformancePreset = (mode: typeof qualityLevel) => {
    setQualityLevel(mode);
    if (mode === "potato") {
      setCurrentEffect(BACKGROUND_EFFECTS.NONE);
    } else if (mode === "low" && currentEffect === BACKGROUND_EFFECTS.NONE) {
      setCurrentEffect(BACKGROUND_EFFECTS.PLAIN_BACKGROUND);
    }
  };

  const pickBackground = async () => {
    const selected = await openDialog({
      multiple: false,
      filters: [
        { name: "Images", extensions: ["png", "jpg", "jpeg", "webp", "gif"] },
      ],
    });
    if (typeof selected === "string") {
      setCustomLauncherBackground(selected, "absolutePath");
      setBackgroundUrl("");
    }
  };

  const finish = async () => {
    setBusy(true);
    try {
      if (backgroundUrl.trim()) {
        setCustomLauncherBackground(backgroundUrl.trim(), "url");
      }
      if (removeDefaults) {
        await invoke("dismiss_standard_profiles");
      }
      completeFirstInstallSetupWizard();
      toast.success("Setup saved");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const renderStep = () => {
    if (steps[step] === "profiles") {
      return (
        <div className="space-y-4">
          <h3 className="font-minecraft text-3xl lowercase">Profiles</h3>
          <label className="flex items-center justify-between border border-white/10 bg-white/5 p-4 font-minecraft-ten">
            <span>Remove default profiles after setup</span>
            <input
              type="checkbox"
              checked={removeDefaults}
              onChange={(event) => setRemoveDefaults(event.target.checked)}
            />
          </label>
          <p className="font-minecraft-ten text-white/55">
            You can restore them later from the DEFAULT tab in profile creation.
          </p>
        </div>
      );
    }

    if (steps[step] === "performance") {
      return (
        <div className="space-y-4">
          <h3 className="font-minecraft text-3xl lowercase">Performance</h3>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {(["potato", "low", "medium", "high"] as const).map((mode) => (
              <button
                key={mode}
                onClick={() => applyPerformancePreset(mode)}
                className="border border-white/10 px-4 py-5 text-left font-minecraft-ten transition-colors"
                style={{
                  backgroundColor:
                    qualityLevel === mode
                      ? `${accentColor.value}70`
                      : "rgba(255,255,255,0.05)",
                }}
              >
                <div className="text-lg text-white">
                  {mode === "low"
                    ? "performance"
                    : mode === "medium"
                      ? "normal"
                      : mode === "high"
                        ? "quality"
                        : "potato"}
                </div>
                <div className="mt-1 text-xs text-white/55">
                  {mode === "potato"
                    ? "no effects, minimum work"
                    : mode === "low"
                      ? "simple visuals"
                      : mode === "medium"
                        ? "balanced"
                        : "full visuals"}
                </div>
              </button>
            ))}
          </div>
        </div>
      );
    }

    if (steps[step] === "theme") {
      return (
        <div className="space-y-5">
          <h3 className="font-minecraft text-3xl lowercase">Theme</h3>
          <ThemeSelector />
          <div className="grid gap-4 md:grid-cols-2">
            <div className="border border-white/10 bg-white/5 p-4">
              <div className="mb-3 font-minecraft-ten text-white/70">
                Accent color
              </div>
              <ColorPicker size="sm" />
            </div>
            <div className="border border-white/10 bg-white/5 p-4">
              <div className="mb-3 font-minecraft-ten text-white/70">
                Border roundness
              </div>
              <RangeSlider
                min={0}
                max={32}
                value={borderRadius}
                onChange={setBorderRadius}
                unit="px"
              />
            </div>
          </div>
        </div>
      );
    }

    return (
      <div className="space-y-4">
        <h3 className="font-minecraft text-3xl lowercase">Background</h3>
        <p className="font-minecraft-ten text-white/55">
          Images and GIFs are darkened automatically so the launcher stays
          readable and effects can still sit above them.
        </p>
        <div className="flex gap-2">
          <input
            value={backgroundUrl}
            onChange={(event) => setBackgroundUrl(event.target.value)}
            placeholder="https://... image or gif, or select from FILE ->"
            className="min-w-0 flex-1 border border-white/10 bg-black/40 px-3 py-3 font-minecraft-ten text-white outline-none"
          />
          <Button variant="ghost" onClick={pickBackground}>
            File
          </Button>
        </div>
        <Button
          variant="ghost"
          onClick={() => setCustomLauncherBackground(null, null)}
        >
          Clear custom background
        </Button>
      </div>
    );
  };

  return (
    <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/75 p-6">
      <div
        className="flex max-h-[88vh] w-full max-w-4xl flex-col overflow-hidden border-2 border-b-4 bg-black/92 text-white shadow-2xl backdrop-blur-md"
        style={{
          borderColor: accentColor.value,
          borderRadius: Math.max(borderRadius, 8),
        }}
      >
        <div className="flex items-center justify-between border-b border-white/10 p-5">
          <div>
            <h2 className="font-minecraft text-4xl lowercase">
              First install setup
            </h2>
            <p className="font-minecraft-ten text-white/55">
              step {step + 1} of {steps.length}
            </p>
          </div>
          <div className="flex gap-2">
            {steps.map((name, index) => (
              <button
                key={name}
                onClick={() => setStep(index)}
                className="h-2.5 w-10 transition-colors"
                style={{
                  backgroundColor:
                    index <= step
                      ? accentColor.value
                      : "rgba(255,255,255,0.18)",
                }}
                aria-label={name}
              />
            ))}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-6 custom-scrollbar">
          {renderStep()}
        </div>

        <div className="flex justify-between border-t border-white/10 p-5">
          <Button variant="ghost" onClick={completeFirstInstallSetupWizard}>
            Skip
          </Button>
          <div className="flex gap-3">
            <Button
              variant="ghost"
              onClick={() => setStep(Math.max(0, step - 1))}
              disabled={step === 0}
            >
              Back
            </Button>
            <Button
              onClick={isLastStep ? finish : () => setStep(step + 1)}
              disabled={busy}
            >
              {busy ? "Saving..." : isLastStep ? "Save" : "Next"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
function BorderGlowEffects({ accentColor }: { accentColor: string }) {
  return (
    <>
      <div
        className="absolute top-0 left-0 right-0 h-[2px]"
        style={{
          background: `linear-gradient(to right, transparent, ${accentColor}70, transparent)`,
        }}
      ></div>
      <div
        className="absolute bottom-0 left-0 right-0 h-[2px]"
        style={{
          background: `linear-gradient(to right, transparent, ${accentColor}70, transparent)`,
        }}
      ></div>
      <div
        className="absolute top-0 bottom-0 left-0 w-[2px]"
        style={{
          background: `linear-gradient(to bottom, transparent, ${accentColor}70, transparent)`,
        }}
      ></div>
      <div
        className="absolute top-0 bottom-0 right-0 w-[2px]"
        style={{
          background: `linear-gradient(to bottom, transparent, ${accentColor}70, transparent)`,
        }}
      ></div>
    </>
  );
}

interface HeaderBarProps {
  minimizeRef: React.RefObject<HTMLDivElement>;
  maximizeRef: React.RefObject<HTMLDivElement>;
  closeRef: React.RefObject<HTMLDivElement>;
}

function HeaderBar({ minimizeRef, maximizeRef, closeRef }: HeaderBarProps) {
  const { t } = useTranslation();
  const accentColor = useThemeStore((state) => state.accentColor);
  const uiStylePreset = useThemeStore((state) => state.uiStylePreset);
  const isFullRiskStyle = uiStylePreset === "fullrisk";
  const [appVersion, setAppVersion] = useState<string | null>(null);
  const [availableUpdate, setAvailableUpdate] = useState<UpdateInfo | null>(
    null,
  );
  const [isUpdating, setIsUpdating] = useState(false);

  const handleUpdateClick = async () => {
    if (isUpdating) return; // Prevent multiple simultaneous downloads

    setIsUpdating(true);
    try {
      await toast.promise(downloadAndInstallUpdate(), {
        loading: t("header.update.downloading"),
        success: t("header.update.success"),
        error: (err) =>
          t("header.update.failed", { error: parseErrorMessage(err) }),
      });
    } catch (error) {
      console.error("Failed to download and install update:", error);
      // Toast error is already handled by the promise toast
    } finally {
      setIsUpdating(false);
    }
  };

  // Calculate complementary/update highlight color based on current accent
  const getUpdateHighlightColor = () => {
    const hexToRgb = (hex: string) => {
      const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
      return result
        ? {
            r: Number.parseInt(result[1], 16),
            g: Number.parseInt(result[2], 16),
            b: Number.parseInt(result[3], 16),
          }
        : { r: 245, g: 158, b: 11 }; // fallback to amber
    };

    const rgb = hexToRgb(accentColor.value);

    // Calculate a complementary warning color
    // Mix current accent with amber/yellow for good visibility
    const accentWeight = 0.4; // How much of the accent color to include
    const warningWeight = 0.9; // How much of the warning color (amber)

    const warningRgb = { r: 245, g: 158, b: 100 }; // Amber base

    const mixedR = Math.round(
      rgb.r * accentWeight + warningRgb.r * warningWeight,
    );
    const mixedG = Math.round(
      rgb.g * accentWeight + warningRgb.g * warningWeight,
    );
    const mixedB = Math.round(
      rgb.b * accentWeight + warningRgb.b * warningWeight,
    );

    return `rgb(${mixedR}, ${mixedG}, ${mixedB})`;
  };

  useEffect(() => {
    const fetchVersion = async () => {
      try {
        const fetchedVersion = await ConfigService.getAppVersion();
        setAppVersion(fetchedVersion);
      } catch (error) {
        console.error("Failed to fetch app version:", error);
        setAppVersion("?.?.?");
      }
    };

    const checkForUpdates = async () => {
      try {
        const updateInfo = await checkUpdateAvailable();
        if (updateInfo) {
          console.log("Update available:", updateInfo);
          setAvailableUpdate(updateInfo);
        }
      } catch (error) {
        console.error("Failed to check for updates:", error);
        // Don't show error to user, just silently fail
      }
    };

    fetchVersion();
    checkForUpdates();

    // Check for updates every 4 hours (4 * 60 * 60 * 1000 = 14,400,000 ms)
    const updateCheckInterval = setInterval(
      () => {
        console.log("Performing scheduled update check...");
        checkForUpdates();
      },
      4 * 60 * 60 * 1000,
    );

    return () => {
      clearInterval(updateCheckInterval);
    };
  }, []);

  return (
    <div
      className={
        isFullRiskStyle
          ? "h-[68px] flex-shrink-0 border-b-[3px] flex items-center justify-between px-8 z-10"
          : "h-20 flex-shrink-0 border-b-2 backdrop-blur-lg flex items-center justify-between px-8 z-10"
      }
      style={{
        borderColor: isFullRiskStyle
          ? `${accentColor.value}80`
          : `${accentColor.value}40`,
        background: isFullRiskStyle
          ? "linear-gradient(180deg, rgba(34,33,38,0.98) 0%, rgba(26,25,28,0.98) 100%)"
          : undefined,
        backgroundColor: isFullRiskStyle
          ? undefined
          : `rgba(${Number.parseInt(accentColor.value.slice(1, 3), 16)}, ${Number.parseInt(
              accentColor.value.slice(3, 5),
              16,
            )}, ${Number.parseInt(accentColor.value.slice(5, 7), 16)}, 0.01)`,
        boxShadow: isFullRiskStyle
          ? `inset 0 -1px 0 rgba(255,255,255,0.05), 0 4px 0 rgba(0,0,0,0.22)`
          : undefined,
      }}
      data-tauri-drag-region
    >
      <div className="flex items-center gap-4" data-tauri-drag-region>
        {!isFullRiskStyle && <NavigationHistory />}

        <div className="flex flex-col items-start">
          <div className="flex items-center gap-3">
            <h1
              className={
                isFullRiskStyle
                  ? "font-smallcaps text-[34px] tracking-wider font-bold lowercase text-shadow"
                  : "font-smallcaps text-2xl tracking-wider font-bold lowercase text-shadow"
              }
              data-tauri-drag-region
            >
              {isFullRiskStyle ? "fullriskclient" : "noriskclient"}
            </h1>
            {availableUpdate && (
              <Tooltip
                content={
                  isUpdating
                    ? t("header.update.tooltip_updating")
                    : t("header.update.tooltip_available", {
                        version: availableUpdate.version,
                      })
                }
              >
                <div
                  className={
                    isUpdating
                      ? "cursor-not-allowed opacity-50"
                      : "cursor-pointer"
                  }
                  onClick={handleUpdateClick}
                >
                  <Icon
                    icon="solar:download-minimalistic-bold"
                    className={`w-6 h-6 transition-colors ${isUpdating ? "animate-pulse" : ""}`}
                    style={{
                      color: accentColor.value,
                    }}
                  />
                </div>
              </Tooltip>
            )}
          </div>
          <HeaderInfoCarousel version={appVersion} />
        </div>
      </div>

      <div className="flex items-center gap-4">
        <UserProfileBar />

        <WindowControls
          minimizeRef={minimizeRef}
          maximizeRef={maximizeRef}
          closeRef={closeRef}
        />
      </div>
    </div>
  );
}

interface WindowControlsProps {
  minimizeRef: React.RefObject<HTMLDivElement>;
  maximizeRef: React.RefObject<HTMLDivElement>;
  closeRef: React.RefObject<HTMLDivElement>;
}

function WindowControls({
  minimizeRef,
  maximizeRef,
  closeRef,
}: WindowControlsProps) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center gap-3 ml-4">
      <div
        ref={minimizeRef}
        className="titlebar-button-borderless w-5 h-5 flex items-center justify-center text-white/60 hover:text-white transition-colors cursor-pointer"
        title={t("window.minimize")}
      >
        <Icon icon="pixel:minus-solid" className="w-4 h-4" />
      </div>
      <div
        ref={maximizeRef}
        className="titlebar-button-borderless w-5 h-5 flex items-center justify-center text-white/60 hover:text-white transition-colors cursor-pointer"
        title={t("window.maximize")}
      >
        <Icon icon="pixel:expand-solid" className="w-4 h-4" />
      </div>
      <div
        ref={closeRef}
        className="titlebar-button-borderless w-5 h-5 flex items-center justify-center text-white/60 hover:text-red-500 transition-colors cursor-pointer"
        title={t("window.close")}
      >
        <Icon icon="pixel:window-close-solid" className="w-4 h-4" />
      </div>
    </div>
  );
}
