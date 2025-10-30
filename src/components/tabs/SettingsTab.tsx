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

export function SettingsTab() {
  const [config, setConfig] = useState<LauncherConfig | null>(null);
  const [tempConfig, setTempConfig] = useState<LauncherConfig | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<boolean>(false);
  const [activeTab, setActiveTab] = useState<"general" | "appearance" | "advanced" | "customize" | "themes">(
    "general",
  );


  // Whether to show the Customize tab (persisted)
  const [showCustomizeTab, setShowCustomizeTab] = useState<boolean>(() => {
    try {
      const val = localStorage.getItem('nr_show_customize_tab');
      return val === null ? true : val === 'true';
    } catch (err) {
      return true;
    }
  });

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

    if (showCustomizeTab) {
      groups.push({ id: "customize", name: "Customize", count: undefined });
    }

    groups.push({ id: "themes", name: "Themes", count: undefined });
    return groups;
  };

  const groups = createGroups();
  const [customColor, setCustomColor] = useState("#4f8eff");
  const contentRef = useRef<HTMLDivElement>(null);
  const tabRef = useRef<HTMLDivElement>(null);
  const autoSaveTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Custom CSS editor state
  const [customCss, setCustomCss] = useState<string>("");
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [externalCssPath, setExternalCssPath] = useState<string | null>(null);
  const externalCssPollRef = useRef<number | null>(null);
  const externalCssLastRef = useRef<string | null>(null);

  // Themes management (stored in localStorage)
  type ThemeEntry = {
    id: string;
    name: string; // display name
    filename?: string;
    content: string;
    enabled: boolean;
    source?: "imported" | "external" | "builtin";
  };

  const [themes, setThemes] = useState<ThemeEntry[]>([]);
  const themesFileInputRef = useRef<HTMLInputElement | null>(null);

  const loadThemes = () => {
    try {
      const raw = localStorage.getItem("nr_themes") || "[]";
      const parsed: ThemeEntry[] = JSON.parse(raw || "[]");
      setThemes(parsed || []);
    } catch (err) {
      console.error("Failed to load themes from localStorage", err);
      setThemes([]);
    }
  };

  const saveThemes = (next: ThemeEntry[]) => {
    try {
      localStorage.setItem("nr_themes", JSON.stringify(next));
    } catch (err) {
      console.error("Failed to save themes to localStorage", err);
    }
  };

  const displayNameFromFilename = (filename: string) => {
    const base = filename.replace(/\.[^/.]+$/, "");
    if (!base) return filename;
    return base.charAt(0).toUpperCase() + base.slice(1);
  };

  const applyEnabledThemes = (list: ThemeEntry[]) => {
    const enabledCss = list.filter((t) => t.enabled).map((t) => t.content).join("\n\n");
    applyCustomCss(enabledCss);
    try {
      localStorage.setItem('nr_custom_css', enabledCss);
    } catch (err) {
      // ignore
    }
  };

  const toggleTheme = (id: string) => {
    const next = themes.map((t) => (t.id === id ? { ...t, enabled: !t.enabled } : t));
    setThemes(next);
    saveThemes(next);
    applyEnabledThemes(next);
    toast.success('Theme toggled');
  };

  const deleteTheme = (id: string) => {
    const next = themes.filter((t) => t.id !== id);
    setThemes(next);
    saveThemes(next);
    applyEnabledThemes(next);
    toast.success('Theme removed');
  };

  const importThemeFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result || "");
      const id = String(Date.now()) + Math.random().toString(36).slice(2, 8);
      const name = displayNameFromFilename(file.name || `theme-${id}`);
      const entry: ThemeEntry = {
        id,
        name,
        filename: file.name,
        content: text,
        enabled: false,
        source: 'imported',
      };
      const next = [...themes, entry];
      setThemes(next);
      saveThemes(next);
      toast.success('Theme imported');
    };
    reader.onerror = (e) => {
      console.error('Failed to read theme file', e);
      toast.error('Failed to import theme');
    };
    reader.readAsText(file);
  };

  const [isHooksExpanded, setIsHooksExpanded] = useState<boolean>(false);
  const [exportLocation, setExportLocation] = useState<string | null>(null);
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

  // Detect whether we run inside Tauri (desktop) or plain browser dev
  const isTauri = typeof window !== 'undefined' && ((window as any).__TAURI__ !== undefined || Boolean((import.meta as any).env?.TAURI));

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

  const renderGeneralTab = () => (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-2 mb-2">
          <Icon icon="solar:palette-bold" className="w-6 h-6 text-white" />
          <h3 className="text-3xl font-minecraft text-white">
            Accent Color
          </h3>
        </div>
        <p className="text-base text-white/70 font-minecraft-ten mt-2">
          Choose your preferred accent color for the launcher
        </p>
      </div>

        <div className="mt-6 flex items-center gap-6">
        <div className="flex-1">
          <ColorPicker shape="square" size="md" showCustomOption={false} />
        </div>

        <button
          onClick={() => {
            showModal('color-picker-modal',
              <ColorPickerModal
                onClose={() => hideModal('color-picker-modal')}
              />
            );
          }}
          className="group flex items-center gap-3 px-4 py-3 rounded-lg border-2 border-dashed border-[#ffffff30] hover:border-[#ffffff50] transition-all duration-200 cursor-pointer"
          title="Click to open advanced color picker"
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
            id: "show-customize-tab",
            label: "Show Customize Tab",
            tooltip: "Show or hide the Customize tab in Settings (your custom CSS editor).",
            type: "toggle",
            value: showCustomizeTab,
            onChange: (checked: boolean) => {
              try {
                localStorage.setItem('nr_show_customize_tab', checked ? 'true' : 'false');
              } catch (err) {
                /* ignore */
              }
              setShowCustomizeTab(checked);
              if (!checked && activeTab === 'customize') setActiveTab('general');
            },
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
      <div>
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
  const renderCustomize = () => (
    <div className="space-y-6">
      <div>
        <div className="mb-4">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <Icon icon="solar:stars-bold" className="w-6 h-6 text-white" />
              <h3 className="text-3xl font-minecraft text-white">
                Customize your Launcher
              </h3>
            </div>
          </div>
        </div>
      </div>

      <div className="p-4 rounded-lg border border-[#ffffff20] bg-black/10">
        <p className="text-sm text-white/70 font-minecraft-ten mb-3">
          Edit custom CSS for the launcher. Changes can be applied live and exported as a .css file.
        </p>

        <div className="flex flex-col md:flex-row gap-4">
          <div className="flex-1">
            <textarea
              value={customCss}
              onChange={(e) => setCustomCss(e.target.value)}
              className="w-full h-64 p-3 rounded-md bg-black/40 border border-[#ffffff20] text-white placeholder-white/40 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-white/30 resize-none"
              placeholder="/* Enter CSS here, for example: \nbody { background: linear-gradient(#111, #222); } */"
            />

            <div className="mt-3 flex flex-wrap gap-2">
              <button
                onClick={() => {
                  setCustomCss((c) => c);
                  applyCustomCss(customCss);
                  try {
                    localStorage.setItem('nr_custom_css', customCss || '');
                    toast.success('Custom CSS applied and saved locally');
                  } catch (err) {
                    console.error('Failed to save custom css to localStorage', err);
                    toast.error('Failed to save custom CSS');
                  }
                }}
                className="px-3 py-2 rounded bg-white/10 hover:bg-white/20 text-white"
              >
                Apply
              </button>

              <button
                onClick={() => exportCustomCss(customCss)}
                className="px-3 py-2 rounded bg-transparent border border-white/10 hover:bg-white/5 text-white"
                title="Export CSS as .css file"
              >
                Export
              </button>

              <button
                onClick={() => fileInputRef.current?.click()}
                className="px-3 py-2 rounded bg-transparent border border-white/10 hover:bg-white/5 text-white"
              >
                Import
              </button>

              <button
                onClick={() => {
                  const saved = localStorage.getItem('nr_custom_css') || '';
                  setCustomCss(saved);
                  applyCustomCss(saved);
                  toast.success('Loaded saved CSS');
                }}
                className="px-3 py-2 rounded bg-transparent border border-white/10 hover:bg-white/5 text-white"
              >
                Load saved
              </button>

              <button
                onClick={() => {
                  setCustomCss('');
                  removeCustomCss();
                  try {
                    localStorage.removeItem('nr_custom_css');
                  } catch (err) {
                    /* ignore */
                  }
                  toast('Custom CSS reset');
                }}
                className="px-3 py-2 rounded bg-red-600/70 hover:bg-red-600 text-white ml-auto"
              >
                Reset
              </button>
            </div>

            {exportLocation && (
              <div className="mt-2 text-sm text-white/70 font-minecraft-ten">
                Exported to: <span className="font-mono text-xs">{exportLocation}</span>
              </div>
            )}

            <input
              ref={fileInputRef}
              type="file"
              accept=".css,text/css"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files && e.target.files[0];
                if (!f) return;
                const reader = new FileReader();
                reader.onload = () => {
                  const text = String(reader.result || '');
                  setCustomCss(text);
                  applyCustomCss(text);
                  try {
                    localStorage.setItem('nr_custom_css', text);
                  } catch (err) {
                    /* ignore */
                  }
                  toast.success('Imported CSS file');
                };
                reader.readAsText(f);
                e.currentTarget.value = '';
              }}
            />
          </div>

          <div className="w-full md:w-96 p-3 rounded border border-[#ffffff15] bg-black/20">
            <p className="text-xs text-white/60 mb-2">Live Preview</p>
            <div className="p-3 rounded bg-black/40 text-white text-sm" id="nr-css-preview">
              <p className="font-minecraft-ten">This is a small preview area to show applied CSS.</p>
              <div className="mt-2">
                <button className="px-2 py-1 rounded bg-white/10">Button</button>
              </div>
            </div>
          </div>
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
      case "customize":
        return renderCustomize();
      case "themes":
        return renderThemesTab();
      default:
        return null;
    }
  };

  // --- helper functions for custom CSS ---
  function applyCustomCss(css: string) {
    try {
      const id = 'nr-custom-css';
      let style = document.getElementById(id) as HTMLStyleElement | null;
      if (!style) {
        style = document.createElement('style');
        style.id = id;
        document.head.appendChild(style);
      }
      style.innerHTML = css || '';
    } catch (err) {
      console.error('Failed to apply custom CSS', err);
      toast.error('Failed to apply custom CSS');
    }
  }

  function removeCustomCss() {
    try {
      const id = 'nr-custom-css';
      const style = document.getElementById(id);
      if (style && style.parentNode) style.parentNode.removeChild(style);
    } catch (err) {
      console.error('Failed to remove custom CSS', err);
    }
  }

  function exportCustomCss(css: string) {
    (async () => {
      try {
        // Prefer File System Access API (browser) to let user choose path
        // @ts-ignore
        if (typeof (window as any).showSaveFilePicker === 'function') {
          try {
            // @ts-ignore
            const handle = await (window as any).showSaveFilePicker({
              suggestedName: 'norisk-custom.css',
              types: [
                {
                  description: 'CSS',
                  accept: { 'text/css': ['.css'] },
                },
              ],
            });
            const writable = await handle.createWritable();
            await writable.write(css || '');
            await writable.close();
            setExportLocation(handle.name || 'Saved file');
            toast.success('Exported CSS file');
            return;
          } catch (err) {
            console.error('showSaveFilePicker cancelled or failed', err);
            // fallback to download
          }
        }

        // Fallback: classic anchor download
        const blob = new Blob([css || ''], { type: 'text/css' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'norisk-custom.css';
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
        setExportLocation('Downloads/norisk-custom.css');
        toast.success(`Exported CSS file to:\n${exportLocation}`);
      } catch (err) {
        console.error('Failed to export CSS', err);
        toast.error('Failed to export CSS');
      }
    })();
  }

  // load saved CSS on mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem('nr_custom_css') || '';
      if (saved) {
        setCustomCss(saved);
        applyCustomCss(saved);
      }
    } catch (err) {
      // ignore
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // load saved themes on mount
  useEffect(() => {
    loadThemes();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const renderThemesTab = () => (
    <div className="space-y-6">
      <div>
        <div className="mb-4">
          <div className="flex items-center gap-2 mb-2">
            <Icon icon="solar:palette-bold" className="w-6 h-6 text-white" />
            <h3 className="text-3xl font-minecraft text-white">Themes</h3>
          </div>
          <p className="text-base text-white/70 font-minecraft-ten mt-2">
            Manage theme CSS files. Import .css files and enable or disable them. Enabled themes are applied and combined.
          </p>
        </div>

        <div className="p-4 rounded-lg border border-[#ffffff20] bg-black/10">
          <div className="flex items-center gap-2 mb-4">
            <button
              onClick={() => themesFileInputRef.current?.click()}
              className="px-3 py-2 rounded bg-white/10 hover:bg-white/20 text-white"
            >
              Import Theme
            </button>
            <button
              onClick={() => {
                setThemes([]);
                saveThemes([]);
                applyCustomCss('');
                toast('Cleared themes');
              }}
              className="px-3 py-2 rounded bg-red-600/70 hover:bg-red-600 text-white ml-2"
            >
              Clear All
            </button>
            <input
              ref={themesFileInputRef}
              type="file"
              accept=".css,text/css"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files && e.target.files[0];
                if (!f) return;
                importThemeFile(f);
                e.currentTarget.value = '';
              }}
            />
          </div>

          <div className="space-y-3">
            {themes.length === 0 && (
              <p className="text-sm text-white/60">No themes imported yet. Use "Import Theme" to add a .css file.</p>
            )}

            {themes.map((t) => (
              <div key={t.id} className="flex items-center gap-3 p-2 rounded border border-[#ffffff10]">
                <div className="flex-1">
                  <div className="text-white font-minecraft-ten">{t.name || displayNameFromFilename(t.filename || 'theme')}</div>
                  <div className="text-xs text-white/60">{t.filename || t.id}</div>
                </div>
                <div className="flex items-center gap-2">
                  <ToggleSwitch checked={t.enabled} onChange={() => toggleTheme(t.id)} />
                  <Button
                    variant="ghost"
                    size="sm"
                    style={{ backgroundColor: 'rgba(220,38,38,0.95)', color: '#fff' }}
                    className="px-3 py-1 rounded shadow flex items-center gap-2"
                    onClick={() => {
                      const confirmed = window.confirm('Delete theme "' + (t.name || t.filename || t.id) + '"?');
                      if (confirmed) deleteTheme(t.id);
                    }}
                    title="Delete theme"
                    aria-label={`Delete theme ${t.name || t.filename || t.id}`}
                  >
                    <Icon icon="solar:trash-bold" className="w-4 h-4 text-white" />
                    <span className="text-sm font-minecraft-ten">Delete</span>
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );


  return (
    <div className="h-full flex flex-col overflow-hidden p-4 relative">
      {/* Header with Group Tabs and Actions */}
      <div className="flex items-center justify-between mb-4 pb-2 border-b border-white/10">
        {/* Group Tabs */}
        <GroupTabs
          groups={groups}
          activeGroup={activeTab}
          onGroupChange={(groupId) => setActiveTab(groupId as "general" | "appearance" | "advanced" | "customize" | "themes")}
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
              if (!isTauri) {
                toast('This action is only available in the desktop app');
                return;
              }
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