"use client";

import { useCallback, useEffect, useMemo } from "react";
import { ModrinthSearchV2 } from "../modrinth/v2/ModrinthSearchV2";
import type { Profile } from "../../types/profile";
import { useProfileStore } from "../../store/profile-store";
import { ErrorMessage } from "../ui/ErrorMessage";
import { setDiscordState } from "../../utils/discordRpc";

interface ModrinthTabV2Props {
  profiles?: Profile[];
}

export function ModrinthTabV2({
  profiles: initialProfiles = [],
}: ModrinthTabV2Props) {
  const {
    profiles: storeProfiles,
    loading,
    error,
    fetchProfiles,
  } = useProfileStore();

  const profiles = initialProfiles.length > 0 ? initialProfiles : storeProfiles;

  useEffect(() => { setDiscordState("Browsing Mods"); }, []);

  useEffect(() => {
    if (initialProfiles.length === 0 && storeProfiles.length === 0 && !loading) {
      fetchProfiles();
    }
  }, [initialProfiles.length, storeProfiles.length, loading, fetchProfiles]);

  const handleInstallSuccess = useCallback(() => {}, []);

  const memoizedSearch = useMemo(
    () => (
      <ModrinthSearchV2
        profiles={profiles}
        onInstallSuccess={handleInstallSuccess}
        className="h-full"
      />
    ),
    [profiles, handleInstallSuccess],
  );

  return (
    <div className="h-full flex flex-col overflow-hidden p-4 relative">
      {error && <ErrorMessage message={error} />}

      <div className="flex-1 overflow-hidden flex space-x-4">
        <div className="flex-1 overflow-hidden">{memoizedSearch}</div>
      </div>
    </div>
  );
}

export default ModrinthTabV2;
