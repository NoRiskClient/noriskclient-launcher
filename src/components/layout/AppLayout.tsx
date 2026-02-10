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
import { Snowfall } from "../../features/snow-effect/Snowfall";
import { useSnowEffectStore } from "../../store/snow-effect-store";
import { useLauncherTheme } from "../../hooks/useLauncherTheme";
import * as ConfigService from "../../services/launcher-config-service";
import { SocialsModal } from "../modals/SocialsModal";
import { FriendsSidebar } from "../friends/FriendsSidebar";
// TODO: Re-enable when WebSocket is stable
// import { useFriendsWebSocket } from "../../hooks/useFriendsWebSocket";
import { useFriendsStore } from "../../store/friends-store";
import { useChatStore } from "../../store/chat-store";
import { checkUpdateAvailable, downloadAndInstallUpdate } from "../../services/nrc-service";
import type { UpdateInfo } from "../../types/updater";
import { ProfileWizardV2Modal } from "../modals/ProfileWizardV2Modal";
import { ProfileSettingsModal } from "../modals/ProfileSettingsModal";
import { ProfileDuplicateModal } from "../modals/ProfileDuplicateModal";
import { exit, relaunch } from '@tauri-apps/plugin-process';
import { Tooltip } from "../ui/Tooltip";
import { toast } from 'react-hot-toast';

const navItems = [
  { id: "play", icon: "solar:play-bold", label: "Play" },
  { id: "profiles", icon: "solar:user-id-bold", label: "Profiles" },
  { id: "mods", icon: "solar:widget-bold", label: "Mods" },
  { id: "skins", icon: "solar:emoji-funny-circle-bold", label: "Skins" },
  { id: "capes", icon: "solar:shop-bold", label: "Capes" },
  // DISABLED: Advent Calendar (seasonal feature)
  // { id: "advent-calendar", icon: "solar:gift-bold", label: "Advent" },
  { id: "settings", icon: "solar:settings-bold", label: "Settings" },
];

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
  const launcherRef = useRef<HTMLDivElement>(null);
  const backgroundPatternRef = useRef<HTMLDivElement>(null);
  const minimizeRef = useRef<HTMLDivElement>(null);
  const maximizeRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLDivElement>(null);
  const { currentEffect } = useBackgroundEffectStore();
  const { qualityLevel } = useQualitySettingsStore();
  const { isBackgroundAnimationEnabled, accentColor: themeAccentColor, accentColor } = useThemeStore();
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
            closeRef.current.addEventListener("click", () =>
              exit(0),
            );
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

  const renderBackgroundEffect = () => {
    // Show theme background image only on play screen - override all other effects
    if (isThemeActive && selectedTheme?.backgroundImage && activeTab === "play") {
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
            style={{ backgroundColor: hexToRgbaWithLowOpacity(themeAccentColor.value) }}
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
      className="h-screen w-full bg-black/50 backdrop-blur-lg border-2 overflow-hidden relative flex shadow-[0_0_25px_rgba(0,0,0,0.4)]"
      style={{
        backgroundColor: backgroundColor,
        backgroundSize: "cover",
        backgroundPosition: "center",
        backgroundImage: `linear-gradient(to bottom right, ${backgroundColor}, rgba(0,0,0,0.9))`,
        borderColor: `${themeAccentColor.value}30`,
        boxShadow: `0 0 15px ${themeAccentColor.value}30, inset 0 0 10px ${themeAccentColor.value}20`,
      }}
    >
      <BorderGlowEffects accentColor={themeAccentColor.value} />

      <VerticalNavbar
        items={navItems}
        activeItem={activeTab}
        onItemClick={onNavChange}
        className="h-full border-r-2 z-10"
        version={appConfig.version}
      />

      <div className="flex-1 flex flex-col h-full overflow-hidden">
        <HeaderBar
          minimizeRef={minimizeRef}
          maximizeRef={maximizeRef}
          closeRef={closeRef}
        />

        <div className="flex-1 relative overflow-hidden">
          {renderBackgroundEffect()}
          {/* Snow overlay - independent of theme/background */}
          {isSnowEnabled && <Snowfall />}

          <div className="relative z-10 h-full overflow-hidden custom-scrollbar">
            {children}
          </div>
        </div>
      </div>
      {/* Global Modals Portal */}
      <SocialsModal />
      <ProfileWizardV2Modal />
      <ProfileSettingsModal />
      <ProfileDuplicateModal />
      <FriendsSidebar />
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
  const accentColor = useThemeStore((state) => state.accentColor);
  const [appVersion, setAppVersion] = useState<string | null>(null);
  const [availableUpdate, setAvailableUpdate] = useState<UpdateInfo | null>(null);
  const [isUpdating, setIsUpdating] = useState(false);

  const handleUpdateClick = async () => {
    if (isUpdating) return; // Prevent multiple simultaneous downloads

    setIsUpdating(true);
    try {
      await toast.promise(
        downloadAndInstallUpdate(),
        {
          loading: 'Downloading and installing update...',
          success: 'Update installed successfully! Application will restart.',
          error: (err) => `Update failed: ${err instanceof Error ? err.message : String(err)}`,
        }
      );
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

    const mixedR = Math.round(rgb.r * accentWeight + warningRgb.r * warningWeight);
    const mixedG = Math.round(rgb.g * accentWeight + warningRgb.g * warningWeight);
    const mixedB = Math.round(rgb.b * accentWeight + warningRgb.b * warningWeight);

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
    const updateCheckInterval = setInterval(() => {
      console.log("Performing scheduled update check...");
      checkForUpdates();
    }, 4 * 60 * 60 * 1000);

    return () => {
      clearInterval(updateCheckInterval);
    };
  }, []);

  return (
    <div
      className="h-20 flex-shrink-0 border-b-2 backdrop-blur-lg flex items-center justify-between px-8 z-10"
      style={{
        borderColor: `${accentColor.value}40`,
        backgroundColor: `rgba(${Number.parseInt(accentColor.value.slice(1, 3), 16)}, ${Number.parseInt(
          accentColor.value.slice(3, 5),
          16,
        )}, ${Number.parseInt(accentColor.value.slice(5, 7), 16)}, 0.01)`,
      }}
      data-tauri-drag-region
    >
      <div className="flex items-center gap-4" data-tauri-drag-region>
        <NavigationHistory />

        <div className="flex flex-col items-start -mt-2.5">
          <div className="flex items-center gap-3">
            <h1
              className="font-minecraft text-4xl tracking-wider font-bold lowercase text-shadow"
              data-tauri-drag-region
            >
              noriskclient
            </h1>
            {availableUpdate && (
              <Tooltip content={isUpdating ? 'Downloading update...' : `Click to update: ${availableUpdate.version}`}>
                <div
                  className={`mt-2.5 ${isUpdating ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}`}
                  onClick={handleUpdateClick}
                >
                  <Icon
                    icon={isUpdating ? "solar:download-minimalistic-bold" : "solar:download-minimalistic-bold"}
                    className={`w-6 h-6 transition-colors ${isUpdating ? 'animate-pulse' : ''}`}
                    style={{
                      color: accentColor.value,
                    }}
                  />
                </div>
              </Tooltip>
            )}
          </div>
          <span className="text-white/70 font-minecraft-ten text-[8px] font-normal -mt-2.5">
            v{appVersion || "?.?.?"}
          </span>
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
  return (
    <div className="flex items-center gap-3 ml-4">
      <div
        ref={minimizeRef}
        className="titlebar-button-borderless w-5 h-5 flex items-center justify-center text-white/60 hover:text-white transition-colors cursor-pointer"
        title="Minimize"
      >
        <Icon icon="pixel:minus-solid" className="w-4 h-4" />
      </div>
      <div
        ref={maximizeRef}
        className="titlebar-button-borderless w-5 h-5 flex items-center justify-center text-white/60 hover:text-white transition-colors cursor-pointer"
        title="Maximize"
      >
        <Icon icon="pixel:expand-solid" className="w-4 h-4" />
      </div>
      <div
        ref={closeRef}
        className="titlebar-button-borderless w-5 h-5 flex items-center justify-center text-white/60 hover:text-red-500 transition-colors cursor-pointer"
        title="Close"
      >
        <Icon icon="pixel:window-close-solid" className="w-4 h-4" />
      </div>
    </div>
  );
}
