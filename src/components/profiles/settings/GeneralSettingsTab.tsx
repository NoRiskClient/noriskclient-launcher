"use client";

import { useEffect, useRef, useState } from "react";
import type { Profile } from "../../../types/profile";
import { invoke } from "@tauri-apps/api/core";
import { Icon } from "@iconify/react";
import { useThemeStore } from "../../../store/useThemeStore";
import { Button } from "../../ui/buttons/Button";
import { Input } from "../../ui/Input";
import { Select } from "../../ui/Select";
import { Card } from "../../ui/Card";
import { gsap } from "gsap";
import { toast } from "react-hot-toast";

interface GeneralSettingsTabProps {
  profile: Profile;
  editedProfile: Profile;
  updateProfile: (updates: Partial<Profile>) => void;
  onDelete: () => void;
  isDeleting?: boolean;
}

interface NoriskPack {
  displayName: string;
  description: string;
  isExperimental?: boolean;
}

export function GeneralSettingsTab({
  profile,
  editedProfile,
  updateProfile,
  onDelete,
  isDeleting,
}: GeneralSettingsTabProps) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [noriskPacks, setNoriskPacks] = useState<Record<string, NoriskPack>>(
    {},
  );
  const [loading, setLoading] = useState(false);
  const accentColor = useThemeStore((state) => state.accentColor);
  const isBackgroundAnimationEnabled = useThemeStore(
    (state) => state.isBackgroundAnimationEnabled,
  );
  const tabRef = useRef<HTMLDivElement>(null);
  const formRef = useRef<HTMLDivElement>(null);
  const actionsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isBackgroundAnimationEnabled) {
      if (tabRef.current) {
        gsap.fromTo(
          tabRef.current,
          { opacity: 0 },
          { opacity: 1, duration: 0.4, ease: "power2.out" },
        );
      }

      if (formRef.current) {
        gsap.fromTo(
          formRef.current.children,
          { opacity: 0, y: 20 },
          {
            opacity: 1,
            y: 0,
            duration: 0.4,
            stagger: 0.1,
            ease: "power2.out",
            delay: 0.2,
          },
        );
      }

      if (actionsRef.current) {
        gsap.fromTo(
          actionsRef.current,
          { opacity: 0, y: 20 },
          {
            opacity: 1,
            y: 0,
            duration: 0.4,
            ease: "power2.out",
            delay: 0.4,
          },
        );
      }
    }
  }, [isBackgroundAnimationEnabled]);

  useEffect(() => {
    const loadNoriskPacks = async () => {
      try {
        setLoading(true);
        const packsData = await invoke<{ packs: Record<string, NoriskPack> }>(
          "get_norisk_packs",
        );
        setNoriskPacks(packsData.packs);
      } catch (err) {
        console.error("Failed to load NoRisk packs:", err);
        toast.error(
          `Failed to load NoRisk packs: ${err instanceof Error ? err.message : String(err)}`,
        );
      } finally {
        setLoading(false);
      }
    };

    loadNoriskPacks();
  }, []);

  const handleDelete = () => {
    if (confirmDelete) {
      onDelete();
    } else {
      setConfirmDelete(true);
      if (isBackgroundAnimationEnabled && actionsRef.current) {
        const deleteButton =
          actionsRef.current.querySelector("button:last-child");
        if (deleteButton) {
          gsap.to(deleteButton, {
            scale: 1.05,
            duration: 0.3,
            repeat: 3,
            yoyo: true,
            ease: "power2.inOut",
          });
        }
      }
      setTimeout(() => setConfirmDelete(false), 10000);
    }
  };

  const handleDuplicate = async () => {
    try {
      setLoading(true);

      await invoke("copy_profile", {
        params: {
          source_profile_id: profile.id,
          new_profile_name: `${profile.name} (copy)`,
          include_files: undefined,
        },
      });

      toast.success("Profile cloned successfully!");
    } catch (err) {
      console.error("Failed to clone profile:", err);
      toast.error(
        `Failed to clone profile: ${err instanceof Error ? err.message : String(err.message)}`,
      );
    } finally {
      setLoading(false);
    }
  };

  const noriskPackOptions = Object.entries(noriskPacks).map(
    ([packId, packDef]) => ({
      value: packId,
      label: `${packDef.displayName} ${packDef.isExperimental ? "(experimental)" : ""}`,
    }),
  );

  return (
    <div ref={tabRef} className="space-y-6 select-none">
      <div ref={formRef} className="space-y-6">
        <div>
          <label className="block text-3xl font-minecraft text-white mb-2 lowercase">
            profile name
          </label>
          <Input
            value={editedProfile.name}
            onChange={(e) => updateProfile({ name: e.target.value })}
            placeholder="Enter profile name"
            className="text-2xl py-3"
            variant="flat"
          />
        </div>

        <div>
          <label className="block text-3xl font-minecraft text-white mb-2 lowercase">
            group
          </label>
          <Input
            value={editedProfile.group || ""}
            onChange={(e) => updateProfile({ group: e.target.value || null })}
            placeholder="e.g. modpacks, vanilla+"
            className="text-2xl py-3"
            variant="flat"
          />
        </div>

        <div>
          <label className="block text-3xl font-minecraft text-white mb-2 lowercase">
            norisk client pack
          </label>
          {loading ? (
            <div className="flex items-center justify-center p-4 text-white">
              <Icon
                icon="solar:refresh-bold"
                className="w-6 h-6 mr-2 animate-spin"
              />
              <span className="font-minecraft text-2xl">
                loading norisk packs...
              </span>
            </div>
          ) : (
            <>
              <Select
                value={editedProfile.selected_norisk_pack_id || ""}
                onChange={(value) =>
                  updateProfile({
                    selected_norisk_pack_id: value === "" ? null : value,
                  })
                }
                options={[{ value: "", label: "none" }, ...noriskPackOptions]}
                className="text-2xl py-3"
                variant="flat"
              />
              {editedProfile.selected_norisk_pack_id &&
                noriskPacks[editedProfile.selected_norisk_pack_id] && (
                  <p className="text-xs text-white/70 mt-2 font-minecraft-ten tracking-wide select-none">
                    {
                      noriskPacks[editedProfile.selected_norisk_pack_id]
                        .description
                    }
                  </p>
                )}
            </>
          )}
        </div>
      </div>

      <Card
        ref={actionsRef}
        variant="flat"
        className="mt-6 p-4 border border-white/10 bg-black/20"
      >
        <div className="flex flex-wrap gap-4">
          <div className="flex-1 min-w-[250px] flex flex-col justify-between">
            <div>
              <h3 className="text-3xl font-minecraft text-white mb-2 lowercase">
                duplicate instance
              </h3>
              <p className="text-xs text-white/70 mb-3 font-minecraft-ten tracking-wide select-none">
                creates a copy of this instance, including worlds, configs,
                mods, etc.
              </p>
            </div>
            <Button
              onClick={handleDuplicate}
              disabled={loading}
              variant="secondary"
              icon={
                <Icon icon="solar:copy-bold" className="w-5 h-5 text-white" />
              }
              size="md"
              className="text-2xl"
            >
              {loading ? (
                <>
                  <Icon
                    icon="solar:refresh-bold"
                    className="w-5 h-5 animate-spin text-white"
                  />
                  <span>duplicating...</span>
                </>
              ) : (
                "duplicate"
              )}
            </Button>
          </div>

          <div className="flex-1 min-w-[250px] flex flex-col justify-between">
            <div>
              <h3 className="text-3xl font-minecraft text-white mb-2 lowercase">
                delete instance
              </h3>
              <p className="text-xs text-white/70 mb-3 font-minecraft-ten tracking-wide select-none">
                permanently deletes this instance from your device, including
                your worlds, configs, and all installed content.
              </p>
            </div>
            <Button
              onClick={handleDelete}
              variant="destructive"
              disabled={isDeleting || loading}
              icon={
                isDeleting ? (
                  <Icon
                    icon="solar:refresh-bold"
                    className="w-5 h-5 animate-spin text-white"
                  />
                ) : (
                  <Icon
                    icon="solar:trash-bin-trash-bold"
                    className="w-5 h-5 text-white"
                  />
                )
              }
              size="md"
              className="text-2xl"
            >
              {isDeleting
                ? "deleting..."
                : confirmDelete
                  ? "confirm delete"
                  : "delete instance"}
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}
