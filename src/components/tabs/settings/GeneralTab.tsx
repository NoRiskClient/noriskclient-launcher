"use client";

import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";
import { cn } from "../../../lib/utils";
import { Select } from "../../ui/Select";
import { ToggleSwitch } from "../../ui/ToggleSwitch";
import { RangeSlider } from "../../ui/RangeSlider";
import { ColorPicker } from "../../ColorPicker";
import { ColorPickerModal } from "../../modals/ColorPickerModal";
import { SettingsSection } from "../../ui/settings/SettingsSection";
import { SettingRow } from "../../ui/settings/SettingRow";
import { useThemeStore } from "../../../store/useThemeStore";
import { useGlobalModal } from "../../../hooks/useGlobalModal";
import { useLauncherTheme } from "../../../hooks/useLauncherTheme";
import { usePermission } from "../../../hooks/usePermission";
import { PERMISSION } from "../../../constants/permissions";
import { invalidateAnalyticsCache } from "../../../services/analytics-service";
import { LANGUAGE_OPTIONS, type SupportedLanguage } from "../../../i18n";
import { useSettingsConfig, useSettingsKeywords } from "./settings-context";

export function GeneralTab() {
  const { t } = useTranslation();
  const kw = useSettingsKeywords();
  const { config, tempConfig, setTempConfig, saving } = useSettingsConfig();
  const { language, setLanguage, accentColor, borderRadius, setBorderRadius, setAnalyticsConsent } =
    useThemeStore();
  const { showModal, hideModal } = useGlobalModal();
  const { isThemeActive } = useLauncherTheme();
  const isAccentColorDisabled = isThemeActive;

  const canShowExperimental =
    usePermission(PERMISSION.EXPERIMENTAL_MODE) ||
    !!tempConfig?.is_experimental ||
    !!config?.is_experimental;

  const handleConcurrentDownloadsChange = (value: number) => {
    if (tempConfig) setTempConfig({ ...tempConfig, concurrent_downloads: value });
  };
  const handleConcurrentIoLimitChange = (value: number) => {
    if (tempConfig) setTempConfig({ ...tempConfig, concurrent_io_limit: value });
  };

  return (
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
}
