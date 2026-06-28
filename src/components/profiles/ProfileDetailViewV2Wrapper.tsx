"use client";

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useParams, useNavigate } from "react-router-dom";
import { useProfileStore } from "../../store/profile-store";
import { LoadingState } from "../ui/LoadingState";
import { EmptyState } from "../ui/EmptyState";
import { ProfileDetailViewV2 } from "./ProfileDetailViewV2";
import { ProfileDetailViewV3 } from "./v3/ProfileDetailViewV3";
import type { Profile } from "../../types/profile";

// Toggle zwischen altem (V2) und neuem (V3) Redesign. Auf false setzen fuer Rollback.
const USE_V3 = true;
import { useProfileSettingsStore } from "../../store/profile-settings-store";

export function ProfileDetailViewV2Wrapper() {
  const { t } = useTranslation();
  const { profileId } = useParams<{ profileId: string }>();
  const navigate = useNavigate();
  const { profiles, loading, fetchProfiles } = useProfileStore();
  const [profile, setProfile] = useState<Profile | null>(null);

  // Profile settings store for edit modal
  const { openModal } = useProfileSettingsStore();

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

  const handleClose = () => {
    navigate("/profiles");
  };

  const handleEdit = () => {
    if (profile) {
      openModal(profile);
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

  const Component = USE_V3 ? ProfileDetailViewV3 : ProfileDetailViewV2;
  return (
    <Component
      profile={profile}
      onClose={handleClose}
      onEdit={handleEdit}
    />
  );
}
