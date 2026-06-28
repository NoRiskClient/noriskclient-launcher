"use client";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Icon } from "@iconify/react";
import { cn } from "../../lib/utils";
import * as ProfileService from "../../services/profile-service";
import { Button } from "../ui/buttons/Button";
import { useThemeStore } from "../../store/useThemeStore";
import {
  LaunchState,
  useLaunchStateStore,
} from "../../store/launch-state-store";
import { useProfileStore } from "../../store/profile-store";
import { useNavigate } from "react-router-dom";

interface VersionInfoProps {
  profileId: string;
  className?: string;
}

export function VersionInfo({ profileId, className }: VersionInfoProps) {
  const { t } = useTranslation();
  const [profile, setProfile] = useState<any>(null);
  const [profileLoading, setProfileLoading] = useState(true);
  const [profileError, setProfileError] = useState<string | null>(null);
  const { accentColor } = useThemeStore();

  const { initializeProfile, getProfileState } = useLaunchStateStore();
  const { launchState } = getProfileState(profileId || "");

  const { loading: initialDataLoading, error: initialDataError } = useProfileStore();
  const navigate = useNavigate();

  useEffect(() => {
    const loadProfile = async () => {
      if (!profileId) {
        setProfileLoading(false);
        setProfile(null);
        return;
      }

      if (initialDataLoading) return;

      try {
        setProfileLoading(true);
        const profileData = await ProfileService.getProfile(profileId);
        setProfile(profileData);
        setProfileError(null);

        initializeProfile(profileId);
      } catch (err) {
        console.error(`Error loading profile ${profileId}:`, err);
        setProfileError("Failed to load profile details");
        setProfile(null);
      } finally {
        setProfileLoading(false);
      }
    };

    loadProfile();
  }, [profileId, initializeProfile, initialDataLoading]);

  const handleNavigateToProfiles = () => {
    if (profile && !profile.is_standard_version) {
      navigate(`/profilesv2/${profile.id}`);
    } else {
      // For standard profiles or if profile data isn't fully loaded,
      // navigating to /profiles is a safe fallback.
      // ProfilesTab will handle toast notifications for standard profiles.
      navigate("/profiles");
    }
  };

  if (initialDataLoading) {
    return (
      <Button
        variant="default"
        size="md"
        disabled
        icon={ <Icon icon="pixel:spinner-solid" className="w-4 h-4 animate-spin" /> }
        className={cn("font-minecraft", className)}
      >
        Loading initial data...
      </Button>
    );
  }
  
  if (initialDataError && !initialDataLoading) {
    return (
      <Button
        variant="destructive"
        size="md"
        disabled
        icon={ <Icon icon="pixel:exclamation-triangle-solid" className="w-4 h-4" /> }
        className={cn("font-minecraft", className)}
      >
        {t('empty_states.error_loading_data')}
      </Button>
    );
  }

  if (!profileId && !initialDataLoading) {
    return (
      <Button
        variant="default"
        size="md"
        disabled
        icon={
          <Icon icon="pixel:exclamation-triangle-solid" className="w-4 h-4" />
        }
        className={cn("font-minecraft", className)}
      >
        No profile selected
      </Button>
    );
  }

  if (profileLoading && !initialDataLoading) {
    return (
      <Button
        variant="default"
        size="md"
        disabled
        icon={ <Icon icon="pixel:spinner-solid" className="w-4 h-4 animate-spin" /> }
        className={cn("font-minecraft", className)}
      >
        Loading profile...
      </Button>
    );
  }

  if ((profileError || !profile) && !initialDataLoading && !profileLoading) {
    return (
      <Button
        variant="destructive"
        size="md"
        disabled
        icon={
          <Icon icon="pixel:exclamation-triangle-solid" className="w-4 h-4" />
        }
        className={cn("font-minecraft", className)}
      >
        {profileError || "Profile details not found"}
      </Button>
    );
  }
  
  if (profile && !initialDataLoading && !profileLoading && !profileError) {
    const getModLoaderIcon = (loader: string) => {
      return `/icons/${loader.toLowerCase()}.png`;
    };

    const isLaunching = launchState === LaunchState.LAUNCHING;
    const variant = isLaunching ? "info" : "default";

    return (
      <Button
        variant={variant}
        size="md"
        disabled={isLaunching}
        onClick={!isLaunching ? handleNavigateToProfiles : undefined}
        icon={
          <img
            src={getModLoaderIcon(profile.loader) || "/placeholder.svg"}
            alt={`${profile.loader} icon`}
            className="w-5 h-5"
            onError={(e) => {
              (e.target as HTMLImageElement).src = "/icons/minecraft.png";
            }}
          />
        }
        className={cn("font-minecraft", !isLaunching && "cursor-pointer", className)}
        title={!isLaunching ? "Go to Profiles Tab" : undefined}
      >
        {profile.name} ({profile.game_version})
        {isLaunching && (
          <Icon
            icon="pixel:spinner-solid"
            className="w-4 h-4 ml-2 text-red-400 animate-spin"
          />
        )}
      </Button>
    );
  }
  
  return null;
}
