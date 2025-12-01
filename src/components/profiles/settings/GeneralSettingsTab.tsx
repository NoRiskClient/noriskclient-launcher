"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "@iconify/react";
import type { Profile } from "../../../types/profile";
import { useThemeStore } from "../../../store/useThemeStore";
import { SearchStyleInput } from "../../ui/Input";
import { Checkbox } from "../../ui/Checkbox";
import { gsap } from "gsap";
import { ProfileIcon } from "../ProfileIcon";
import { useMinecraftAuthStore } from "../../../store/minecraft-auth-store";
import { useCrafatarAvatar } from "../../../hooks/useCrafatarAvatar";
import type { MinecraftAccount } from "../../../types/minecraft";
import { cn } from "../../../lib/utils";

interface GeneralSettingsTabProps {
  profile: Profile;
  editedProfile: Profile;
  updateProfile: (updates: Partial<Profile>) => void;
  onRefresh?: () => Promise<Profile>;
  onDelete?: () => void;
  isDeleting?: boolean;
}



export function GeneralSettingsTab({
  profile,
  editedProfile,
  updateProfile,
  onRefresh,
  onDelete,
  isDeleting,
}: GeneralSettingsTabProps) {
  const accentColor = useThemeStore((state) => state.accentColor);
  const isBackgroundAnimationEnabled = useThemeStore(
    (state) => state.isBackgroundAnimationEnabled,
  );
  const tabRef = useRef<HTMLDivElement>(null);
  const formRef = useRef<HTMLDivElement>(null);
  const accountRef = useRef<HTMLDivElement>(null);
  const { accounts } = useMinecraftAuthStore();

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


    }
  }, [isBackgroundAnimationEnabled]);

  // Component for account avatar with caching
  function AccountAvatar({ account }: { account: MinecraftAccount }) {
    const avatarUrl = useCrafatarAvatar({
      uuid: account.id,
      overlay: true,
    });

    if (!avatarUrl) {
      return null;
    }

    return (
      <img
        src={avatarUrl}
        alt={account.username}
        className="w-full h-full object-cover pixelated"
        style={{ imageRendering: 'pixelated' }}
        onError={(e) => {
          // Fallback to default Steve head
          e.currentTarget.src = 'https://crafatar.com/avatars/8667ba71b85a4004af54457a9734eed7?overlay=true';
        }}
      />
    );
  }

  const handleAccountSelect = (accountId: string | null) => {
    updateProfile({ preferred_account_id: accountId });
  };

  return (
    <div ref={tabRef} className="space-y-6 select-none">
      <div ref={formRef} className="space-y-6">
        <div className="flex gap-6">
          <div className="flex-1 flex flex-col">
            <label className="block text-3xl font-minecraft text-white mb-2 lowercase">
              profile name
            </label>
            <div className="flex items-center gap-4">
              <ProfileIcon
                profileId={profile.id}
                banner={profile.banner}
                profileName={profile.name}
                accentColor={accentColor.value}
                onSuccessfulUpdate={async () => {
                  try {
                    if (onRefresh) {
                      await onRefresh();
                    }
                  } catch (error) {
                    console.error("Failed to refresh profile after icon update:", error);
                  }
                }}
                className="w-12 h-12 flex-shrink-0"
              />
              <SearchStyleInput
                value={editedProfile.name}
                onChange={(e) => updateProfile({ name: e.target.value })}
                placeholder="Enter profile name"
                className="text-xl flex-1"
                disabled={profile.is_standard_version ? true : false}
              />
            </div>
          </div>

          <div className="flex-1 flex flex-col">
            <label className="block text-3xl font-minecraft text-white mb-2 lowercase">
              group
            </label>
            <div className="flex items-center">
              <SearchStyleInput
                value={editedProfile.group || ""}
                onChange={(e) => updateProfile({ group: e.target.value || null })}
                placeholder="e.g. modpacks, vanilla+"
                className="text-xl w-full"
                disabled={profile.is_standard_version ? true : false}
              />
            </div>
          </div>
        </div>

        {/* Shared Minecraft Folder Checkbox */}
        <div className="space-y-1">
          <Checkbox
            label="Use shared Minecraft folder"
            checked={editedProfile.use_shared_minecraft_folder ?? false}
            onChange={(event) => {
              const newValue = event.target.checked;
              updateProfile({
                use_shared_minecraft_folder: newValue
              });
            }}
            description="When enabled, a shared Minecraft folder will be used based on the group. Your settings, worlds, configs and resource packs will remain the same between profiles."
            descriptionClassName="font-minecraft-ten text-sm"
            size="lg"
          />
          <p className="text-xs text-white/50 font-minecraft-ten ml-10 -mt-1">
            (you can change this anytime)
          </p>
        </div>

        <div>
          <label className="block text-3xl font-minecraft text-white mb-2 lowercase">
            quick play path
          </label>
          <SearchStyleInput
            value={editedProfile.settings.quick_play_path || ""}
            onChange={(e) =>
              updateProfile({
                settings: {
                  ...editedProfile.settings,
                  quick_play_path: e.target.value || null
                }
              })
            }
            placeholder="World name or server address (e.g. MyWorld or hypixel.net)"
            className="text-xl"
          />
          <p className="text-xs text-white/70 mt-2 font-minecraft-ten tracking-wide select-none">
            Enter a world name for singleplayer or server address for multiplayer.
            Server addresses are detected by containing a dot (e.g. hypixel.net).
          </p>
        </div>

        <div ref={accountRef} className="space-y-3">
          <h3 className="text-3xl font-minecraft text-white lowercase">
            preferred launch account
          </h3>
          
          {accounts.length > 0 ? (
            <div className="flex flex-wrap gap-3 p-1">
              {accounts.map((account) => {
                const isSelected = editedProfile.preferred_account_id === account.id;
                
                return (
                  <button
                    key={account.id}
                    onClick={() => handleAccountSelect(isSelected ? null : account.id)}
                    className={cn(
                      "relative group flex flex-col items-center p-3 border-2 transition-all duration-200 rounded-lg hover:scale-105",
                      isSelected
                        ? "border-accent shadow-lg"
                        : "border-white/10 hover:border-white/30",
                    )}
                    style={
                      isSelected
                        ? {
                            borderColor: accentColor.value,
                            backgroundColor: `${accentColor.value}15`,
                          }
                        : {}
                    }
                    title={`${account.username} (${account.id})`}
                  >
                    {/* Player Head */}
                    <div className={cn(
                      "relative w-16 h-16 rounded-md overflow-hidden border-2 transition-all duration-200",
                      isSelected ? "border-accent" : "border-white/20"
                    )}
                    style={isSelected ? { borderColor: accentColor.value } : {}}>
                      <AccountAvatar account={account} />
                      {isSelected && (
                        <div 
                          className="absolute inset-0 flex items-center justify-center bg-black/50"
                        >
                          <Icon
                            icon="solar:check-circle-bold"
                            className="w-8 h-8"
                            style={{ color: accentColor.value }}
                          />
                        </div>
                      )}
                    </div>
                    
                    {/* Username */}
                    <div className={cn(
                      "mt-2 font-minecraft text-xl lowercase text-center max-w-[100px] truncate",
                      isSelected ? "text-white" : "text-white/70"
                    )}>
                      {account.username}
                    </div>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="text-center py-4 text-white/50 font-minecraft text-lg lowercase">
              No accounts found
            </div>
          )}
        </div>

      </div>


    </div>
  );
}
