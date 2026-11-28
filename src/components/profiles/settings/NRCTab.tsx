import { useEffect, useRef, useState } from "react";
import { Icon } from "@iconify/react";
import { gsap } from "gsap";
import { useTranslation } from "react-i18next";
import { toast } from "react-hot-toast";

import type { Profile, ProfilePatch } from "../../../types/profile";
import { useThemeStore } from "../../../store/useThemeStore";
import * as ProfileService from "../../../services/profile-service";
import { parseErrorMessage } from "../../../utils/error-utils";
import { logError, logWarn } from "../../../utils/logging-utils";
import { loadPacks, usePacks } from "../../../hooks/usePacks";
import { PackPicker } from "../PackPicker";
import { Section, SectionButton } from "./SettingsSection";

interface NRCTabProps {
  profile: Profile;
  editedProfile: Profile;
  updateProfile: (patch: ProfilePatch, delayMs?: number) => void;
  onRefresh?: () => Promise<Profile>;
}

function Note({ icon, className, children }: { icon: string; className: string; children: string }) {
  return (
    <p className={`flex items-start gap-2 font-minecraft text-sm ${className}`}>
      <Icon icon={icon} className="mt-0.5 h-4 w-4 shrink-0" />
      {children}
    </p>
  );
}

export function NRCTab({ profile, editedProfile, updateProfile }: NRCTabProps) {
  const { t } = useTranslation();
  const { packs: noriskPacks, loading } = usePacks();
  const [showYellowWarning, setShowYellowWarning] = useState(false);
  const [checkingCompatibility, setCheckingCompatibility] = useState(false);
  const [isRepairing, setIsRepairing] = useState(false);
  const isBackgroundAnimationEnabled = useThemeStore((state) => state.isBackgroundAnimationEnabled);
  const tabRef = useRef<HTMLDivElement>(null);
  const packId = editedProfile.selected_norisk_pack_id || null;

  useEffect(() => {
    if (isBackgroundAnimationEnabled && tabRef.current) {
      gsap.fromTo(tabRef.current, { opacity: 0 }, { opacity: 1, duration: 0.4, ease: "power2.out" });
    }
  }, [isBackgroundAnimationEnabled]);

  useEffect(() => {
    setShowYellowWarning(false);
    if (!packId) return;
    setCheckingCompatibility(true);
    loadPacks()
      .then((resolvedPacks) => setShowYellowWarning(!resolvedPacks[packId]))
      .catch((err) => {
        logWarn(`Failed to check pack compatibility: ${err}`);
        setShowYellowWarning(true);
      })
      .finally(() => setCheckingCompatibility(false));
  }, [packId]);

  const handleRepair = async () => {
    try {
      setIsRepairing(true);
      await ProfileService.repairProfile(profile.id);
      toast.success(t("profiles.repair_success"));
    } catch (err) {
      logError(`Failed to repair profile: ${err}`);
      toast.error(t("profiles.repair_failed", { error: parseErrorMessage(err) }));
    } finally {
      setIsRepairing(false);
    }
  };

  return (
    <div ref={tabRef} className="space-y-4 select-none">
      <Section
        title={
          <span className="flex items-center gap-2">
            {t("nrc.pack_label")}
            <span title={t("nrc.info_description")} className="cursor-help text-white/40 hover:text-white/70">
              <Icon icon="solar:info-circle-bold" className="h-4 w-4" />
            </span>
          </span>
        }
        description={t("nrc.info_short")}
      >
        <div className="space-y-3">
          <PackPicker
            packs={noriskPacks}
            value={packId}
            onChange={(id) => updateProfile({ selected_norisk_pack_id: id })}
            loading={loading}
          />
          {checkingCompatibility ? (
            <p className="flex items-center gap-2 font-minecraft text-sm text-white/60">
              <Icon icon="svg-spinners:ring-resize" className="h-4 w-4" />
              {t("nrc.checking_compatibility")}
            </p>
          ) : showYellowWarning ? (
            <Note icon="solar:danger-triangle-bold" className="text-yellow-400">
              {t("nrc.incompatible_warning")}
            </Note>
          ) : !packId ? (
            <Note icon="solar:info-circle-bold" className="text-amber-400">
              {t("nrc.no_features_warning")}
            </Note>
          ) : (
            noriskPacks[packId]?.description && (
              <p className="line-clamp-2 font-minecraft text-xs text-white/50" title={noriskPacks[packId].description}>
                {noriskPacks[packId].description}
              </p>
            )
          )}
        </div>
      </Section>

      <Section
        title={t("nrc.repair_title")}
        description={t("nrc.repair_description")}
        aside={
          <SectionButton icon="solar:sledgehammer-bold" busy={isRepairing} onClick={handleRepair}>
            {isRepairing ? t("nrc.repairing") : t("nrc.repair")}
          </SectionButton>
        }
      />
    </div>
  );
}
