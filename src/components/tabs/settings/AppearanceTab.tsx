"use client";

import { useTranslation } from "react-i18next";
import { ToggleSwitch } from "../../ui/ToggleSwitch";
import { SnowEffectToggle } from "../../ui/SnowEffectToggle";
import { SettingsSection } from "../../ui/settings/SettingsSection";
import { SettingRow } from "../../ui/settings/SettingRow";
import { ThemeSelector } from "../../ThemeSelector";
import { FontSelector } from "../../FontSelector";
import EffectPreviewCard from "../../EffectPreviewCard";
import { useThemeStore } from "../../../store/useThemeStore";
import { BACKGROUND_EFFECTS, useBackgroundEffectStore } from "../../../store/background-effect-store";
import { useQualitySettingsStore } from "../../../store/quality-settings-store";
import { useSettingsConfig, useSettingsKeywords } from "./settings-context";

export function AppearanceTab() {
  const { t } = useTranslation();
  const kw = useSettingsKeywords();
  const { saving } = useSettingsConfig();
  const { staticBackground, toggleStaticBackground, toggleBackgroundAnimation, showNavLabels, toggleNavLabels } =
    useThemeStore();
  const { currentEffect, setCurrentEffect } = useBackgroundEffectStore();
  const { qualityLevel, setQualityLevel, cosmeticRenderer3d, setCosmeticRenderer3d } =
    useQualitySettingsStore();

  const backgroundOptions = [
    { id: BACKGROUND_EFFECTS.MATRIX_RAIN, name: t("settings.background.matrix_rain"), icon: "solar:code-bold" },
    { id: BACKGROUND_EFFECTS.ENCHANTMENT_PARTICLES, name: t("settings.background.enchantment_table"), icon: "solar:magic-stick-bold" },
    { id: BACKGROUND_EFFECTS.NEBULA_WAVES, name: t("settings.background.nebula_waves"), icon: "solar:soundwave-bold" },
    { id: BACKGROUND_EFFECTS.NEBULA_PARTICLES, name: t("settings.background.nebula_particles"), icon: "solar:star-bold" },
    { id: BACKGROUND_EFFECTS.NEBULA_GRID, name: t("settings.background.nebula_grid"), icon: "solar:widget-bold" },
    { id: BACKGROUND_EFFECTS.NEBULA_VOXELS, name: t("settings.background.nebula_voxels"), icon: "solar:asteroid-bold" },
    { id: BACKGROUND_EFFECTS.NEBULA_LIGHTNING, name: t("settings.background.nebula_lightning"), icon: "solar:bolt-bold" },
    { id: BACKGROUND_EFFECTS.NEBULA_LIQUID_CHROME, name: t("settings.background.liquid_chrome"), icon: "solar:cloud-waterdrops-bold" },
    { id: BACKGROUND_EFFECTS.RETRO_GRID, name: t("settings.background.retro_grid"), icon: "solar:widget-5-bold" },
    { id: BACKGROUND_EFFECTS.PLAIN_BACKGROUND, name: t("settings.background.plain_color"), icon: "solar:palette-bold" },
  ];

  return (
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
        id="settings-section-font"
        title={t("settings.font.title")}
        icon="solar:text-bold"
        keywords={kw("settings.font.title", "font", "schrift", "schriftart", "typography", "typografie", "text")}
        description={t("settings.font.description")}
      >
        <div className="py-3">
          <FontSelector disabled={saving} />
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
        <SettingRow label={t("settings.nav_labels")} description={t("settings.nav_labels.tooltip")} searchKeywords={kw("settings.nav_labels", "sidebar", "labels", "text", "beschriftung", "navigation", "nav", "icons")}>
          <ToggleSwitch checked={showNavLabels} onChange={toggleNavLabels} size="md" />
        </SettingRow>
        <SettingRow label={t("settings.background.snow")} searchKeywords={kw("settings.background.snow", "snow", "schnee", "winter")} disabled={saving}>
          <SnowEffectToggle showLabel={false} size="md" disabled={saving} />
        </SettingRow>
        <SettingRow label={t("settings.background.quality")} searchKeywords={kw("settings.background.quality", "quality", "qualität", "performance", "leistung", "fps")} disabled={saving}>
          <div className="flex items-center gap-3">
            <span className="text-xs text-white/60 font-minecraft">{t("settings.background.quality_low")}</span>
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
            <span className="text-xs text-white/60 font-minecraft">{t("settings.background.quality_high")}</span>
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
}
