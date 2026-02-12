"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useParams, useNavigate } from "react-router-dom";
import type { Profile } from "../../../types/profile";
import { useThemeStore } from "../../../store/useThemeStore";
import { useDisplayContextStore } from "../../../store/useDisplayContextStore";
import { Icon } from "@iconify/react";
import { Card } from "../../ui/Card";
import { ModrinthSearchV2 } from "../../modrinth/v2/ModrinthSearchV2";
import { ProfileIconV2 } from "../ProfileIconV2";
import { ActionButtons, type ActionButton } from "../../ui/ActionButtons";
import * as ProfileService from "../../../services/profile-service";
import type { ModrinthProjectType } from "../../../types/modrinth";

interface BrowseTabProps {
  profile?: Profile;
  initialContentType?: string;
  onRefresh?: () => void;
  parentTransitionActive?: boolean;
}

export function BrowseTab({
  profile: initialProfile,
  initialContentType: initialContentTypeFromProp = "mods",
  onRefresh,
  parentTransitionActive,
}: BrowseTabProps) {
  const { t } = useTranslation();
  const { profileId, contentType: contentTypeFromUrl } = useParams<{ profileId: string; contentType: string }>();
  const navigate = useNavigate();
  const accentColor = useThemeStore((state) => state.accentColor);
  const setDisplayContext = useDisplayContextStore((state) => state.setContext);
  const containerRef = useRef<HTMLDivElement>(null);

  const [currentProfile, setCurrentProfile] = useState<Profile | undefined | null>(initialProfile);
  const [isLoading, setIsLoading] = useState<boolean>(!initialProfile && !!profileId);
  const [error, setError] = useState<string | null>(null);

  const activeContentType = contentTypeFromUrl || initialContentTypeFromProp;

  useEffect(() => {
    setDisplayContext("detail");
    return () => {
      setDisplayContext("standalone");
    };
  }, [setDisplayContext]);

  useEffect(() => {
    if (profileId && !initialProfile) {
      setIsLoading(true);
      setError(null);
      ProfileService.getProfile(profileId)
        .then(fetchedProfile => {
          setCurrentProfile(fetchedProfile);
        })
        .catch(err => {
          console.error(`Failed to fetch profile ${profileId}:`, err);
          setError(`Failed to load profile: ${err instanceof Error ? err.message : String(err)}`);
          setCurrentProfile(null);
        })
        .finally(() => {
          setIsLoading(false);
        });
    } else if (initialProfile) {
      setCurrentProfile(initialProfile);
      setIsLoading(false);
    }
  }, [profileId, initialProfile]);

  const getProjectType = () => {
    switch (activeContentType) {
      case "mods":
      case "mod":
        return "mod";
      case "resourcepacks":
      case "resourcepack":
        return "resourcepack";
      case "shaderpacks":
      case "shaderpack":
      case "shader":
        return "shader";
      case "datapacks":
      case "datapack":
        return "datapack";
      default:
        return "mod";
    }
  };



  // Get mod loader icon
  const getModLoaderIcon = () => {
    if (!currentProfile) return "/icons/minecraft.png";
    switch (currentProfile.loader) {
      case "fabric":
        return "/icons/fabric.png";
      case "forge":
        return "/icons/forge.png";
      case "quilt":
        return "/icons/quilt.png";
      case "neoforge":
        return "/icons/neoforge.png";
      default:
        return "/icons/minecraft.png";
    }
  };

  // Handle back navigation
  const handleBack = () => {
    if (profileId) {
      navigate(`/profilesv2/${profileId}`);
    } else {
      navigate("/profiles");
    }
  };

  // Action buttons configuration
  const actionButtons: ActionButton[] = [
    {
      id: "back",
      label: t('common.back'),
      icon: "solar:arrow-left-bold",
      tooltip: t('profiles.back_to_profile'),
      onClick: handleBack,
    },
  ];

  if (isLoading) {
    return (
      <div className="h-full flex flex-col items-center justify-center p-4 gap-6">
        <Icon icon="eos-icons:loading" className="w-16 h-16 text-[var(--accent)]" />
        <p className="text-white/70 font-minecraft text-lg">{t('profiles.loading_profile_data')}</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="h-full flex flex-col p-4 gap-6">
        <Card variant="flat" className="p-4 border-red-500 bg-red-900/30">
          <div className="flex items-center gap-2">
            <Icon icon="solar:danger-triangle-bold" className="w-6 h-6 text-red-400" />
            <span className="text-white font-minecraft text-lg">{t('common.error')}</span>
          </div>
          <p className="text-red-300 font-minecraft mt-2 text-sm">{error}</p>
        </Card>
      </div>
    );
  }

  if (!currentProfile || !currentProfile.id) {
    return (
      <div className="h-full flex flex-col p-4 gap-6">
        <Card variant="flat" className="p-4 border-orange-500 bg-orange-900/30">
          <div className="flex items-center gap-2">
            <Icon icon="solar:question-circle-bold" className="w-6 h-6 text-orange-400" />
            <span className="text-white font-minecraft text-lg">
              {t('mod_detail.project_not_found')}
            </span>
          </div>
           <p className="text-orange-300 font-minecraft mt-2 text-sm">
            {t('profiles.errors.profile_not_found', { id: profileId || t('common.not_available') })}
          </p>
        </Card>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="h-full flex flex-col overflow-hidden p-4 relative">
      <div className={`flex-1 ${false ? "flex flex-col min-h-0" : "overflow-y-auto no-scrollbar"}`}>
        {/* Profile Header Section */}
        <div className="mb-1 flex-shrink-0">
          <div className="flex items-center gap-4 mb-4">
            {/* Profile Icon */}
            <div className="relative">
              <ProfileIconV2
                profile={currentProfile}
                size="lg"
                className="w-16 h-16"
              />
            </div>

            {/* Profile Details */}
            <div className="flex flex-col gap-2 flex-1">
              {/* Profile Name */}
              <h1 className="font-minecraft-ten text-2xl text-white normal-case">
                {currentProfile.name || currentProfile.id}
              </h1>

              {/* Game Info */}
              <div className="flex items-center gap-3 text-sm font-minecraft-ten">
                {/* Minecraft Version */}
                <div className="text-white/70 flex items-center gap-2">
                  <img
                    src="/icons/minecraft.png"
                    alt="Minecraft"
                    className="w-4 h-4 object-contain"
                  />
                  <span>{currentProfile.game_version}</span>
                </div>

                {/* Loader Info (if not vanilla) */}
                {currentProfile.loader && currentProfile.loader !== "vanilla" && (
                  <>
                    <div className="w-px h-4 bg-white/30"></div>
                    <div className="text-white/60 flex items-center gap-2">
                      <img
                        src={getModLoaderIcon()}
                        alt={currentProfile.loader}
                        className="w-4 h-4 object-contain"
                        onError={(e) => {
                          e.currentTarget.src = "/icons/minecraft.png";
                        }}
                      />
                      <span className="capitalize">{currentProfile.loader}</span>
                      {currentProfile.loader_version && (
                        <span className="text-white/50">
                          {currentProfile.loader_version}
                        </span>
                      )}
                    </div>
                  </>
                )}

                {/* Profile Group (if exists) */}
                {currentProfile.group && (
                  <>
                    <div className="w-px h-4 bg-white/30"></div>
                    <div className="text-white/50 flex items-center gap-1">
                      <Icon icon="solar:folder-bold" className="w-3 h-3" />
                      <span className="uppercase text-xs tracking-wide">
                        {currentProfile.group}
                      </span>
                    </div>
                  </>
                )}
              </div>
            </div>

            {/* Action Buttons - Right side of the header row */}
            <div className="flex items-center gap-3">
              <ActionButtons actions={actionButtons} />
            </div>
          </div>

          {/* Divider under profile info */}
          <div className="h-px w-full bg-white/10 mt-4 mb-4" />
        </div>

        {/* Content Area */}
        <div className="flex-1 min-h-0">
          <ModrinthSearchV2
            profiles={[currentProfile]}
            selectedProfileId={currentProfile.id}
            initialProjectType={getProjectType() as ModrinthProjectType}
            allowedProjectTypes={["mod", "resourcepack", "shader", "datapack"]}
            className="h-full"
            initialSidebarVisible={false}
            overrideDisplayContext="detail"
            disableVirtualization={true}
          />
        </div>
      </div>
    </div>
  );
}
