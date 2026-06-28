"use client";

/**
 * NoriskPackSelector — self-contained Pack-Picker fuer den NRC-Content-Tab.
 *
 * Owns: `noriskPacksConfig`-Fetch, `packMenuOpen`, Refresh-Zustand.
 * Parent-API: nur `profile` + `onChanged`. Der Parent refresht seine Mod-Liste
 * via `onChanged` sobald sich `selected_norisk_pack_id` aendert.
 *
 * Ausgelagert aus LocalContentTabV3 damit der Tab nicht 60 Zeilen
 * NRC-Spezifikum tragen muss.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";
import { toast } from "react-hot-toast";
import type { Profile } from "../../../../../types/profile";
import type { NoriskModpacksConfig } from "../../../../../types/noriskPacks";
import * as ProfileService from "../../../../../services/profile-service";
import { useProfileStore } from "../../../../../store/profile-store";
import { useThemeStore } from "../../../../../store/useThemeStore";
import { ThemedDropdown, ThemedDropdownItem, ThemedDropdownDivider } from "../../shared/ThemedDropdown";

interface NoriskPackSelectorProps {
  profile: Profile;
  /** Aufgerufen wenn Pack gewechselt wurde — Parent refresht seine Content-Liste. */
  onChanged?: () => void;
}

export function NoriskPackSelector({ profile, onChanged }: NoriskPackSelectorProps) {
  const { t } = useTranslation();
  const { fetchProfiles } = useProfileStore();
  const accentColor = useThemeStore((s) => s.accentColor);

  const [config, setConfig] = useState<NoriskModpacksConfig | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const c = await ProfileService.getNoriskPacksResolved();
        if (!cancelled) setConfig(c);
      } catch (err) {
        console.error("[V3] Failed to fetch NoRisk packs config:", err);
        if (!cancelled) setConfig(null);
      }
    })();
    return () => { cancelled = true; };
  }, [profile.id]);

  const options = useMemo(() => {
    if (!config) return [] as { id: string; label: string }[];
    return Object.entries(config.packs)
      .map(([id, def]) => ({ id, label: def.displayName || id }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [config]);

  const selectedPackId = profile.selected_norisk_pack_id ?? null;
  const selectedLabel = selectedPackId
    ? (options.find(o => o.id === selectedPackId)?.label ?? selectedPackId)
    : t("profiles.v3.pack.noSelection");

  const handleChange = useCallback(async (newPackId: string | null) => {
    if (newPackId === selectedPackId) return;
    try {
      await ProfileService.updateProfile(profile.id, {
        selected_norisk_pack_id: newPackId,
        clear_selected_norisk_pack: newPackId === null,
      });
      await fetchProfiles();
      onChanged?.();
    } catch (err) {
      console.error("[V3] Failed to switch NoRisk pack:", err);
      toast.error(t("profiles.v3.pack.switchFailed"));
    }
  }, [profile.id, selectedPackId, fetchProfiles, onChanged, t]);

  const handleRefreshList = useCallback(async () => {
    setIsRefreshing(true);
    try {
      await ProfileService.refreshNoriskPacks();
      const c = await ProfileService.getNoriskPacksResolved();
      setConfig(c);
      toast.success(t("profiles.v3.pack.listRefreshed"));
    } catch (err) {
      console.error("[V3] Failed to refresh NoRisk packs:", err);
      toast.error(t("profiles.v3.pack.listRefreshFailed"));
    } finally {
      setIsRefreshing(false);
    }
  }, [t]);

  return (
    <div className="relative">
      <button
        onClick={() => setMenuOpen(v => !v)}
        onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = `${accentColor.value}33`; }}
        onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = `${accentColor.value}1a`; }}
        style={{ backgroundColor: `${accentColor.value}1a`, borderColor: `${accentColor.value}40` }}
        className="h-8 px-2.5 rounded-md border text-xs font-minecraft-ten text-white flex items-center gap-1.5 max-w-[220px] transition-colors"
      >
        <Icon icon="solar:shield-check-bold" className="w-3.5 h-3.5 flex-shrink-0" style={{ color: accentColor.value }} />
        <span className="truncate">{selectedLabel}</span>
        <Icon icon="solar:alt-arrow-down-linear" className="w-3 h-3 opacity-60 flex-shrink-0" />
      </button>
      <ThemedDropdown open={menuOpen} onClose={() => setMenuOpen(false)} width="w-60" scrollable>
        <ThemedDropdownItem
          icon="solar:close-circle-linear"
          selected={!selectedPackId}
          onClick={() => { handleChange(null); setMenuOpen(false); }}
        >
          {t("profiles.v3.pack.noSelection")}
        </ThemedDropdownItem>
        {options.length > 0 && <ThemedDropdownDivider />}
        {options.map(opt => (
          <ThemedDropdownItem
            key={opt.id}
            icon="solar:shield-check-bold"
            selected={selectedPackId === opt.id}
            onClick={() => { handleChange(opt.id); setMenuOpen(false); }}
          >
            <span className="truncate">{opt.label}</span>
          </ThemedDropdownItem>
        ))}
        <ThemedDropdownDivider />
        <ThemedDropdownItem
          icon="solar:refresh-linear"
          disabled={isRefreshing}
          onClick={() => { handleRefreshList(); setMenuOpen(false); }}
        >
          {isRefreshing ? t("profiles.v3.pack.refreshing") : t("profiles.v3.pack.refreshList")}
        </ThemedDropdownItem>
      </ThemedDropdown>
    </div>
  );
}
