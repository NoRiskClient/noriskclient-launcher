"use client";

import type React from "react";
import { useCallback, useState } from "react";
import type { ModrinthFile, ModrinthVersion } from "../types/modrinth";
import type { CheckContentParams, Profile } from "../types/profile";
import {
  addModrinthContentToProfile,
  addModrinthModToProfile,
  isContentInstalled,
} from "../services/profile-service";
import { ModrinthService } from "../services/modrinth-service";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { EventType, type EventPayload } from "../types/events";
import { toast } from "react-hot-toast";
import { ProgressToast } from "../components/ui/ProgressToast";

interface PendingInstall {
  version: ModrinthVersion;
  file: ModrinthFile;
}

export function useModrinthInstaller(
  profiles: Profile[],
  selectedProfileId: string | null = null,
  onInstallSuccess?: () => void,
) {
  const [installState, setInstallState] = useState<
    Record<string, "idle" | "installing" | "success" | "error" | "adding">
  >({});
  const [error, setError] = useState<string | null>(null);
  const [showProfilePopup, setShowProfilePopup] = useState(false);
  const [pendingInstall, setPendingInstall] = useState<PendingInstall | null>(
    null,
  );
  const [installedVersions, setInstalledVersions] = useState<
    Record<string, boolean>
  >({});
  const [checkingInstalled, setCheckingInstalled] = useState(false);

  const directInstallToProfile = useCallback(
    async (version: ModrinthVersion, file: ModrinthFile, profileId: string) => {
      const versionId = version.id;

      try {
        const profileExists = profiles.some((p) => p.id === profileId);
        if (!profileExists) {
          throw new Error(
            `Profile with ID ${profileId} not found. Please select a different profile.`,
          );
        }

        setInstallState((prev) => ({ ...prev, [versionId]: "installing" }));

        const projectType = version.search_hit?.project_type || "mod";

        if (projectType === "mod") {
          await addModrinthModToProfile(
            profileId,
            version.project_id,
            version.id,
            file.filename,
            file.url,
            file.hashes?.sha1,
            version.search_hit?.title || version.name,
            version.version_number,
            version.loaders,
            version.game_versions,
          );
        } else {
          await addModrinthContentToProfile(
            profileId,
            version.project_id,
            version.id,
            file.filename,
            file.url,
            file.hashes?.sha1,
            version.search_hit?.title || version.name,
            version.version_number,
            projectType,
          );
        }

        setInstallState((prev) => ({ ...prev, [versionId]: "success" }));

        setInstalledVersions((prev) => ({
          ...prev,
          [versionId]: true,
        }));

        if (onInstallSuccess) {
          onInstallSuccess();
        }

        return true;
      } catch (err) {
        console.error("❌ Failed to install content:", err);
        setInstallState((prev) => ({ ...prev, [versionId]: "error" }));
        setError(
          `Failed to install: ${err instanceof Error ? err.message : String(err)}`,
        );
        throw err;
      }
    },
    [
      profiles,
      setInstallState,
      setInstalledVersions,
      setError,
      onInstallSuccess,
    ],
  );

  const installToProfile = useCallback(
    async (version: ModrinthVersion, file: ModrinthFile, profileId: string) => {
      const versionId = version.id;

      try {
        const profileExists = profiles.some((p) => p.id === profileId);
        if (!profileExists) {
          throw new Error(
            `Profile with ID ${profileId} not found. Please select a different profile.`,
          );
        }

        setInstallState((prev) => ({ ...prev, [versionId]: "installing" }));

        const projectType = version.search_hit?.project_type || "mod";

        if (projectType === "mod") {
          await addModrinthModToProfile(
            profileId,
            version.project_id,
            version.id,
            file.filename,
            file.url,
            file.hashes?.sha1,
            version.search_hit?.title || version.name,
            version.version_number,
            version.loaders,
            version.game_versions,
          );
        } else {
          await addModrinthContentToProfile(
            profileId,
            version.project_id,
            version.id,
            file.filename,
            file.url,
            file.hashes?.sha1,
            version.search_hit?.title || version.name,
            version.version_number,
            projectType,
          );
        }

        setInstallState((prev) => ({ ...prev, [versionId]: "success" }));

        setInstalledVersions((prev) => ({
          ...prev,
          [versionId]: true,
        }));

        if (onInstallSuccess) {
          onInstallSuccess();
        }

        return true;
      } catch (err) {
        console.error("❌ Failed to install content:", err);
        setInstallState((prev) => ({ ...prev, [versionId]: "error" }));
        setError(
          `Failed to install: ${err instanceof Error ? err.message : String(err)}`,
        );
        throw err;
      }
    },
    [
      profiles,
      setInstallState,
      setInstalledVersions,
      setError,
      onInstallSuccess,
    ],
  );

  const resetError = () => {
    if (error) {
      setError(null);
    }
  };

  const isContentCompatibleWithProfile = (
    version: ModrinthVersion,
    profile: Profile,
  ): boolean => {
    if (version.game_versions && version.game_versions.length > 0) {
      if (!version.game_versions.includes(profile.game_version)) {
        return false;
      }
    }

    if (
      version.search_hit?.project_type === "mod" ||
      version.search_hit?.project_type === "modpack"
    ) {
      if (version.loaders && version.loaders.length > 0) {
        if (!version.loaders.includes(profile.loader)) {
          return false;
        }
      }
    }

    return true;
  };

  const checkIfContentIsInstalled = async (
    version: ModrinthVersion,
    profileId: string,
  ) => {
    if (!version.project_id || !version.id) return false;

    try {
      const params: CheckContentParams = {
        project_id: version.project_id,
        version_id: version.id,
        project_type: version.search_hit?.project_type || "mod",
        profile_id: profileId,
      };

      const status = await isContentInstalled(params);
      return status.is_installed;
    } catch (error) {
      console.error("Error checking if content is installed:", error);
      return false;
    }
  };

  const checkInstallationStatus = async (
    versions: ModrinthVersion[],
    profileId: string,
  ) => {
    if (!profileId || versions.length === 0) return;

    setCheckingInstalled(true);
    const installedStatus: Record<string, boolean> = {};
    const newInstallState: Record<
      string,
      "idle" | "installing" | "success" | "error" | "adding"
    > = { ...installState };

    try {
      const batchSize = 5;
      for (let i = 0; i < versions.length; i += batchSize) {
        const batch = versions.slice(i, i + batchSize);
        const batchPromises = batch.map(async (version) => {
          const installed = await checkIfContentIsInstalled(version, profileId);
          installedStatus[version.id] = installed;

          if (installed) {
            newInstallState[version.id] = "success";
          }
        });

        await Promise.all(batchPromises);
      }

      setInstalledVersions(installedStatus);
      setInstallState(newInstallState);
    } catch (error) {
      console.error("Error checking installation status:", error);
    } finally {
      setCheckingInstalled(false);
    }
  };

  const installModpack = useCallback(
    async (version: ModrinthVersion, file: ModrinthFile) => {
      const versionId = version.id;
      const eventId = crypto.randomUUID();
      const toastId = `install-${eventId}`;
      let progressUnlisten: UnlistenFn | null = null;

      setInstallState((prev) => ({ ...prev, [versionId]: "adding" }));
      setError(null);

      try {
        const hit = version.search_hit;
        if (!hit) {
          throw new Error("Missing search hit context");
        }

        const fileName = file.filename || hit.title || "modpack";

        // Set up event listener for progress updates
        progressUnlisten = await listen<EventPayload>("state_event", (progressEvent) => {
          const progressPayload = progressEvent.payload;
          if (progressPayload.event_type !== EventType.TaskProgress) return;
          if (progressPayload.event_id !== eventId) return;

          const progress = (progressPayload.progress ?? 0) * 100; // Convert 0-1 to 0-100

          // Update toast with progress
          toast.custom(
            () => <ProgressToast message={`Installing ${fileName}`} progress={progress} />,
            { id: toastId, duration: Infinity }
          );
        });

        // Show initial progress toast
        toast.custom(
          () => <ProgressToast message={`Installing ${fileName}`} progress={0} />,
          { id: toastId, duration: Infinity }
        );

        const newProfileId = await ModrinthService.downloadAndInstallModpack(
          version.project_id,
          version.id,
          file.filename,
          file.url,
          undefined, // iconUrl
          file.size,
          eventId,
        );

        // Clean up listener before showing success
        if (progressUnlisten) {
          progressUnlisten();
          progressUnlisten = null;
        }

        toast.success(`${fileName} installed successfully!`, { id: toastId, duration: 3000 });

        setInstallState((prev) => ({ ...prev, [versionId]: "success" }));

        if (onInstallSuccess) {
          onInstallSuccess();
        }

        setTimeout(() => {
          setInstallState((prev) => ({ ...prev, [versionId]: "idle" }));
        }, 2000);

        return newProfileId;
      } catch (err) {
        console.error("❌ Failed to install modpack:", err);
        const errorMessage = err instanceof Error ? err.message : String(err);
        setError(`Failed to install: ${errorMessage}`);
        setInstallState((prev) => ({ ...prev, [versionId]: "error" }));

        toast.error(`Failed to install: ${errorMessage}`, { id: toastId });

        setTimeout(() => {
          setInstallState((prev) => {
            if (prev[versionId] === "error") {
              const newState = { ...prev };
              newState[versionId] = "idle";
              return newState;
            }
            return prev;
          });
          setError(null);
        }, 5000);

        throw err;
      } finally {
        // Clean up listener
        if (progressUnlisten) {
          progressUnlisten();
        }
      }
    },
    [onInstallSuccess],
  );

  const handleContentInstall = useCallback(
    (
      version: ModrinthVersion,
      file: ModrinthFile,
      event?: React.SyntheticEvent,
    ) => {
      // Prevent default behavior that might cause page refresh
      event?.preventDefault?.();

      try {
        if (version.search_hit?.project_type === "modpack") {
          installModpack(version, file);
          return;
        }

        if (selectedProfileId) {
          directInstallToProfile(version, file, selectedProfileId);
          return;
        }

        if (!profiles || profiles.length === 0) {
          setError(
            "Installation error: No profiles available. Please create a profile first.",
          );
          return;
        }

        if (profiles.length === 1) {
          installToProfile(version, file, profiles[0].id);
          return;
        }

        setPendingInstall({ version, file });
        setShowProfilePopup(true);
      } catch (error) {
        setError(
          `Installation error: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    },
    [
      selectedProfileId,
      profiles,
      directInstallToProfile,
      installToProfile,
      installModpack,
      setError,
    ],
  );

  const handleProfileSelect = async (
    profileId: string,
    event?: React.SyntheticEvent,
  ) => {
    // Prevent default behavior that might cause page refresh
    event?.preventDefault?.();

    if (!pendingInstall) return;

    try {
      await directInstallToProfile(
        pendingInstall.version,
        pendingInstall.file,
        profileId,
      );

      // Only close the popup after successful installation
      setShowProfilePopup(false);
      setPendingInstall(null);
    } catch (error) {
      console.error("Error during installation:", error);
      // Keep popup open on error so user can try again or cancel
    }
  };

  return {
    installState,
    error,
    installToProfile: directInstallToProfile,
    installModpack,
    showProfilePopup,
    setShowProfilePopup,
    pendingInstall,
    setPendingInstall,
    handleProfileSelect,
    handleContentInstall,
    resetError,
    isContentCompatibleWithProfile,
    installedVersions,
    checkingInstalled,
    checkInstallationStatus,
  };
}
