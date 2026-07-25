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
import { open } from "@tauri-apps/plugin-dialog";
import { Button } from "../../ui/buttons/Button";
import { Icon } from "@iconify/react";

export function AppearanceTab() {
  const { t } = useTranslation();
  const kw = useSettingsKeywords();
  const { saving } = useSettingsConfig();
  const { staticBackground, toggleStaticBackground, toggleBackgroundAnimation, showNavLabels, toggleNavLabels } =
    useThemeStore();
  const { 
    currentEffect, setCurrentEffect, 
    customMediaUrl, customMediaOpacity, customMediaBlur, customMediaQuality, customMediaOnlyOnPlay, customMediaHideEffects,
    setCustomMedia, setCustomMediaOpacity, setCustomMediaBlur, setCustomMediaQuality, setCustomMediaOnlyOnPlay, setCustomMediaHideEffects
  } = useBackgroundEffectStore();
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
              className="w-24 h-2 bg-white/20 rounded-lg appearance-none cursor-pointer accent-white hover:accent-white/80 transition-colors"
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

      <SettingsSection
        id="settings-section-custom-background"
        title={t("settings.custom_background.title")}
        icon="solar:gallery-bold"
        keywords={kw("settings.custom_background.title", "custom", "background", "video", "image", "bild", "hintergrund", "mp4", "gif")}
        description={t("settings.custom_background.description")}
      >
        <SettingRow label={t("settings.custom_background.select")} searchKeywords={kw("settings.custom_background.select", "select", "auswählen", "datei")}>
          <div className="flex items-center gap-2">
            {customMediaUrl && (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setCustomMedia(null, null)}
                icon={<Icon icon="solar:trash-bin-trash-bold" />}
              >
                {t("settings.custom_background.clear")}
              </Button>
            )}
            <Button
              variant="flat"
              size="sm"
              onClick={async () => {
                const selected = await open({
                  multiple: false,
                  filters: [{
                    name: 'Media',
                    extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'mp4', 'webm']
                  }]
                });
                if (selected && typeof selected === 'string') {
                  const ext = selected.split('.').pop()?.toLowerCase();
                  const type = ext === 'mp4' || ext === 'webm' ? 'video' : 'image';
                  setCustomMedia(selected, type);
                }
              }}
              icon={<Icon icon="solar:folder-open-bold" />}
            >
              {customMediaUrl ? t("settings.custom_background.change") : t("settings.custom_background.select")}
            </Button>
          </div>
        </SettingRow>
        
        {customMediaUrl && (
          <>
            <SettingRow label={t("settings.custom_background.opacity")} searchKeywords={kw("settings.custom_background.opacity", "opacity", "transparenz", "sichtbarkeit")}>
              <div className="flex items-center gap-3">
                <span className="text-xs text-white/60 font-minecraft-ten">0%</span>
                <input
                  type="range"
                  min="0"
                  max="100"
                  step="1"
                  value={Math.round(customMediaOpacity * 100)}
                  onChange={(e) => setCustomMediaOpacity(parseInt(e.target.value) / 100)}
                  className="w-24 h-2 bg-white/20 rounded-lg appearance-none cursor-pointer accent-white hover:accent-white/80 transition-colors"
                />
                <span className="text-xs text-white/60 font-minecraft-ten">100%</span>
              </div>
            </SettingRow>

            <SettingRow label={t("settings.custom_background.blur")} searchKeywords={kw("settings.custom_background.blur", "blur", "unscharf", "weichzeichnen")}>
              <div className="flex items-center gap-3">
                <span className="text-xs text-white/60 font-minecraft-ten">0</span>
                <input
                  type="range"
                  min="0"
                  max="20"
                  step="1"
                  value={customMediaBlur}
                  onChange={(e) => setCustomMediaBlur(parseInt(e.target.value))}
                  className="w-24 h-2 bg-white/20 rounded-lg appearance-none cursor-pointer accent-white hover:accent-white/80 transition-colors"
                />
                <span className="text-xs text-white/60 font-minecraft-ten">20</span>
              </div>
            </SettingRow>

            <SettingRow label={t("settings.background.quality")} searchKeywords={kw("settings.background.quality", "quality", "qualität", "performance", "leistung", "fps")}>
              <div className="flex items-center gap-3">
                <span className="text-xs text-white/60 font-minecraft-ten">{t("settings.background.quality_low")}</span>
                <input
                  type="range"
                  min="0"
                  max="2"
                  step="1"
                  value={customMediaQuality === "low" ? 0 : customMediaQuality === "medium" ? 1 : 2}
                  onChange={(e) => {
                    const value = parseInt(e.target.value);
                    const levels = ["low", "medium", "high"] as const;
                    setCustomMediaQuality(levels[value] || "medium");
                  }}
                  className="w-24 h-2 bg-white/20 rounded-lg appearance-none cursor-pointer accent-white hover:accent-white/80 transition-colors"
                />
                <span className="text-xs text-white/60 font-minecraft-ten">{t("settings.background.quality_high")}</span>
              </div>
            </SettingRow>

            <SettingRow label={t("settings.custom_background.only_on_play")} searchKeywords={kw("settings.custom_background.only_on_play", "play", "tab", "only")}>
              <ToggleSwitch checked={customMediaOnlyOnPlay} onChange={() => setCustomMediaOnlyOnPlay(!customMediaOnlyOnPlay)} size="md" />
            </SettingRow>

            <SettingRow label={t("settings.custom_background.hide_effects")} searchKeywords={kw("settings.custom_background.hide_effects", "hide", "effects", "effekte")}>
              <ToggleSwitch checked={customMediaHideEffects} onChange={() => setCustomMediaHideEffects(!customMediaHideEffects)} size="md" />
            </SettingRow>
          </>
        )}
      </SettingsSection>
    </div>
  );
}
