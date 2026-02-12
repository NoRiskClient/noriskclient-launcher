"use client";

import type React from "react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Icon } from "@iconify/react";
import type { Profile } from "../../../types/profile";
import { invoke } from "@tauri-apps/api/core";
import { useThemeStore } from "../../../store/useThemeStore";
import { Input } from "../../ui/Input";
import { Select } from "../../ui/Select";
import { RangeSlider } from "../../ui/RangeSlider";
import { Card } from "../../ui/Card";
import { gsap } from "gsap";

interface GeneralStepProps {
  profile: Partial<Profile>;
  updateProfile: (updates: Partial<Profile>) => void;
  systemRamMb: number;
}

interface NoriskPack {
  displayName: string;
  description: string;
  isExperimental?: boolean;
}

export function GeneralStep({
  profile,
  updateProfile,
  systemRamMb,
}: GeneralStepProps) {
  const { t } = useTranslation();
  const [nameError, setNameError] = useState<string | null>(null);
  const [noriskPacks, setNoriskPacks] = useState<Record<string, NoriskPack>>(
    {},
  );
  const [loading, setLoading] = useState(false);
  const [memoryMaxMb, setMemoryMaxMb] = useState<number>(
    profile.settings?.memory?.max || 4096,
  );
  const accentColor = useThemeStore((state) => state.accentColor);
  const isBackgroundAnimationEnabled = useThemeStore(
    (state) => state.isBackgroundAnimationEnabled,
  );
  const detailsCardRef = useRef<HTMLDivElement>(null);
  const settingsCardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (
      isBackgroundAnimationEnabled &&
      detailsCardRef.current &&
      settingsCardRef.current
    ) {
      gsap.fromTo(
        [detailsCardRef.current, settingsCardRef.current],
        { opacity: 0, y: 20 },
        {
          opacity: 1,
          y: 0,
          duration: 0.4,
          stagger: 0.1,
          ease: "power2.out",
        },
      );
    }

    const loadNoriskPacks = async () => {
      try {
        setLoading(true);
        const packsData = await invoke<{ packs: Record<string, NoriskPack> }>(
          "get_norisk_packs",
        ).catch(() => ({
          packs: {},
        }));
        setNoriskPacks(packsData.packs);
      } catch (err) {
        console.error("Failed to load NoRisk packs:", err);
      } finally {
        setLoading(false);
      }
    };

    loadNoriskPacks();
  }, [isBackgroundAnimationEnabled]);

  const handleNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const name = e.target.value;
    updateProfile({ name });

    if (!name) {
      setNameError("profile name is required");
    } else {
      setNameError(null);
    }
  };

  const handleMemoryChange = (value: number) => {
    setMemoryMaxMb(value);
    updateProfile({
      settings: {
        ...profile.settings!,
        memory: {
          min: 1024,
          max: value,
        },
      },
    });
  };

  const noriskPackOptions = Object.entries(noriskPacks).map(
    ([packId, packDef]) => ({
      value: packId,
      label: `${packDef.displayName} ${packDef.isExperimental ? "(experimental)" : ""}`,
    }),
  );

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-3xl font-minecraft text-white mb-3 lowercase">
          profile details
        </h2>
        <p className="text-xs text-white/70 font-minecraft-ten tracking-wide">
          Enter basic information about your Minecraft profile.
        </p>
      </div>

      <Card
        ref={detailsCardRef}
        variant="flat"
        className="p-6 space-y-6 bg-black/20 border border-white/10"
      >
        <div>
          <label className="block text-2xl font-minecraft text-white mb-2 lowercase">
            profile name <span className="text-red-400">*</span>
          </label>
          <Input
            value={profile.name || ""}
            onChange={handleNameChange}
            placeholder={t('placeholders.profile_name_awesome')}
            error={nameError}
            icon={<Icon icon="solar:user-bold" className="w-5 h-5" />}
          />
        </div>

        <div>
          <label className="block text-2xl font-minecraft text-white mb-2 lowercase">
            group
          </label>
          <Input
            value={profile.group || ""}
            onChange={(e) => updateProfile({ group: e.target.value || null })}
            placeholder={t('placeholders.group_name')}
            icon={<Icon icon="solar:folder-bold" className="w-5 h-5" />}
          />
        </div>
      </Card>

      <Card
        ref={settingsCardRef}
        variant="flat"
        className="p-6 space-y-6 bg-black/20 border border-white/10"
      >
        <div>
          <label className="block text-2xl font-minecraft text-white mb-2 lowercase">
            maximum ram: {memoryMaxMb} mb ({(memoryMaxMb / 1024).toFixed(1)} gb)
          </label>
          <RangeSlider
            value={memoryMaxMb}
            onChange={handleMemoryChange}
            min={1024}
            max={systemRamMb}
            step={512}
            minLabel="1 GB"
            maxLabel={`${(systemRamMb / 1024).toFixed(1)} GB`}
          />
          {(() => {
            let recommendedDisplayRam;
            if (systemRamMb <= 8192) {
              recommendedDisplayRam = Math.min(2048, systemRamMb);
            } else {
              recommendedDisplayRam = Math.min(4096, systemRamMb);
            }
            recommendedDisplayRam = Math.max(recommendedDisplayRam, 1024); // Ensure at least 1024

            return (
              <p className="text-xs text-white/60 mt-3 font-minecraft-ten tracking-wide">
                Recommended: {recommendedDisplayRam} MB (
                {(recommendedDisplayRam / 1024).toFixed(1)} GB)
              </p>
            );
          })()}
        </div>

        <div>
          <label className="block text-2xl font-minecraft text-white mb-2 lowercase">
            norisk client pack
          </label>
          {loading ? (
            <div className="flex items-center gap-2 text-white/70">
              <Icon
                icon="solar:refresh-bold"
                className="w-5 h-5 animate-spin"
              />
              <span className="font-minecraft text-xl">
                Loading NoRisk packs...
              </span>
            </div>
          ) : (
            <>
              <Select
                value={profile.selected_norisk_pack_id || ""}
                onChange={(value) =>
                  updateProfile({
                    selected_norisk_pack_id: value === "" ? null : value,
                  })
                }
                options={[
                  { value: "", label: "None (Optional)" },
                  ...noriskPackOptions,
                ]}
              />
              {profile.selected_norisk_pack_id &&
                noriskPacks[profile.selected_norisk_pack_id] && (
                  <Card
                    variant="flat"
                    className="mt-4 p-4 bg-black/20 border border-white/10"
                  >
                    <p className="text-xs text-white/80 font-minecraft-ten tracking-wide">
                      {noriskPacks[profile.selected_norisk_pack_id].description}
                    </p>
                  </Card>
                )}
            </>
          )}
        </div>
      </Card>
    </div>
  );
}
