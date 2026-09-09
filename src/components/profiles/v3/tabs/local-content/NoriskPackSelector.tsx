"use client";

import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "react-hot-toast";
import type { Profile } from "../../../../../types/profile";
import * as ProfileService from "../../../../../services/profile-service";
import { useProfileStore } from "../../../../../store/profile-store";
import { logError } from "../../../../../utils/logging-utils";
import { PackPicker } from "../../../PackPicker";
import { usePacks } from "../../../../../hooks/usePacks";

interface NoriskPackSelectorProps {
  profile: Profile;
  onChanged?: () => void;
}

export function NoriskPackSelector({ profile, onChanged }: NoriskPackSelectorProps) {
  const { t } = useTranslation();
  const { fetchProfiles } = useProfileStore();

  const { packs, loading } = usePacks();

  const selectedPackId = profile.selected_norisk_pack_id ?? null;

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
      logError(`[V3] Failed to switch NoRisk pack: ${err}`);
      toast.error(t("profiles.v3.pack.switchFailed"));
    }
  }, [profile.id, selectedPackId, fetchProfiles, onChanged, t]);

  return (
    <PackPicker
      packs={packs}
      value={selectedPackId}
      onChange={handleChange}
      size="sm"
      loading={loading}
    />
  );
}
