"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "@iconify/react";
import { Button } from ".././ui/buttons/Button";
import { Card } from ".././ui/Card";
import { ToggleSwitch } from ".././ui/ToggleSwitch";
import { Input } from ".././ui/Input";
import { Select } from ".././ui/Select";
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
import { DebugSection } from "./DebugSection";
import { useTranslation } from "react-i18next";
import { LANGUAGE_OPTIONS } from "../../i18n";
import type { SupportedLanguage } from "../../i18n";

export function SettingsTab() {
  const { t } = useTranslation();
  const { language, setLanguage } = useThemeStore();
  const [config, setConfig] = useState<LauncherConfig | null>(null);
  const [tempConfig, setTempConfig] = useState<LauncherConfig | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<boolean>(false); const [activeTab, setActiveTab] = useState<"general" | "appearance" | "advanced" | "debug">(
    "general",
  );


  // Create groups array for tabs
  const createGroups = (): GroupTab[] => {
    const groups: GroupTab[] = [
      {
        id: "general",
        name: t("settings.tabs.general"),
        count: undefined,
      },
      {
        id: "appearance",
        name: t("settings.tabs.appearance"),
        count: undefined,
      },
      {
        id: "advanced",
        name: t("settings.tabs.advanced"),
        count: undefined,
      },
      {
        id: "debug",
        name: t("settings.tabs.debug"),
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
      name: t("settings.background.matrix_rain"),
      icon: "solar:code-bold",
    },
    {
      id: BACKGROUND_EFFECTS.ENCHANTMENT_PARTICLES,
      name: t("settings.background.enchantment_table"),
      icon: "solar:magic-stick-bold",
    },
    {
      id: BACKGROUND_EFFECTS.NEBULA_WAVES,
      name: t("settings.background.nebula_waves"),
      icon: "solar:soundwave-bold",
    },
    {
      id: BACKGROUND_EFFECTS.NEBULA_PARTICLES,
      name: t("settings.background.nebula_particles"),
      icon: "solar:star-bold",
    },
    {
      id: BACKGROUND_EFFECTS.NEBULA_GRID,
      name: t("settings.background.nebula_grid"),
      icon: "solar:widget-bold",
    },
    {
      id: BACKGROUND_EFFECTS.NEBULA_VOXELS,
      name: t("settings.background.nebula_voxels"),
      icon: "solar:asteroid-bold",
    },
    {
      id: BACKGROUND_EFFECTS.NEBULA_LIGHTNING,
      name: t("settings.background.nebula_lightning"),
      icon: "solar:bolt-bold",
    },
    {
      id: BACKGROUND_EFFECTS.NEBULA_LIQUID_CHROME,
      name: t("settings.background.liquid_chrome"),
      icon: "solar:cloud-waterdrops-bold",
    },
    {
      id: BACKGROUND_EFFECTS.RETRO_GRID,
      name: t("settings.background.retro_grid"),
      icon: "solar:widget-5-bold",
    },
    {
      id: BACKGROUND_EFFECTS.PLAIN_BACKGROUND,
      name: t("settings.background.plain_color"),
      icon: "solar:palette-bold",
    },
  ];

  const qualityOptions: { value: QualityLevel; label: string; icon: string }[] =
    [
      {
        value: "low",
        label: t("settings.quality.low"),
        icon: "solar:battery-half-bold",
      },
      {
        value: "medium",
        label: t("settings.quality.medium"),
        icon: "solar:battery-full-bold",
      },
      { value: "high", label: t("settings.quality.high"), icon: "solar:battery-charge-bold" },
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
        toast.success(t("settings.toast.auto_saved"), {
          duration: 2000,
          position: "bottom-right",
        });
      } catch (err) {
        console.error("Failed to auto-save configuration:", err);
        const errorMessage = err instanceof Error ? err.message : String(err);
        toast.error(t("settings.toast.auto_save_failed", { error: errorMessage }));
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
      toast.success(t("settings.toast.custom_color_applied"));
    } else {
      toast.error(t("settings.toast.invalid_hex"));
    }
  };

  const resetChanges = () => {
    if (config) {
      isResettingRef.current = true;
      setTempConfig({ ...config });
      setError(null);
      toast.success(t("settings.toast.reset"));

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
      {/* Language Section */}
      <div>
        <div className="flex items-center gap-2 mb-2">
          <Icon icon="solar:global-bold" className="w-6 h-6 text-white" />
          <h3 className="text-3xl font-minecraft text-white">
            {t("settings.language")}
          </h3>
        </div>
        <p className="text-base text-white/70 font-minecraft-ten mt-2">
          {t("settings.language.description")}
        </p>
        <div className="mt-4 max-w-xs">
          <Select
            value={language}
            onChange={(value) => setLanguage(value as SupportedLanguage)}
            options={LANGUAGE_OPTIONS.map((opt) => ({
              value: opt.value,
              label: opt.label,
              icon: <Icon icon={opt.flag} className="w-5 h-5" />,
            }))}
            size="sm"
            variant="flat"
          />
        </div>
      </div>

      <div>
      {/* Accent Color Section */}
        <div className="flex items-center gap-2 mb-2">
          <Icon icon="solar:palette-bold" className="w-6 h-6 text-white" />
          <h3 className="text-3xl font-minecraft text-white">
            {t("settings.accent_color.title")}
          </h3>
        </div>
        <p className="text-base text-white/70 font-minecraft-ten mt-2">
          {t("settings.accent_color.description")}
          {isThemeActive && (
            <span className="text-white/50 ml-2">{t("settings.accent_color.disabled_theme")}</span>
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
          title={isAccentColorDisabled ? t("settings.accent_color.custom_tooltip_disabled") : t("settings.accent_color.custom_tooltip")}
          disabled={isAccentColorDisabled}
        >
          <div
            className="w-8 h-8 rounded-md border-2 border-white/20 shadow-lg group-hover:scale-105 transition-transform"
            style={{ backgroundColor: accentColor.value }}
          />
          <div className="flex flex-col items-start">
            <span className="font-minecraft-ten text-base text-white/80 group-hover:text-white transition-colors">
              {t("settings.accent_color.custom")}
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
            label: t("settings.auto_updates"),
            tooltip: t("settings.auto_updates.tooltip"),
            type: "toggle",
            value: tempConfig?.auto_check_updates || false,
            onChange: (checked) =>
              tempConfig &&
              setTempConfig({ ...tempConfig, auto_check_updates: checked }),
          },
          {
            id: "discord-presence",
            label: t("settings.discord_presence"),
            tooltip: t("settings.discord_presence.tooltip"),
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
            label: t("settings.beta_updates"),
            tooltip: t("settings.beta_updates.tooltip"),
            type: "toggle",
            value: tempConfig?.check_beta_channel || false,
            onChange: (checked) =>
              tempConfig &&
              setTempConfig({ ...tempConfig, check_beta_channel: checked }),
          },
          ...(canShowExperimental ? [{
            id: "experimental-mode",
            label: t("settings.experimental_mode"),
            tooltip: t("settings.experimental_mode.tooltip"),
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
            label: t("settings.open_logs"),
            tooltip: t("settings.open_logs.tooltip"),
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
            label: t("settings.hide_window"),
            tooltip: t("settings.hide_window.tooltip"),
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
            label: t("settings.concurrent_downloads"),
            tooltip: t("settings.concurrent_downloads.tooltip"),
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
            label: t("settings.concurrent_io"),
            tooltip: t("settings.concurrent_io.tooltip"),
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
            label: t("settings.border_radius"),
            tooltip: t("settings.border_radius.tooltip"),
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
            {t("settings.theme.title")}
          </h3>
        </div>
        <p className="text-base text-white/70 font-minecraft-ten mt-2">
          {t("settings.theme.description")}
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
                {t("settings.background.title")}
              </h3>
            </div>
            <div className="flex flex-col items-end gap-2" style={{ transform: 'translateY(16px)' }}>
              <div className="flex items-center gap-2">
                <span className="text-sm text-white/70 font-minecraft-ten">{t("settings.background.animations")}</span>
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
                <span className="text-xs text-white/60 font-minecraft-ten">{t("settings.background.quality_low")}</span>
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
                <span className="text-xs text-white/60 font-minecraft-ten">{t("settings.background.quality_high")}</span>
              </div>
            </div>
          </div>
          <p className="text-base text-white/70 font-minecraft-ten mt-2">
            {t("settings.background.description")}
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
      {/* Browser-Based Login Section */}
      <div>
        <CompactSettingsGrid
          settings={[
            {
              id: "browser-based-login",
              label: t("settings.browser_login"),
              tooltip: t("settings.browser_login.tooltip"),
              type: "toggle",
              value: tempConfig?.use_browser_based_login || false,
              onChange: (checked) =>
                tempConfig &&
                setTempConfig({ ...tempConfig, use_browser_based_login: checked }),
            },
          ]}
          disabled={saving}
        />
      </div>

      <div>
        <div className="mb-4">
          <div className="flex items-center gap-2 mb-2">
            <Icon icon="solar:folder-bold" className="w-6 h-6 text-white" />
            <SimpleTooltip content={t("settings.game_data_dir.tooltip")}>
              <h3 className="text-3xl font-minecraft text-white lowercase cursor-help">
                {t("settings.game_data_dir.title")}
              </h3>
            </SimpleTooltip>
          </div>
          <p className="text-base text-white/70 font-minecraft-ten mt-2">
            {t("settings.game_data_dir.description")}
          </p>

          <div className="flex gap-3 mt-4">
            <input
              type="text"
              value={tempConfig?.custom_game_directory || ""}
              placeholder={t("settings.game_data_dir.placeholder")}
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
                title={t("settings.game_data_dir.reset_tooltip")}
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
              title={t("settings.game_data_dir.select_tooltip")}
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
                {t("settings.hooks.title")}
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
              {isHooksExpanded ? t("settings.hooks.hide") : t("settings.hooks.show")}
            </Button>
          </div>
          <p className="text-base text-white/70 font-minecraft-ten mt-2">
            {t("settings.hooks.description")}
          </p>
        </div>

        {isHooksExpanded && (
          <div className="space-y-6 mt-6">
            <div className="p-4 rounded-lg border border-[#ffffff20] hover:bg-black/30 transition-colors">
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Icon icon="solar:play-circle-bold" className="w-5 h-5 text-white" />
                  <h5 className="font-minecraft text-2xl lowercase text-white">{t("settings.hooks.pre_launch.title")}</h5>
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
                      title: t("settings.hooks.pre_launch.confirm_title"),
                      message:
                        t("settings.hooks.pre_launch.confirm_message"),
                      confirmText: t("common.enable"),
                      cancelText: t("common.cancel"),
                      type: "warning",
                      fullscreen: true,
                    });
                    if (confirmed) {
                      setIsPreLaunchEditEnabled(true);
                      toast.success(t("settings.hooks.pre_launch.enabled"));
                    }
                  }}
                  icon={
                    <Icon
                      icon={isPreLaunchEditEnabled ? "solar:lock-unlocked-bold" : "solar:lock-keyhole-bold"}
                      className="w-4 h-4"
                    />
                  }
                >
                  {isPreLaunchEditEnabled ? t("settings.hooks.disable_editing") : t("settings.hooks.enable_editing")}
                </Button>
              </div>
              <p className="text-sm text-white/60 font-minecraft-ten mb-4">
                {t("settings.hooks.pre_launch.description")}
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
                placeholder={t("settings.hooks.pre_launch.placeholder")}
                className="w-full p-3 rounded-md bg-black/40 border border-[#ffffff20] text-white placeholder-white/40 font-minecraft-ten focus:outline-none focus:ring-2 focus:ring-white/30"
                disabled={saving || !isPreLaunchEditEnabled}
                title={!isPreLaunchEditEnabled ? t("settings.hooks.pre_launch.disabled_tooltip") : undefined}
              />
            </div>

            <div className="p-4 rounded-lg border border-[#ffffff20] hover:bg-black/30 transition-colors">
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Icon icon="solar:shield-bold" className="w-5 h-5 text-white" />
                  <h5 className="font-minecraft text-2xl lowercase text-white">{t("settings.hooks.wrapper.title")}</h5>
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
                      title: t("settings.hooks.wrapper.confirm_title"),
                      message:
                        t("settings.hooks.wrapper.confirm_message"),
                      confirmText: t("common.enable"),
                      cancelText: t("common.cancel"),
                      type: "warning",
                      fullscreen: true,
                    });
                    if (confirmed) {
                      setIsWrapperEditEnabled(true);
                      toast.success(t("settings.hooks.wrapper.enabled"));
                    }
                  }}
                  icon={
                    <Icon
                      icon={isWrapperEditEnabled ? "solar:lock-unlocked-bold" : "solar:lock-keyhole-bold"}
                      className="w-4 h-4"
                    />
                  }
                >
                  {isWrapperEditEnabled ? t("settings.hooks.disable_editing") : t("settings.hooks.enable_editing")}
                </Button>
              </div>
              <p className="text-sm text-white/60 font-minecraft-ten mb-4">
                {t("settings.hooks.wrapper.description")}
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
                placeholder={t("settings.hooks.wrapper.placeholder")}
                className="w-full p-3 rounded-md bg-black/40 border border-[#ffffff20] text-white placeholder-white/40 font-minecraft-ten focus:outline-none focus:ring-2 focus:ring-white/30"
                disabled={saving || !isWrapperEditEnabled}
                title={!isWrapperEditEnabled ? t("settings.hooks.wrapper.disabled_tooltip") : undefined}
              />
            </div>

            <div className="p-4 rounded-lg border border-[#ffffff20] hover:bg-black/30 transition-colors">
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Icon icon="solar:stop-circle-bold" className="w-5 h-5 text-white" />
                  <h5 className="font-minecraft text-2xl lowercase text-white">{t("settings.hooks.post_exit.title")}</h5>
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
                      title: t("settings.hooks.post_exit.confirm_title"),
                      message:
                        t("settings.hooks.post_exit.confirm_message"),
                      confirmText: t("common.enable"),
                      cancelText: t("common.cancel"),
                      type: "warning",
                      fullscreen: true,
                    });
                    if (confirmed) {
                      setIsPostExitEditEnabled(true);
                      toast.success(t("settings.hooks.post_exit.enabled"));
                    }
                  }}
                  icon={
                    <Icon
                      icon={isPostExitEditEnabled ? "solar:lock-unlocked-bold" : "solar:lock-keyhole-bold"}
                      className="w-4 h-4"
                    />
                  }
                >
                  {isPostExitEditEnabled ? t("settings.hooks.disable_editing") : t("settings.hooks.enable_editing")}
                </Button>
              </div>
              <p className="text-sm text-white/60 font-minecraft-ten mb-4">
                {t("settings.hooks.post_exit.description")}
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
                placeholder={t("settings.hooks.post_exit.placeholder")}
                className="w-full p-3 rounded-md bg-black/40 border border-[#ffffff20] text-white placeholder-white/40 font-minecraft-ten focus:outline-none focus:ring-2 focus:ring-white/30"
                disabled={saving || !isPostExitEditEnabled}
                title={!isPostExitEditEnabled ? t("settings.hooks.post_exit.disabled_tooltip") : undefined}
              />
            </div>

            <div className="mt-6 p-4 rounded-lg border border-orange-500/30 bg-orange-900/20">
              <div className="flex items-start gap-3">
                <Icon icon="solar:danger-triangle-bold" className="w-6 h-6 text-orange-400 flex-shrink-0 mt-1" />
                <div>
                  <h4 className="text-xl font-minecraft text-orange-300 mb-2 lowercase">
                    {t("settings.hooks.warning.title")}
                  </h4>
                  <p className="text-sm text-orange-200/80 font-minecraft-ten">
                    {t("settings.hooks.warning.description")}
                  </p>
                </div>
              </div>
            </div>

            <div className="mt-6 p-4 rounded-lg border border-[#ffffff20] bg-black/10">
              <div className="flex items-start gap-3">
                <Icon icon="solar:info-circle-bold" className="w-6 h-6 text-blue-400 flex-shrink-0 mt-1" />
                <div>
                  <h4 className="text-xl font-minecraft text-blue-300 mb-2 lowercase">
                    {t("settings.hooks.examples.title")}
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
                {t("settings.licenses.title")}
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
              {t("settings.licenses.view")}
            </Button>
          </div>
          <p className="text-base text-white/70 font-minecraft-ten mt-2">
            {t("settings.licenses.description")}
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
              {t("settings.loading")}
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
                {t("settings.error.title")}
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
                {t("common.try_again")}
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
            {t("settings.error.no_config")}
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
      case "debug":
        return <DebugSection />;
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
          onGroupChange={(groupId) => setActiveTab(groupId as "general" | "appearance" | "advanced" | "debug")}
          showAddButton={false}
        />

        {/* Header Actions */}
        <div style={{ transform: 'translateY(-3px)' }}>
          <ActionButton
            id="open-directory"
            label={t("settings.open_directory")}
            icon="solar:folder-bold"
            variant="highlight"
            tooltip={t("settings.open_directory.tooltip")}
            size="sm"
            onClick={async () => {
              try {
                await openLauncherDirectory();
              } catch (err) {
                console.error("Failed to open launcher directory:", err);
                toast.error(t("settings.open_directory.error", { error: String(err) }));
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