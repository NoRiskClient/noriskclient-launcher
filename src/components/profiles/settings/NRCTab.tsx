"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Profile } from "../../../types/profile";
import { invoke } from "@tauri-apps/api/core";
import { Icon } from "@iconify/react";
import { useThemeStore } from "../../../store/useThemeStore";
import { Button } from "../../ui/buttons/Button";
import { gsap } from "gsap";
import { toast } from "react-hot-toast";
import * as ProfileService from "../../../services/profile-service";
import { parseErrorMessage } from "../../../utils/error-utils";
import type { NoriskModpacksConfig, NoriskPackDefinition } from "../../../types/noriskPacks";
import { PackPicker } from "../PackPicker";
import { loadPacks, usePacks } from "../../../hooks/usePacks";

interface NRCTabProps {
  profile: Profile;
  editedProfile: Profile;
  updateProfile: (updates: Partial<Profile>) => void;
  onRefresh?: () => Promise<Profile>;
}

export function NRCTab({
  profile,
  editedProfile,
  updateProfile,
  onRefresh,
}: NRCTabProps) {
  const { t } = useTranslation();
  const { packs: noriskPacks, loading } = usePacks();
  const [packCompatibilityWarning, setPackCompatibilityWarning] = useState<string | null>(null);
  const [showYellowWarning, setShowYellowWarning] = useState(false);
  const [checkingCompatibility, setCheckingCompatibility] = useState(false);
  const [isRepairing, setIsRepairing] = useState(false);
  const accentColor = useThemeStore((state) => state.accentColor);
  const isBackgroundAnimationEnabled = useThemeStore(
    (state) => state.isBackgroundAnimationEnabled,
  );
  const tabRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isBackgroundAnimationEnabled && tabRef.current) {
      gsap.fromTo(
        tabRef.current,
        { opacity: 0 },
        { opacity: 1, duration: 0.4, ease: "power2.out" },
      );
    }
  }, [isBackgroundAnimationEnabled]);


  const selectedPackId = editedProfile.selected_norisk_pack_id || "";

  // Check pack compatibility when selection changes
  useEffect(() => {
    const checkPackCompatibility = async () => {
      if (!editedProfile.selected_norisk_pack_id || editedProfile.selected_norisk_pack_id === "") {
        setPackCompatibilityWarning(null);
        setShowYellowWarning(false);
        return;
      }

      setCheckingCompatibility(true);
      setPackCompatibilityWarning(null);
      setShowYellowWarning(false);

      try {
        // Get resolved packs with all mods
        const resolvedPacks = await loadPacks();

        // Check if the selected pack has NoRisk Client mods
        if (!resolvedPacks[editedProfile.selected_norisk_pack_id]) {
          setShowYellowWarning(true);
          return;
        }
      } catch (err) {
        console.warn("Failed to check pack compatibility:", err);
        setShowYellowWarning(true);
      } finally {
        setCheckingCompatibility(false);
      }
    };

    checkPackCompatibility();
  }, [editedProfile.selected_norisk_pack_id]);

  const handleRepair = async () => {
    try {
      setIsRepairing(true);
      await ProfileService.repairProfile(profile.id);
      toast.success(t('profiles.repair_success'));
    } catch (err) {
      console.error("Failed to repair profile:", err);
      const errorMessage = parseErrorMessage(err);
      toast.error(t('profiles.repair_failed', { error: errorMessage }));
    } finally {
      setIsRepairing(false);
    }
  };

  return (
    <div ref={tabRef} className="space-y-6 select-none">
      <div className="space-y-6">


        {/* NoRisk Pack Selection */}
        <div className="space-y-3">
          <div className="space-y-2">
            <label className="block text-lg font-smallcaps text-white mb-2">
              {t('nrc.info_title')}
            </label>
            <p className="text-sm text-white/60 font-minecraft">
              {t('nrc.info_description')}
            </p>
          </div>
          {(
            <>
              <PackPicker
                label={t('nrc.pack_label')}
                packs={noriskPacks}
                value={editedProfile.selected_norisk_pack_id || null}
                onChange={(packId) => updateProfile({ selected_norisk_pack_id: packId })}
                loading={loading}
              />

              {/* Show warning or description */}
              {showYellowWarning ? (
                <div className="text-center">
                  <p className="text-base text-yellow-400 font-minecraft">
                    {t('nrc.incompatible_warning')}
                  </p>
                </div>
              ) : editedProfile.selected_norisk_pack_id === null || editedProfile.selected_norisk_pack_id === "" ? (
                <div className="text-center">
                  <p className="text-sm text-amber-400 font-minecraft">
                    {t('nrc.no_features_warning')}
                  </p>
                </div>
              ) : (
                editedProfile.selected_norisk_pack_id && noriskPacks[editedProfile.selected_norisk_pack_id] && (
                  <div className="text-center">
                    <p className="text-sm text-white/70 font-minecraft">
                      {noriskPacks[editedProfile.selected_norisk_pack_id].description}
                    </p>
                  </div>
                )
              )}

              {/* Compatibility Checking */}
              {checkingCompatibility && (
                <div className="flex items-center gap-2 text-white/70">
                  <Icon
                    icon="svg-spinners:ring-resize"
                    className="w-4 h-4"
                  />
                  <span className="text-sm font-minecraft">
                    {t('nrc.checking_compatibility')}
                  </span>
                </div>
              )}

              {/* Compatibility Warning */}
              {packCompatibilityWarning && (
                <div className="p-3 bg-red-900/20 border border-red-500/30 rounded-lg">
                  <div className="flex items-start gap-2">
                    <Icon
                      icon="solar:danger-triangle-bold"
                      className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5"
                    />
                    <p className="text-xs text-red-300 font-minecraft">
                      {packCompatibilityWarning}
                    </p>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Repair Profile Section */}
        <div className="space-y-3">
          <label className="block text-lg font-smallcaps text-white mb-2">
            {t('nrc.repair_title')}
          </label>
          <div className="flex flex-col space-y-2 max-w-xs">
            <p className="text-xs text-white/60 font-minecraft select-none leading-relaxed whitespace-normal break-words overflow-wrap-anywhere">
              {t('nrc.repair_description')}
            </p>
            <Button
              onClick={handleRepair}
              disabled={isRepairing}
              variant="secondary"
              icon={
                isRepairing ? (
                  <Icon
                    icon="svg-spinners:ring-resize"
                    className="w-4 h-4 text-white"
                  />
                ) : (
                  <Icon icon="solar:shield-check-bold" className="w-4 h-4 text-white" />
                )
              }
              size="sm"
                    className="text-sm"
            >
              {isRepairing ? t('nrc.repairing') : t('nrc.repair')}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
