"use client";

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useParams, useNavigate } from "react-router-dom";
import { useProfileStore } from "../../store/profile-store";
import { LoadingState } from "../ui/LoadingState";
import { EmptyState } from "../ui/EmptyState";
import { BrowseTab } from "./detail/BrowseTab";
import type { Profile } from "../../types/profile";

export function BrowseTabWrapper() {
  const { t } = useTranslation();
  const { profileId, contentType } = useParams<{ profileId: string; contentType: string }>();
  const navigate = useNavigate();
  const { profiles, loading, fetchProfiles } = useProfileStore();
  const [profile, setProfile] = useState<Profile | null>(null);

  useEffect(() => {
    if (!profiles.length && !loading) {
      fetchProfiles();
    }
  }, [profiles.length, loading, fetchProfiles]);

  useEffect(() => {
    if (profileId && profiles.length > 0) {
      const foundProfile = profiles.find(p => p.id === profileId);
      setProfile(foundProfile || null);
    }
  }, [profileId, profiles]);

  const handleRefresh = () => {
    // Profile refresh logic could go here
    console.log("Refreshing profile data from BrowseTab");
  };

  const handleClose = () => {
    // Navigate back to the profile detail view
    if (profileId) {
      navigate(`/profilesv2/${profileId}`);
    } else {
      navigate("/profiles");
    }
  };

  if (loading) {
    return <LoadingState message={t('profiles.loading_profile')} />;
  }

  if (!profileId) {
    return (
      <EmptyState
        icon="solar:danger-triangle-bold"
        message={t('profiles.errors.no_profile_id')}
      />
    );
  }

  if (!profile) {
    return (
      <EmptyState
        icon="solar:widget-bold"
        message={t('profiles.errors.not_found')}
      />
    );
  }

  return (
    <BrowseTab
      profile={profile}
      initialContentType={contentType || "mods"}
      onRefresh={handleRefresh}
      parentTransitionActive={false}
    />
  );
}
