"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "@iconify/react";
import { Button } from ".././ui/buttons/Button";
import { Card } from ".././ui/Card";
import { ToggleSwitch } from ".././ui/ToggleSwitch";
import { Input } from ".././ui/Input";
import { ColorPicker } from ".././ColorPicker";
import { RadiusPicker } from ".././RadiusPicker";
import type { LauncherConfig } from "../../types/launcherConfig";
import * as ConfigService from "../../services/launcher-config-service";
import { useThemeStore } from "../../store/useThemeStore";
import {
  BACKGROUND_EFFECTS,
  useBackgroundEffectStore,
} from "../../store/background-effect-store";
import {
  type QualityLevel,
  useQualitySettingsStore,
} from "../../store/quality-settings-store";
import { SnowEffectToggle } from "../ui/SnowEffectToggle";
import { cn } from "../../lib/utils";
import { toast } from "react-hot-toast";
import { GroupTabs, type GroupTab } from ".././ui/GroupTabs";
import { ActionButton } from ".././ui/ActionButton";
import { Tooltip } from ".././ui/Tooltip";
import { SimpleTooltip } from ".././ui/Tooltip";
import { CompactSettingsGrid } from ".././ui/CompactSettingsGrid";
import EffectPreviewCard from ".././EffectPreviewCard";
import { RangeSlider } from ".././ui/RangeSlider";
import { openExternalUrl } from "../../services/tauri-service";
import { openLauncherDirectory } from "../../services/tauri-service";
import { useFlags } from "flagsmith/react";
import { useConfirmDialog } from "../../hooks/useConfirmDialog";
import { useGlobalModal } from "../../hooks/useGlobalModal";
import { ColorPickerModal } from "../modals/ColorPickerModal";
import { ThemeSelector } from "../ThemeSelector";
import { useLauncherTheme } from "../../hooks/useLauncherTheme";

export function SettingsTab() {
  const [config, setConfig] = useState<LauncherConfig | null>(null);
  const [tempConfig, setTempConfig] = useState<LauncherConfig | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<boolean>(false); const [activeTab, setActiveTab] = useState<"general" | "appearance" | "advanced">(
    "general",
  );


  // Create groups array for tabs
  const createGroups = (): GroupTab[] => {
    const groups: GroupTab[] = [
      {
        id: "general",
        name: "General",
        count: undefined, // No count for settings tabs
      },
      {
        id: "appearance",
        name: "Background",
        count: undefined,
      },
      {
        id: "advanced",
        name: "Advanced",
        count: undefined,
      },
    ];
    return groups;
  };

  const groups = createGroups();
  const [customColor, setCustomColor] = useState("#4f8eff");
  const contentRef = useRef<HTMLDivElement>(null);
  const tabRef = useRef<HTMLDivElement>(null);
  const autoSaveTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const [isHooksExpanded, setIsHooksExpanded] = useState<boolean>(false);
  const [isPreLaunchEditEnabled, setIsPreLaunchEditEnabled] = useState<boolean>(false);
  const [isWrapperEditEnabled, setIsWrapperEditEnabled] = useState<boolean>(false);
  const [isPostExitEditEnabled, setIsPostExitEditEnabled] = useState<boolean>(false);
  const isResettingRef = useRef<boolean>(false);
  const {
    accentColor,
    setCustomAccentColor,
    customColorHistory,
    isBackgroundAnimationEnabled,
    staticBackground,
    toggleStaticBackground,
    toggleBackgroundAnimation,
  } = useThemeStore();
  const { currentEffect, setCurrentEffect } = useBackgroundEffectStore();
  const { qualityLevel, setQualityLevel } = useQualitySettingsStore();
  const { borderRadius, setBorderRadius } = useThemeStore();

  const { confirm, confirmDialog } = useConfirmDialog();
  const { showModal, hideModal } = useGlobalModal();
  const { isThemeActive } = useLauncherTheme();

  const EXPERIMENTAL_FEATURE_FLAG_NAME = "show_experimental_mode";
  const experimentalFlags = useFlags([EXPERIMENTAL_FEATURE_FLAG_NAME]);
  const canShowExperimental =
    experimentalFlags[EXPERIMENTAL_FEATURE_FLAG_NAME]?.enabled === true ||
    !!tempConfig?.is_experimental ||
    !!config?.is_experimental;

  const backgroundOptions = [
    {
      id: BACKGROUND_EFFECTS.MATRIX_RAIN,
      name: "Matrix Rain",
      icon: "solar:code-bold",
    },
    {
      id: BACKGROUND_EFFECTS.ENCHANTMENT_PARTICLES,
      name: "Enchantment Table",
      icon: "solar:magic-stick-bold",
    },
    {
      id: BACKGROUND_EFFECTS.NEBULA_WAVES,
      name: "Nebula Waves",
      icon: "solar:soundwave-bold",
    },
    {
      id: BACKGROUND_EFFECTS.NEBULA_PARTICLES,
      name: "Nebula Particles",
      icon: "solar:star-bold",
    },
    {
      id: BACKGROUND_EFFECTS.NEBULA_GRID,
      name: "Nebula Grid",
      icon: "solar:widget-bold",
    },
    {
      id: BACKGROUND_EFFECTS.NEBULA_VOXELS,
      name: "Nebula Voxels",
      icon: "solar:asteroid-bold",
    },
    {
      id: BACKGROUND_EFFECTS.NEBULA_LIGHTNING,
      name: "Nebula Lightning",
      icon: "solar:bolt-bold",
    },
    {
      id: BACKGROUND_EFFECTS.NEBULA_LIQUID_CHROME,
      name: "Liquid Chrome",
      icon: "solar:cloud-waterdrops-bold",
    },
    {
      id: BACKGROUND_EFFECTS.RETRO_GRID,
      name: "Retro Grid",
      icon: "solar:widget-5-bold",
    },
    {
      id: BACKGROUND_EFFECTS.PLAIN_BACKGROUND,
      name: "Plain Color",
      icon: "solar:palette-bold",
    },
  ];

  const qualityOptions: { value: QualityLevel; label: string; icon: string }[] =
    [
      {
        value: "low",
        label: "Low",
        icon: "solar:battery-half-bold",
      },
      {
        value: "medium",
        label: "Medium",
        icon: "solar:battery-full-bold",
      },
      { value: "high", label: "High", icon: "solar:battery-charge-bold" },
    ];

  const loadConfig = useCallback(async () => {
    setLoading(true);
    setError(null); try {
      const loadedConfig = await ConfigService.getLauncherConfig();
      const configWithHooks = {
        ...loadedConfig,
        hooks: loadedConfig.hooks || {
          pre_launch: null,
          wrapper: null,
          post_exit: null,
        },
      };
      setConfig(configWithHooks);
      setTempConfig({ ...configWithHooks });
    } catch (err) {
      console.error("Failed to load launcher config:", err);
      setError(err instanceof Error ? err.message : String(err));
      setConfig(null);
      setTempConfig(null);
    } finally {
      setLoading(false);
    }
  }, []);

  const autoSaveConfig = useCallback(async (configToSave: LauncherConfig) => {
    if (isResettingRef.current) {
      return;
    }

    if (autoSaveTimeoutRef.current) {
      clearTimeout(autoSaveTimeoutRef.current);
    }

    autoSaveTimeoutRef.current = setTimeout(async () => {
      setSaving(true);
      try {
        const updatedConfig =
          await ConfigService.setLauncherConfig(configToSave);
        setConfig(updatedConfig);
        toast.success("Settings auto-saved!", {
          duration: 2000,
          position: "bottom-right",
        });
      } catch (err) {
        console.error("Failed to auto-save configuration:", err);
        const errorMessage = err instanceof Error ? err.message : String(err);
        toast.error(`Auto-save failed: ${errorMessage}`);
      } finally {
        setSaving(false);
      }
    }, 500);
  }, []);

  useEffect(() => {
    loadConfig();
  }, [loadConfig]);

  useEffect(() => {
    if (
      tempConfig &&
      config &&
      JSON.stringify(config) !== JSON.stringify(tempConfig)
    ) {
      autoSaveConfig(tempConfig);
    }
  }, [tempConfig, config, autoSaveConfig]);

  const handleConcurrentDownloadsChange = (value: number) => {
    if (tempConfig) {
      setTempConfig({ ...tempConfig, concurrent_downloads: value });
    }
  };
  const handleConcurrentIoLimitChange = (value: number) => {
    if (tempConfig) {
      setTempConfig({ ...tempConfig, concurrent_io_limit: value });
    }
  };
  const handleCustomColorSubmit = () => {
    const isValidHex = /^#[0-9A-F]{6}$/i.test(customColor);
    if (isValidHex) {
      setCustomAccentColor(customColor);
      toast.success("Custom color applied!");
    } else {
      toast.error("Please enter a valid 6-digit hex color (e.g., #FF5733)");
    }
  };

  const resetChanges = () => {
    if (config) {
      isResettingRef.current = true;
      setTempConfig({ ...config });
      setError(null);
      toast.success("Settings reset to saved values");

      setTimeout(() => {
        isResettingRef.current = false;
      }, 100);
    }
  };

  const hasChanges =
    config &&
    tempConfig &&
    JSON.stringify(config) !== JSON.stringify(tempConfig);

  const isAccentColorDisabled = isThemeActive;

  const renderGeneralTab = () => (
    <div className="space-y-6">
      <div>
      {/* Accent Color Section */}
        <div className="flex items-center gap-2 mb-2">
          <Icon icon="solar:palette-bold" className="w-6 h-6 text-white" />
          <h3 className="text-3xl font-minecraft text-white">
            Accent Color
          </h3>
        </div>
        <p className="text-base text-white/70 font-minecraft-ten mt-2">
          Choose your preferred accent color for the launcher
          {isThemeActive && (
            <span className="text-white/50 ml-2">(Disabled while a theme is active)</span>
          )}
        </p>
      </div>

      <div className="mt-6 flex items-center gap-6">
        <div className="flex-1">
          <ColorPicker shape="square" size="md" showCustomOption={false} disabled={isAccentColorDisabled} />
        </div>

        <button
          onClick={() => {
            if (!isAccentColorDisabled) {
              showModal('color-picker-modal',
                <ColorPickerModal
                  onClose={() => hideModal('color-picker-modal')}
                />
              );
            }
          }}
          className={cn(
            "group flex items-center gap-3 px-4 py-3 rounded-lg border-2 border-dashed border-[#ffffff30] transition-all duration-200",
            isAccentColorDisabled
              ? "opacity-40 cursor-not-allowed"
              : "hover:border-[#ffffff50] cursor-pointer"
          )}
          title={isAccentColorDisabled ? "Disabled while a theme is active" : "Click to open advanced color picker"}
          disabled={isAccentColorDisabled}
        >
          <div
            className="w-8 h-8 rounded-md border-2 border-white/20 shadow-lg group-hover:scale-105 transition-transform"
            style={{ backgroundColor: accentColor.value }}
          />
          <div className="flex flex-col items-start">
            <span className="font-minecraft-ten text-base text-white/80 group-hover:text-white transition-colors">
              Custom
            </span>
            <span className="text-xs text-white/60 font-minecraft-ten">
              {accentColor.value}
            </span>
          </div>
          <Icon
            icon="solar:palette-bold"
            className="w-5 h-5 text-white/60 group-hover:text-white transition-colors"
          />
        </button>
      </div>


      {/* Settings Grid */}
      <CompactSettingsGrid
        settings={[
          {
            id: "auto-updates",
            label: "Auto Updates",
            tooltip: "Automatically check for and download launcher updates when available.",
            type: "toggle",
            value: tempConfig?.auto_check_updates || false,
            onChange: (checked) =>
              tempConfig &&
              setTempConfig({ ...tempConfig, auto_check_updates: checked }),
          },
          {
            id: "discord-presence",
            label: "Discord Presence",
            tooltip: "Show your current game and launcher status in Discord. Displays what you're playing to friends.",
            type: "toggle",
            value: tempConfig?.enable_discord_presence || false,
            onChange: (checked) =>
              tempConfig &&
              setTempConfig({
                ...tempConfig,
                enable_discord_presence: checked,
              }),
          },
          {
            id: "beta-updates",
            label: "Beta Updates",
            tooltip: "Receive beta versions and pre-release updates. These may be unstable and contain bugs.",
            type: "toggle",
            value: tempConfig?.check_beta_channel || false,
            onChange: (checked) =>
              tempConfig &&
              setTempConfig({ ...tempConfig, check_beta_channel: checked }),
          },
          ...(canShowExperimental ? [{
            id: "experimental-mode",
            label: "Experimental Mode",
            tooltip: "Enable experimental features and unstable functionality. May cause crashes or unexpected behavior.",
            type: "toggle" as const,
            value: tempConfig?.is_experimental || false,
            onChange: (checked: boolean) => {
              if (tempConfig) {
                setTempConfig({
                  ...tempConfig,
                  is_experimental: checked,
                });
              }
            },
          }] : []),
          {
            id: "open-logs",
            label: "Open Logs After Starting",
            tooltip: "Automatically open the game logs window when launching Minecraft. Useful for debugging issues.",
            type: "toggle",
            value: tempConfig?.open_logs_after_starting || false,
            onChange: (checked) =>
              tempConfig &&
              setTempConfig({
                ...tempConfig,
                open_logs_after_starting: checked,
              }),
          },
          {
            id: "hide-window",
            label: "Hide Window on Launch",
            tooltip: "Automatically hide the launcher window when Minecraft starts. Reduces desktop clutter during gameplay.",
            type: "toggle",
            value: tempConfig?.hide_on_process_start || false,
            onChange: (checked) =>
              tempConfig &&
              setTempConfig({
                ...tempConfig,
                hide_on_process_start: checked,
              }),
          },
        ]}
        disabled={saving}
      />

      <CompactSettingsGrid
        settings={[
          {
            id: "concurrent-downloads",
            label: "Concurrent Downloads",
            tooltip: "Maximum number of files downloaded simultaneously. Lower values reduce bandwidth usage but slow downloads.",
            type: "range",
            value: tempConfig?.concurrent_downloads || 3,
            onChange: handleConcurrentDownloadsChange,
            min: 1,
            max: 10,
            step: 1,
            icon: "solar:multiple-forward-right-bold",
            minLabel: "1",
            maxLabel: "10",
          },
          {
            id: "concurrent-io",
            label: "Concurrent I/O Operations",
            tooltip: "Maximum number of files written to disk simultaneously. Lower values reduce disk stress and I/O errors.",
            type: "range",
            value: tempConfig?.concurrent_io_limit || 10,
            onChange: handleConcurrentIoLimitChange,
            min: 1,
            max: 20,
            step: 1,
            icon: "solar:server-bold",
            minLabel: "1",
            maxLabel: "20",
          },
          {
            id: "border-radius",
            label: "Border Radius",
            tooltip: "Adjust the corner roundness of all UI elements. 0px is square (Minecraft-style), higher values make corners more rounded.",
            type: "range",
            value: borderRadius,
            onChange: setBorderRadius,
            min: 0,
            max: 20,
            step: 1,
            icon: "solar:widget-bold",
            minLabel: "0px",
            maxLabel: "20px",
          },
        ]}
        disabled={saving}
      />
    </div>
  );

  const renderAppearanceTab = () => (
    <div className="space-y-6">
      {/* Theme Section */}
      <div>
        <div className="flex items-center gap-2 mb-2">
          <Icon icon="solar:star-bold" className="w-6 h-6 text-white" />
          <h3 className="text-3xl font-minecraft text-white">
            Theme
          </h3>
        </div>
        <p className="text-base text-white/70 font-minecraft-ten mt-2">
          Select a theme to customize your launcher's appearance
        </p>
      </div>
      <div className="mt-4">
        <ThemeSelector />
      </div>

      {/* Background Effect Section */}
      <div className="mt-8">
        <div className="mb-4">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <Icon icon="solar:stars-bold" className="w-6 h-6 text-white" />
              <h3 className="text-3xl font-minecraft text-white">
                Background Effect
              </h3>
            </div>
            <div className="flex flex-col items-end gap-2" style={{ transform: 'translateY(16px)' }}>
              <div className="flex items-center gap-2">
                <span className="text-sm text-white/70 font-minecraft-ten">Animations</span>
                <ToggleSwitch
                  checked={!staticBackground}
                  onChange={() => {
                    toggleStaticBackground();
                    toggleBackgroundAnimation();
                  }}
                  disabled={saving}
                  size="sm"
                />
              </div>
              <SnowEffectToggle
                showLabel={true}
                size="sm"
                disabled={saving}
              />
              <div className="flex items-center gap-3">
                <span className="text-xs text-white/60 font-minecraft-ten">Quality: Low</span>
                <input
                  type="range"
                  min="0"
                  max="2"
                  step="1"
                  value={qualityLevel === "low" ? 0 : qualityLevel === "medium" ? 1 : 2}
                  onChange={(e) => {
                    const value = parseInt(e.target.value);
                    const levels = ["low", "medium", "high"] as const;
                    setQualityLevel(levels[value] || "medium");
                  }}
                  className="w-16 h-2 bg-white/20 rounded-lg appearance-none cursor-pointer slider accent-white hover:accent-white/80 transition-colors"
                  disabled={saving}
                />
                <span className="text-xs text-white/60 font-minecraft-ten">High</span>
              </div>
            </div>
          </div>
          <p className="text-base text-white/70 font-minecraft-ten mt-2">
            Choose a background effect for the launcher
          </p>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-6">
          {backgroundOptions.map((option) => (
            <EffectPreviewCard
              key={option.id}
              effectId={option.id}
              name={option.name}
              icon={option.icon}
              isActive={currentEffect === option.id}
              onClick={() => setCurrentEffect(option.id)}
            />
          ))}
        </div>
      </div>

    </div>
  );

  const renderAdvancedTab = () => (
    <div className="space-y-6">
      <div>
        <div className="mb-4">
          <div className="flex items-center gap-2 mb-2">
            <Icon icon="solar:folder-bold" className="w-6 h-6 text-white" />
            <SimpleTooltip content="This setting allows you to store game data on a different drive or location. Useful if your main drive is running out of space. The launcher will automatically handle the location change for new downloads and installations.">
              <h3 className="text-3xl font-minecraft text-white lowercase cursor-help">
                Game Data Directory
              </h3>
            </SimpleTooltip>
          </div>
          <p className="text-base text-white/70 font-minecraft-ten mt-2">
            Choose a custom location to store game data (worlds, mods, libraries, etc.)
          </p>

          <div className="flex gap-3 mt-4">
            <input
              type="text"
              value={tempConfig?.custom_game_directory || ""}
              placeholder="Default location will be used"
              className="flex-1 p-3 rounded-md bg-black/40 border border-[#ffffff20] text-white placeholder-white/40 font-minecraft-ten focus:outline-none focus:ring-2 focus:ring-white/30"
              disabled={saving}
              readOnly
            />
            {tempConfig?.custom_game_directory && (
              <Button
                variant="ghost"
                className="px-4 py-3 border border-[#ffffff20] hover:bg-red-500/20 hover:border-red-500/30 transition-colors"
                disabled={saving}
                onClick={() => {
                  if (tempConfig) {
                    setTempConfig({
                      ...tempConfig,
                      custom_game_directory: null,
                    });
                  }
                }}
                title="Reset to default location"
              >
                <Icon icon="solar:close-circle-bold" className="w-5 h-5 text-red-400" />
              </Button>
            )}
            <Button
              variant="ghost"
              className="px-4 py-3 border border-[#ffffff20] hover:bg-white/5 transition-colors"
              disabled={saving}
              onClick={async () => {
                try {
                  const { open } = await import('@tauri-apps/plugin-dialog');
                  const directory = await open({
                    multiple: false,
                    directory: true,
                  });

                  if (directory && tempConfig) {
                    setTempConfig({
                      ...tempConfig,
                      custom_game_directory: directory,
                    });
                  }
                } catch (error) {
                  console.error('Fehler beim Ordner-Dialog:', error);
                }
              }}
              title="Select custom directory"
            >
              <Icon icon="solar:folder-open-bold" className="w-5 h-5" />
            </Button>
          </div>
        </div>
      </div>

      <div>
        <div className="mb-4">
          <div className="flex items-center justify-between gap-2 mb-2">
            <div className="flex items-center gap-2">
              <Icon icon="solar:code-bold" className="w-6 h-6 text-white" />
              <h3 className="text-3xl font-minecraft text-white lowercase">
                Game Hooks
              </h3>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setIsHooksExpanded((v) => !v)}
              icon={
                <Icon
                  icon={isHooksExpanded ? "solar:alt-arrow-up-bold" : "solar:alt-arrow-down-bold"}
                  className="w-5 h-5"
                />
              }
            >
              {isHooksExpanded ? "Hide configuration" : "Show configuration"}
            </Button>
          </div>
          <p className="text-base text-white/70 font-minecraft-ten mt-2">
            Configure custom commands to run before, during, and after game launch
          </p>
        </div>

        {isHooksExpanded && (
          <div className="space-y-6 mt-6">
            <div className="p-4 rounded-lg border border-[#ffffff20] hover:bg-black/30 transition-colors">
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Icon icon="solar:play-circle-bold" className="w-5 h-5 text-white" />
                  <h5 className="font-minecraft text-2xl lowercase text-white">Pre-Launch Hook</h5>
                </div>
                <Button
                  variant={isPreLaunchEditEnabled ? "secondary" : "ghost"}
                  size="sm"
                  onClick={async () => {
                    if (isPreLaunchEditEnabled) {
                      setIsPreLaunchEditEnabled(false);
                      return;
                    }
                    const confirmed = await confirm({
                      title: "enable pre-launch editing",
                      message:
                        "Editing the Pre-Launch hook can prevent the game from starting if misconfigured. Proceed only if you know what you're doing.",
                      confirmText: "ENABLE",
                      cancelText: "CANCEL",
                      type: "warning",
                      fullscreen: true,
                    });
                    if (confirmed) {
                      setIsPreLaunchEditEnabled(true);
                      toast.success("Pre-Launch editing enabled");
                    }
                  }}
                  icon={
                    <Icon
                      icon={isPreLaunchEditEnabled ? "solar:lock-unlocked-bold" : "solar:lock-keyhole-bold"}
                      className="w-4 h-4"
                    />
                  }
                >
                  {isPreLaunchEditEnabled ? "Disable editing" : "Enable editing"}
                </Button>
              </div>
              <p className="text-sm text-white/60 font-minecraft-ten mb-4">
                Command to run before Minecraft starts. If this command fails, the launch will be aborted.
              </p>
              <input
                type="text"
                value={tempConfig?.hooks?.pre_launch || ""}
                onChange={(e) => {
                  if (tempConfig) {
                    setTempConfig({
                      ...tempConfig,
                      hooks: {
                        ...tempConfig.hooks,
                        pre_launch: e.target.value || null,
                      },
                    });
                  }
                }}
                placeholder='Example: echo "Starting Minecraft..."'
                className="w-full p-3 rounded-md bg-black/40 border border-[#ffffff20] text-white placeholder-white/40 font-minecraft-ten focus:outline-none focus:ring-2 focus:ring-white/30"
                disabled={saving || !isPreLaunchEditEnabled}
                title={!isPreLaunchEditEnabled ? "Enable editing to modify this field" : undefined}
              />
            </div>

            <div className="p-4 rounded-lg border border-[#ffffff20] hover:bg-black/30 transition-colors">
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Icon icon="solar:shield-bold" className="w-5 h-5 text-white" />
                  <h5 className="font-minecraft text-2xl lowercase text-white">Wrapper Hook</h5>
                </div>
                <Button
                  variant={isWrapperEditEnabled ? "secondary" : "ghost"}
                  size="sm"
                  onClick={async () => {
                    if (isWrapperEditEnabled) {
                      setIsWrapperEditEnabled(false);
                      return;
                    }
                    const confirmed = await confirm({
                      title: "enable wrapper editing",
                      message:
                        "Changing the Wrapper hook affects how Java is executed. Misconfiguration may prevent launching.",
                      confirmText: "ENABLE",
                      cancelText: "CANCEL",
                      type: "warning",
                      fullscreen: true,
                    });
                    if (confirmed) {
                      setIsWrapperEditEnabled(true);
                      toast.success("Wrapper editing enabled");
                    }
                  }}
                  icon={
                    <Icon
                      icon={isWrapperEditEnabled ? "solar:lock-unlocked-bold" : "solar:lock-keyhole-bold"}
                      className="w-4 h-4"
                    />
                  }
                >
                  {isWrapperEditEnabled ? "Disable editing" : "Enable editing"}
                </Button>
              </div>
              <p className="text-sm text-white/60 font-minecraft-ten mb-4">
                Wrapper command to run Java through (e.g., sandboxing tools). The Java path will be passed as an argument.
              </p>
              <input
                type="text"
                value={tempConfig?.hooks?.wrapper || ""}
                onChange={(e) => {
                  if (tempConfig) {
                    setTempConfig({
                      ...tempConfig,
                      hooks: {
                        ...tempConfig.hooks,
                        wrapper: e.target.value || null,
                      },
                    });
                  }
                }}
                placeholder="Example: firejail or gamemoderun"
                className="w-full p-3 rounded-md bg-black/40 border border-[#ffffff20] text-white placeholder-white/40 font-minecraft-ten focus:outline-none focus:ring-2 focus:ring-white/30"
                disabled={saving || !isWrapperEditEnabled}
                title={!isWrapperEditEnabled ? "Enable editing to modify this field" : undefined}
              />
            </div>

            <div className="p-4 rounded-lg border border-[#ffffff20] hover:bg-black/30 transition-colors">
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Icon icon="solar:stop-circle-bold" className="w-5 h-5 text-white" />
                  <h5 className="font-minecraft text-2xl lowercase text-white">Post-Exit Hook</h5>
                </div>
                <Button
                  variant={isPostExitEditEnabled ? "secondary" : "ghost"}
                  size="sm"
                  onClick={async () => {
                    if (isPostExitEditEnabled) {
                      setIsPostExitEditEnabled(false);
                      return;
                    }
                    const confirmed = await confirm({
                      title: "enable post-exit editing",
                      message:
                        "Post-Exit hook runs system commands after the game closes. Proceed only if you trust the command.",
                      confirmText: "ENABLE",
                      cancelText: "CANCEL",
                      type: "warning",
                      fullscreen: true,
                    });
                    if (confirmed) {
                      setIsPostExitEditEnabled(true);
                      toast.success("Post-Exit editing enabled");
                    }
                  }}
                  icon={
                    <Icon
                      icon={isPostExitEditEnabled ? "solar:lock-unlocked-bold" : "solar:lock-keyhole-bold"}
                      className="w-4 h-4"
                    />
                  }
                >
                  {isPostExitEditEnabled ? "Disable editing" : "Enable editing"}
                </Button>
              </div>
              <p className="text-sm text-white/60 font-minecraft-ten mb-4">
                Command to run after Minecraft exits successfully. Runs in the background without blocking.
              </p>
              <input
                type="text"
                value={tempConfig?.hooks?.post_exit || ""}
                onChange={(e) => {
                  if (tempConfig) {
                    setTempConfig({
                      ...tempConfig,
                      hooks: {
                        ...tempConfig.hooks,
                        post_exit: e.target.value || null,
                      },
                    });
                  }
                }}
                placeholder='Example: echo "Minecraft closed"'
                className="w-full p-3 rounded-md bg-black/40 border border-[#ffffff20] text-white placeholder-white/40 font-minecraft-ten focus:outline-none focus:ring-2 focus:ring-white/30"
                disabled={saving || !isPostExitEditEnabled}
                title={!isPostExitEditEnabled ? "Enable editing to modify this field" : undefined}
              />
            </div>

            <div className="mt-6 p-4 rounded-lg border border-orange-500/30 bg-orange-900/20">
              <div className="flex items-start gap-3">
                <Icon icon="solar:danger-triangle-bold" className="w-6 h-6 text-orange-400 flex-shrink-0 mt-1" />
                <div>
                  <h4 className="text-xl font-minecraft text-orange-300 mb-2 lowercase">
                    Warning
                  </h4>
                  <p className="text-sm text-orange-200/80 font-minecraft-ten">
                    These hooks execute system commands with full permissions. Only use commands you trust and understand.
                    Invalid commands may prevent Minecraft from launching or cause security issues.
                  </p>
                </div>
              </div>
            </div>

            <div className="mt-6 p-4 rounded-lg border border-[#ffffff20] bg-black/10">
              <div className="flex items-start gap-3">
                <Icon icon="solar:info-circle-bold" className="w-6 h-6 text-blue-400 flex-shrink-0 mt-1" />
                <div>
                  <h4 className="text-xl font-minecraft text-blue-300 mb-2 lowercase">
                    Examples
                  </h4>
                  <div className="space-y-2 text-sm text-blue-200/80 font-minecraft-ten">
                    <p><strong>Pre-Launch:</strong> <code>echo "Starting game..."</code></p>
                    <p><strong>Wrapper:</strong> <code>firejail</code> or <code>gamemoderun</code></p>
                    <p><strong>Post-Exit:</strong> <code>notify-send "Game finished"</code></p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      <div>
        <div className="mb-4">
          <div className="flex items-center justify-between gap-2 mb-2">
            <div className="flex items-center gap-2">
              <Icon icon="solar:document-text-bold" className="w-6 h-6 text-white" />
              <h3 className="text-3xl font-minecraft text-white lowercase">
                Third-party Licenses
              </h3>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                openExternalUrl("https://blog.norisk.gg/open-source-licenses/")
              }}
              icon={<Icon icon="solar:external-link-bold" className="w-5 h-5" />}
            >
              View Licenses
            </Button>
          </div>
          <p className="text-base text-white/70 font-minecraft-ten mt-2">
            View licenses for code and components from third parties
          </p>
        </div>
      </div>

    </div>
  );

  const renderTabContent = () => {
    if (loading) {
      return (
        <div className="flex items-center justify-center h-64">
          <div className="text-center">
            <Icon
              icon="solar:refresh-bold"
              className="w-10 h-10 text-white/70 animate-spin mx-auto mb-4"
            />
            <p className="text-2xl text-white/70 font-minecraft">
              Loading Settings...
            </p>
          </div>
        </div>
      );
    }

    if (error) {
      return (
        <div className="bg-red-900/30 border-2 border-red-700/50 rounded-lg p-6 my-4">
          <div className="flex items-start gap-3">
            <Icon
              icon="solar:danger-triangle-bold"
              className="w-8 h-8 text-red-400 flex-shrink-0 mt-1"
            />
            <div>
              <h3 className="text-2xl text-red-300 font-minecraft mb-2">
                Error Loading Settings
              </h3>
              <p className="text-xl text-red-200/80 font-minecraft mb-4">
                {error}
              </p>
              <Button
                onClick={loadConfig}
                variant="secondary"
                size="sm"
                icon={<Icon icon="solar:refresh-bold" className="w-5 h-5" />}
              >
                Try Again
              </Button>
            </div>
          </div>
        </div>
      );
    }

    if (!config || !tempConfig) {
      return (
        <div className="text-center p-8">
          <p className="text-2xl text-white/70 font-minecraft">
            Could not load configuration.
          </p>
        </div>
      );
    }

    switch (activeTab) {
      case "general":
        return renderGeneralTab();
      case "appearance":
        return renderAppearanceTab();
      case "advanced":
        return renderAdvancedTab();
      default:
        return null;
    }
  };


  return (
    <div className="h-full flex flex-col overflow-hidden p-4 relative">
      {/* Header with Group Tabs and Actions */}
      <div className="flex items-center justify-between mb-4 pb-2 border-b border-white/10">
        {/* Group Tabs */}
        <GroupTabs
          groups={groups}
          activeGroup={activeTab}
          onGroupChange={(groupId) => setActiveTab(groupId as "general" | "appearance" | "advanced")}
          showAddButton={false}
        />

        {/* Header Actions */}
        <div style={{ transform: 'translateY(-3px)' }}>
          <ActionButton
            id="open-directory"
            label="OPEN DIRECTORY"
            icon="solar:folder-bold"
            variant="highlight"
            tooltip="Open Launcher Directory"
            size="sm"
            onClick={async () => {
              try {
                await openLauncherDirectory();
              } catch (err) {
                console.error("Failed to open launcher directory:", err);
                toast.error("Failed to open launcher directory: " + err);
              }
            }}
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto no-scrollbar">
        {/* Content */}
        <div ref={contentRef}>
          {renderTabContent()}
        </div>
      </div>

      {confirmDialog}
    </div>
  );
}