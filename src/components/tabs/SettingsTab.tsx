"use client";

import { Fragment, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
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
import { invalidateAnalyticsCache } from "../../services/analytics-service";
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
import { ActionButton } from ".././ui/ActionButton";
import { Modal } from ".././ui/Modal";
import { SettingsSection } from ".././ui/settings/SettingsSection";
import { SettingRow } from ".././ui/settings/SettingRow";
import { SearchWithFilters } from ".././ui/SearchWithFilters";
import { SettingsSearchContext } from ".././ui/settings/SettingsSearchContext";
import EffectPreviewCard from ".././EffectPreviewCard";
import { RangeSlider } from ".././ui/RangeSlider";
import { openExternalUrl } from "../../services/tauri-service";
import { openLauncherDirectory } from "../../services/tauri-service";
import { usePermission } from "../../hooks/usePermission";
import { PERMISSION } from "../../constants/permissions";
import { useConfirmDialog } from "../../hooks/useConfirmDialog";
import { useGlobalModal } from "../../hooks/useGlobalModal";
import { ColorPickerModal } from "../modals/ColorPickerModal";
import { ThemeSelector } from "../ThemeSelector";
import { useLauncherTheme } from "../../hooks/useLauncherTheme";
import { DebugSection, getDebugTabs } from "./DebugSection";
import { useTranslation } from "react-i18next";
import { LANGUAGE_OPTIONS } from "../../i18n";
import type { SupportedLanguage } from "../../i18n";
import { setDiscordState } from "../../utils/discordRpc";
import { parseErrorMessage } from "../../utils/error-utils";

type SettingsTabId = "general" | "appearance" | "advanced" | "debug";

interface SettingsTabProps {
  onClose: () => void;
}

export function SettingsTab({ onClose }: SettingsTabProps) {
  const { t, i18n } = useTranslation();
  const kw = useCallback(
    (key: string, ...extra: string[]) => [
      i18n.getFixedT("en")(key),
      i18n.getFixedT("de")(key),
      ...extra,
    ],
    [i18n],
  );
  const { language, setLanguage } = useThemeStore();
  const [config, setConfig] = useState<LauncherConfig | null>(null);
  const [tempConfig, setTempConfig] = useState<LauncherConfig | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<boolean>(false); const [activeTab, setActiveTab] = useState<SettingsTabId>(
    "general",
  );

  const [activeSection, setActiveSection] = useState<string | null>(null);
  const [sidebarSearch, setSidebarSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  useEffect(() => {
    const id = setTimeout(() => setDebouncedSearch(sidebarSearch), 150);
    return () => clearTimeout(id);
  }, [sidebarSearch]);
  const sidebarQuery = debouncedSearch.trim().toLowerCase();

  useEffect(() => { setDiscordState("Configuring Settings"); }, []);

  useEffect(() => {
    if (contentRef.current) contentRef.current.scrollTop = 0;
  }, [activeTab, sidebarQuery]);

  const sectionDefs: Record<SettingsTabId, { id: string; label: string }[]> = {
    general: [
      { id: "language", label: t("settings.language") },
      { id: "accent", label: t("settings.accent_color.title") },
      { id: "behaviour", label: t("settings.sections.behaviour") },
      { id: "interface", label: t("settings.sections.interface") },
    ],
    appearance: [
      { id: "theme", label: t("settings.theme.title") },
      { id: "background", label: t("settings.background.title") },
    ],
    advanced: [
      { id: "login_cache", label: t("settings.sections.login_cache") },
      { id: "gamedir", label: t("settings.game_data_dir.title") },
      { id: "hooks", label: t("settings.hooks.title") },
      { id: "licenses", label: t("settings.licenses.title") },
    ],
    debug: getDebugTabs(t),
  };

  const tabConfig: {
    id: SettingsTabId;
    label: string;
    icon: string;
    children?: { id: string; label: string }[];
  }[] = [
    { id: "general", label: t("settings.tabs.general"), icon: "solar:settings-bold", children: sectionDefs.general },
    { id: "appearance", label: t("settings.tabs.appearance"), icon: "solar:palette-bold", children: sectionDefs.appearance },
    { id: "advanced", label: t("settings.tabs.advanced"), icon: "solar:tuning-bold", children: sectionDefs.advanced },
    { id: "debug", label: t("settings.tabs.debug"), icon: "solar:bug-bold", children: sectionDefs.debug },
  ];

  const selectTab = (id: SettingsTabId) => {
    setSidebarSearch("");
    setActiveTab(id);
  };
  const [customColor, setCustomColor] = useState("#4f8eff");
  const contentRef = useRef<HTMLDivElement>(null);
  const sidebarListRef = useRef<HTMLDivElement>(null);
  const autoSaveTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (!activeSection) return;
    const el = sidebarListRef.current?.querySelector(`[data-section-id="${activeSection}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [activeSection]);

  const spySuppressRef = useRef(false);
  const spyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const scrollToSection = (id: string) => {
    const el = document.getElementById(`settings-section-${id}`);
    if (!el) return;
    spySuppressRef.current = true;
    setActiveSection(id);
    if (spyTimeoutRef.current) clearTimeout(spyTimeoutRef.current);
    spyTimeoutRef.current = setTimeout(() => {
      spySuppressRef.current = false;
    }, 500);
    el.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  useEffect(() => {
    if (sidebarQuery) return;
    const root = contentRef.current;
    const defs = sectionDefs[activeTab];
    if (!root || !defs) {
      setActiveSection(null);
      return;
    }
    const onScroll = () => {
      if (spySuppressRef.current) return;
      const rootTop = root.getBoundingClientRect().top;
      const line = 80;
      let current = defs[0].id;
      for (const d of defs) {
        const el = document.getElementById(`settings-section-${d.id}`);
        if (!el) continue;
        if (el.getBoundingClientRect().top - rootTop <= line) current = d.id;
      }
      setActiveSection(current);
    };
    onScroll();
    root.addEventListener("scroll", onScroll, { passive: true });
    return () => root.removeEventListener("scroll", onScroll);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, sidebarQuery, config, tempConfig]);

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
  const { qualityLevel, setQualityLevel, cosmeticRenderer3d, setCosmeticRenderer3d } = useQualitySettingsStore();
  const { borderRadius, setBorderRadius, setAnalyticsConsent } = useThemeStore();

  const { confirm, confirmDialog } = useConfirmDialog();
  const { showModal, hideModal } = useGlobalModal();
  const { isThemeActive } = useLauncherTheme();

  const hasExperimentalPermission = usePermission(PERMISSION.EXPERIMENTAL_MODE);
  const canShowExperimental =
    hasExperimentalPermission ||
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
      setError(parseErrorMessage(err));
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
        const errorMessage = parseErrorMessage(err);
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
      <SettingsSection
        id="settings-section-language"
        title={t("settings.language")}
        icon="solar:global-bold"
        keywords={kw("settings.language", "sprache", "language", "locale")}
        description={t("settings.language.description")}
      >
        <SettingRow label={t("settings.language")} searchKeywords={kw("settings.language", "sprache", "locale")}>
          <div className="w-56">
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
        </SettingRow>
      </SettingsSection>

      <SettingsSection
        id="settings-section-accent"
        title={t("settings.accent_color.title")}
        icon="solar:palette-bold"
        keywords={kw("settings.accent_color.title", "color", "colour", "farbe", "akzent", "accent", "theme")}
        description={
          <>
            {t("settings.accent_color.description")}
            {isThemeActive && (
              <span className="text-white/50 ml-2">{t("settings.accent_color.disabled_theme")}</span>
            )}
          </>
        }
      >
        <div className="flex items-center gap-6 py-3">
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
      </SettingsSection>

      <SettingsSection id="settings-section-behaviour" title={t("settings.sections.behaviour")} icon="solar:tuning-2-bold" keywords={kw("settings.sections.behaviour", "behaviour", "behavior", "verhalten")}>
        <SettingRow
          label={t("settings.auto_updates")}
          description={t("settings.auto_updates.tooltip")}
          searchKeywords={kw("settings.auto_updates", "update", "updates", "aktualisierung")}
          disabled={saving}
        >
          <ToggleSwitch
            checked={tempConfig?.auto_check_updates || false}
            onChange={(checked) => tempConfig && setTempConfig({ ...tempConfig, auto_check_updates: checked })}
            disabled={saving}
            size="md"
          />
        </SettingRow>
        <SettingRow
          label={t("settings.discord_presence")}
          description={t("settings.discord_presence.tooltip")}
          searchKeywords={kw("settings.discord_presence", "discord", "presence", "status", "rich")}
          disabled={saving}
        >
          <ToggleSwitch
            checked={tempConfig?.enable_discord_presence || false}
            onChange={(checked) => tempConfig && setTempConfig({ ...tempConfig, enable_discord_presence: checked })}
            disabled={saving}
            size="md"
          />
        </SettingRow>
        <SettingRow
          label={t("settings.beta_updates")}
          description={t("settings.beta_updates.tooltip")}
          searchKeywords={kw("settings.beta_updates", "beta", "update", "channel", "kanal")}
          disabled={saving}
        >
          <ToggleSwitch
            checked={tempConfig?.check_beta_channel || false}
            onChange={(checked) => tempConfig && setTempConfig({ ...tempConfig, check_beta_channel: checked })}
            disabled={saving}
            size="md"
          />
        </SettingRow>
        {canShowExperimental && (
          <SettingRow
            label={t("settings.experimental_mode")}
            description={t("settings.experimental_mode.tooltip")}
            searchKeywords={kw("settings.experimental_mode", "experimental", "experimentell", "beta")}
            disabled={saving}
          >
            <ToggleSwitch
              checked={tempConfig?.is_experimental || false}
              onChange={(checked) => tempConfig && setTempConfig({ ...tempConfig, is_experimental: checked })}
              disabled={saving}
              size="md"
            />
          </SettingRow>
        )}
        <SettingRow
          label={t("settings.open_logs")}
          description={t("settings.open_logs.tooltip")}
          searchKeywords={kw("settings.open_logs", "logs", "log", "protokoll")}
          disabled={saving}
        >
          <ToggleSwitch
            checked={tempConfig?.open_logs_after_starting || false}
            onChange={(checked) => tempConfig && setTempConfig({ ...tempConfig, open_logs_after_starting: checked })}
            disabled={saving}
            size="md"
          />
        </SettingRow>
        <SettingRow
          label={t("settings.hide_window")}
          description={t("settings.hide_window.tooltip")}
          searchKeywords={kw("settings.hide_window", "window", "fenster", "hide", "verstecken", "minimize")}
          disabled={saving}
        >
          <ToggleSwitch
            checked={tempConfig?.hide_on_process_start || false}
            onChange={(checked) => tempConfig && setTempConfig({ ...tempConfig, hide_on_process_start: checked })}
            disabled={saving}
            size="md"
          />
        </SettingRow>
        <SettingRow
          label={t("analytics.settings.label")}
          description={t("analytics.settings.tooltip")}
          searchKeywords={kw("analytics.settings.label", "analytics", "analyse", "telemetry", "telemetrie", "tracking")}
          disabled={saving}
        >
          <ToggleSwitch
            checked={tempConfig?.enable_analytics || false}
            onChange={(checked) => {
              if (tempConfig) {
                setTempConfig({ ...tempConfig, enable_analytics: checked });
                setAnalyticsConsent({
                  hasMadeDecision: true,
                  decision: checked ? 'accepted' : 'declined',
                });
                invalidateAnalyticsCache();
              }
            }}
            disabled={saving}
            size="md"
          />
        </SettingRow>
      </SettingsSection>

      <SettingsSection id="settings-section-interface" title={t("settings.sections.interface")} icon="solar:slider-horizontal-bold" keywords={kw("settings.sections.interface", "downloads", "interface", "oberfläche", "performance")}>
        <SettingRow
          label={t("settings.concurrent_downloads")}
          description={t("settings.concurrent_downloads.tooltip")}
          searchKeywords={kw("settings.concurrent_downloads", "download", "downloads", "herunterladen", "parallel")}
          disabled={saving}
          vertical
        >
          <RangeSlider
            value={tempConfig?.concurrent_downloads || 3}
            onChange={handleConcurrentDownloadsChange}
            min={1}
            max={10}
            step={1}
            disabled={saving}
            variant="flat"
            size="sm"
            minLabel="1"
            maxLabel="10"
            icon={<Icon icon="solar:multiple-forward-right-bold" className="w-3 h-3" />}
          />
        </SettingRow>
        <SettingRow
          label={t("settings.concurrent_io")}
          description={t("settings.concurrent_io.tooltip")}
          searchKeywords={kw("settings.concurrent_io", "io", "disk", "parallel", "festplatte")}
          disabled={saving}
          vertical
        >
          <RangeSlider
            value={tempConfig?.concurrent_io_limit || 10}
            onChange={handleConcurrentIoLimitChange}
            min={1}
            max={20}
            step={1}
            disabled={saving}
            variant="flat"
            size="sm"
            minLabel="1"
            maxLabel="20"
            icon={<Icon icon="solar:server-bold" className="w-3 h-3" />}
          />
        </SettingRow>
        <SettingRow
          label={t("settings.border_radius")}
          description={t("settings.border_radius.tooltip")}
          searchKeywords={kw("settings.border_radius", "border", "rand", "ecken", "eckenradius", "corner", "radius", "rounding", "rundung")}
          disabled={saving}
          vertical
        >
          <RangeSlider
            value={borderRadius}
            onChange={setBorderRadius}
            min={0}
            max={20}
            step={1}
            disabled={saving}
            variant="flat"
            size="sm"
            minLabel="0px"
            maxLabel="20px"
            icon={<Icon icon="solar:widget-bold" className="w-3 h-3" />}
          />
        </SettingRow>
      </SettingsSection>
    </div>
  );

  const renderAppearanceTab = () => (
    <div className="space-y-6">
      <SettingsSection
        id="settings-section-theme"
        title={t("settings.theme.title")}
        icon="solar:star-bold"
        keywords={kw("settings.theme.title", "color", "colour", "farbe", "theme", "thema", "design", "skin", "aussehen")}
        description={t("settings.theme.description")}
      >
        <div className="py-3">
          <ThemeSelector />
        </div>
      </SettingsSection>

      <SettingsSection
        id="settings-section-background"
        title={t("settings.background.title")}
        icon="solar:stars-bold"
        keywords={kw("settings.background.title", "color", "colour", "farbe", "hintergrund", "background", "effekt", "effect", "animation", "animationen")}
        description={t("settings.background.description")}
      >
        <SettingRow label={t("settings.background.animations")} searchKeywords={kw("settings.background.animations", "animation", "animationen", "motion")} disabled={saving}>
          <ToggleSwitch
            checked={!staticBackground}
            onChange={() => {
              toggleStaticBackground();
              toggleBackgroundAnimation();
            }}
            disabled={saving}
            size="md"
          />
        </SettingRow>
        <SettingRow label={t("settings.background.skin_animation")} searchKeywords={kw("settings.background.skin_animation", "skin", "animation", "cape", "3d")} disabled={saving}>
          <ToggleSwitch
            checked={cosmeticRenderer3d}
            onChange={() => setCosmeticRenderer3d(!cosmeticRenderer3d)}
            disabled={saving}
            size="md"
          />
        </SettingRow>
        <SettingRow label={t("settings.background.snow")} searchKeywords={kw("settings.background.snow", "snow", "schnee", "winter")} disabled={saving}>
          <SnowEffectToggle showLabel={false} size="md" disabled={saving} />
        </SettingRow>
        <SettingRow label={t("settings.background.quality")} searchKeywords={kw("settings.background.quality", "quality", "qualität", "performance", "leistung", "fps")} disabled={saving}>
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
              className="w-24 h-2 bg-white/20 rounded-lg appearance-none cursor-pointer slider accent-white hover:accent-white/80 transition-colors"
              disabled={saving}
            />
            <span className="text-xs text-white/60 font-minecraft-ten">{t("settings.background.quality_high")}</span>
          </div>
        </SettingRow>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 py-4">
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
      </SettingsSection>
    </div>
  );

  const renderAdvancedTab = () => (
    <div className="space-y-6">
      <SettingsSection id="settings-section-login_cache" title={t("settings.sections.login_cache")} icon="solar:login-3-bold" keywords={kw("settings.sections.login_cache", "login", "cache", "anmeldung")}>
        <SettingRow
          label={t("settings.browser_login")}
          description={t("settings.browser_login.tooltip")}
          searchKeywords={kw("settings.browser_login", "browser", "login", "anmeldung", "auth", "microsoft")}
          disabled={saving}
        >
          <ToggleSwitch
            checked={tempConfig?.use_browser_based_login || false}
            onChange={(checked) => tempConfig && setTempConfig({ ...tempConfig, use_browser_based_login: checked })}
            disabled={saving}
            size="md"
          />
        </SettingRow>
        <SettingRow
          label={t("settings.cache_natives")}
          description={t("settings.cache_natives.tooltip")}
          searchKeywords={kw("settings.cache_natives", "cache", "natives", "extraction", "performance")}
          disabled={saving}
        >
          <ToggleSwitch
            checked={tempConfig?.cache_natives_extraction ?? true}
            onChange={(checked) => tempConfig && setTempConfig({ ...tempConfig, cache_natives_extraction: checked })}
            disabled={saving}
            size="md"
          />
        </SettingRow>
      </SettingsSection>

      <SettingsSection
        id="settings-section-gamedir"
        title={t("settings.game_data_dir.title")}
        icon="solar:folder-bold"
        keywords={kw("settings.game_data_dir.title", "game", "data", "directory", "ordner", "verzeichnis", "pfad", "path", "folder")}
        description={t("settings.game_data_dir.description")}
      >
        <div className="flex gap-3 py-3">
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
      </SettingsSection>

      <SettingsSection
        id="settings-section-hooks"
        title={t("settings.hooks.title")}
        icon="solar:code-bold"
        keywords={kw("settings.hooks.title", "hook", "hooks", "script", "skript", "command", "befehl", "wrapper")}
        description={t("settings.hooks.description")}
        headerActions={
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
        }
      >
        {isHooksExpanded && (
          <div className="space-y-6 py-3">
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
      </SettingsSection>

      <SettingsSection
        id="settings-section-licenses"
        title={t("settings.licenses.title")}
        icon="solar:document-text-bold"
        keywords={kw("settings.licenses.title", "license", "licenses", "lizenz", "lizenzen", "credits")}
        description={t("settings.licenses.description")}
        headerActions={
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              openExternalUrl("https://norisk.gg/licenses")
            }}
            icon={<Icon icon="solar:external-link-bold" className="w-5 h-5" />}
          >
            {t("settings.licenses.view")}
          </Button>
        }
      >
        <div className="py-1" />
      </SettingsSection>

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

    if (sidebarQuery) {
      const bodyOf: Partial<Record<SettingsTabId, () => ReactNode>> = {
        general: renderGeneralTab,
        appearance: renderAppearanceTab,
        advanced: renderAdvancedTab,
      };
      const order: SettingsTabId[] = ["general", "appearance", "advanced"];
      const ordered = [activeTab, ...order.filter((id) => id !== activeTab)].filter(
        (id) => bodyOf[id],
      ) as SettingsTabId[];
      return (
        <div className="space-y-6">
          {ordered.map((id) => (
            <Fragment key={id}>{bodyOf[id]!()}</Fragment>
          ))}
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
    <Modal
      title={t("nav.settings")}
      titleIcon={<Icon icon="solar:settings-bold" className="w-8 h-8" />}
      onClose={onClose}
      width="xl"
      className="!max-w-6xl h-[85vh] min-h-[600px] flex flex-col"
      headerActions={
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
              toast.error(t("settings.open_directory.error", { error: parseErrorMessage(err) }));
            }
          }}
        />
      }
    >
      <div className="flex h-full p-4 gap-2">
        <div className="w-64 flex flex-col flex-shrink-0">
          <div className="px-1 pb-3">
            <SearchWithFilters
              placeholder={t("common.search")}
              searchValue={sidebarSearch}
              onSearchChange={setSidebarSearch}
              showSort={false}
              showFilter={false}
              compact
              className="w-full"
            />
          </div>
          <div ref={sidebarListRef} className="space-y-0 flex-1 overflow-y-auto custom-scrollbar">
            {tabConfig.map((tab) => {
              const isActive = activeTab === tab.id;
              return (
                <div key={tab.id}>
                  <button
                    className={cn(
                      "w-full text-left px-3 py-2.5 rounded-lg transition-colors border-0 outline-none flex items-center gap-3",
                      isActive
                        ? "text-white"
                        : "bg-transparent text-white/60 hover:bg-white/5 hover:text-white/90",
                    )}
                    style={isActive ? { backgroundColor: `${accentColor.value}26` } : undefined}
                    onClick={() => selectTab(tab.id)}
                  >
                    <Icon
                      icon={tab.icon}
                      className="w-6 h-6 transition-colors duration-200"
                      style={{ color: isActive ? accentColor.value : undefined }}
                    />
                    <span
                      className={cn(
                        "font-minecraft text-3xl lowercase transition-colors duration-200",
                        isActive && "font-medium",
                      )}
                    >
                      {tab.label}
                    </span>
                  </button>

                  {isActive && !sidebarQuery && tab.children && (
                    <div className="flex flex-col mt-1 ml-5 border-l border-white/10">
                      {tab.children.map((child) => {
                        const childActive = activeSection === child.id;
                        return (
                          <button
                            key={child.id}
                            data-section-id={child.id}
                            className={cn(
                              "w-full text-left pl-4 pr-2 py-1.5 -ml-px border-l-2 outline-none font-minecraft text-2xl lowercase transition-[color,border-color] duration-150",
                              childActive
                                ? "text-white"
                                : "border-transparent text-white/40 hover:text-white/75",
                            )}
                            style={childActive ? { borderColor: accentColor.value } : undefined}
                            onClick={() => scrollToSection(child.id)}
                          >
                            {child.label}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        <div className="flex items-center">
          <div className="border-l border-white/10 mx-4 my-3 h-[85%]"></div>
        </div>

        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
          <div
            ref={contentRef}
            className="flex-1 py-2 px-5 overflow-y-auto overflow-x-hidden custom-scrollbar min-w-0"
          >
            <SettingsSearchContext.Provider value={sidebarQuery}>
              {renderTabContent()}
            </SettingsSearchContext.Provider>
          </div>
        </div>
      </div>

      {confirmDialog}
    </Modal>
  );
}