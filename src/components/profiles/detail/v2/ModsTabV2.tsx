"use client";

import { Icon } from "@iconify/react";
import { Button } from "../../../ui/buttons/Button";
import { IconButton } from "../../../ui/buttons/IconButton";
import { GenericListItem } from "../../../ui/GenericListItem";
import { TagBadge } from "../../../ui/TagBadge";
import { useThemeStore } from "../../../../store/useThemeStore";
import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { GenericContentTab } from "../../../ui/GenericContentTab";
import { preloadIcons } from "../../../../lib/icon-utils";
import type { Profile, Mod, ModSourceModrinth, ModSourceLocal, ModSourceUrl } from "../../../../types/profile"; // Import real types
import * as ProfileService from "../../../../services/profile-service"; // Import ProfileService
import { ModrinthService } from "../../../../services/modrinth-service"; // Import ModrinthService
import { SearchInput } from "../../../ui/SearchInput"; // Import SearchInput for manual placement
import { Checkbox } from "../../../ui/Checkbox"; // Import Checkbox component
import { invoke } from "@tauri-apps/api/core"; // Import invoke for Tauri calls
import type {
  ModrinthBulkUpdateRequestBody,
  ModrinthHashAlgorithm,
  ModrinthVersion,
} from "../../../../types/modrinth"; // Import Modrinth types
import { ConfirmDeleteDialog } from "../../../modals/ConfirmDeleteDialog"; // Import ConfirmDeleteDialog
import { GenericDetailListItem } from "../items/GenericDetailListItem"; // Import new component
import { toast } from 'react-hot-toast'; // Import toast
import { useTranslation } from 'react-i18next';
import { toggleContentFromProfile } from "../../../../services/content-service"; // Import toggleContentFromProfile
import type { ToggleContentPayload } from "../../../../types/content"; // Import ToggleContentPayload

// Icons specific to ModsTabV2
const MODS_TAB_ICONS_TO_PRELOAD = [
  "solar:box-bold-duotone", // Fallback icon, empty state
  "solar:settings-bold-duotone", // Mod settings button (placeholder)
  "solar:info-circle-bold-duotone", // Mod info button (placeholder)
  "solar:check-circle-bold", // Enabled status
  "solar:close-circle-bold", // Disabled status
  "material-symbols:folder-managed-outline", // Generic mod icon if no Modrinth icon
  "solar:folder-open-bold-duotone",
  "solar:trash-bin-trash-bold",
  "solar:menu-dots-bold",
  "solar:sort-from_top_to_bottom-bold-duotone",
  "solar:refresh-square-bold-duotone",
  "solar:cloud-download-bold-duotone", // For Update Available button
  "solar:refresh-bold", // For Check for Updates loading spinner
  "solar:add-circle-bold-duotone", // For Add Mods
  "solar:refresh-outline", // For primary refresh button normal state
  "solar:double-alt-arrow-up-bold-duotone" // For Update All button
];

interface ModsTabV2Props {
  profile?: Profile; // Make profile prop optional to handle undefined case gracefully
  onRefreshRequired?: () => void; // Callback if profile data changes internally
}

// Helper to get a displayable file name from mod source
const getModFileNameFromSource = (mod: Mod | null | undefined): string | null => {
  if (!mod) return null; // Add null check for mod itself
  if (mod.file_name_override) return mod.file_name_override;
  if (mod.source?.type === "modrinth") return (mod.source as ModSourceModrinth).file_name;
  if (mod.source?.type === "local") return (mod.source as ModSourceLocal).file_name;
  if (mod.source?.type === "url") return (mod.source as ModSourceUrl).file_name || null;
  return null;
};

export function ModsTabV2({ profile, onRefreshRequired }: ModsTabV2Props) {
  const { t } = useTranslation();
  const accentColor = useThemeStore((state) => state.accentColor);

  // Early return or loading state if profile is not yet available
  if (!profile) {
    // Optionally, render a more specific loading/error state for this case
    return (
      <div className="p-4 font-minecraft text-center text-white/70">
        {t('mods.profile_unavailable')}
      </div>
    );
  }
  const [mods, setMods] = useState<Mod[]>(profile.mods || []);
  const [isLoading, setIsLoading] = useState(false); // For general loading like initial fetch or refresh
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState(""); // This state will drive our own SearchInput
  const [modrinthIcons, setModrinthIcons] = useState<Record<string, string | null>>({});
  const [localArchiveIcons, setLocalArchiveIcons] = useState<Record<string, string | null>>({}); // New state for local icons
  const [modBeingToggled, setModBeingToggled] = useState<string | null>(null);
  const [modBeingDeleted, setModBeingDeleted] = useState<string | null>(null);
  const [selectedModIds, setSelectedModIds] = useState<Set<string>>(new Set());
  const [isBatchToggling, setIsBatchToggling] = useState(false);
  const [isBatchDeleting, setIsBatchDeleting] = useState(false);
  const [modUpdates, setModUpdates] = useState<Record<string, ModrinthVersion | null>>({});
  const [checkingUpdates, setCheckingUpdates] = useState(false);
  const [updatingMods, setUpdatingMods] = useState<Set<string>>(new Set());
  const [updateError, setUpdateError] = useState<string | null>(null);
  const [activeDropdownModId, setActiveDropdownModId] = useState<string | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null); // Ref for the dropdown menu
  const [batchProcessingModIds, setBatchProcessingModIds] = useState<Set<string>>(new Set()); // New state for batch processing
  const justToggledRef = useRef(false); // Ref to track if a toggle was just initiated

  // State for delete confirmation dialog
  const [isConfirmDeleteDialogOpen, setIsConfirmDeleteDialogOpen] = useState(false);
  const [modToDelete, setModToDelete] = useState<Mod | null>(null);
  const [isBatchDeleteConfirmActive, setIsBatchDeleteConfirmActive] = useState(false);
  const [isDialogActionLoading, setIsDialogActionLoading] = useState(false);
  const [isUpdatingAll, setIsUpdatingAll] = useState(false);

  useEffect(() => {
    preloadIcons(MODS_TAB_ICONS_TO_PRELOAD);
  }, []);

  // Update mods from profile prop when it changes
  useEffect(() => {
    setMods(profile.mods || []);
    setSelectedModIds(new Set()); // Clear selection when profile changes
  }, [profile.mods]);

  // Fetch Modrinth icons
  useEffect(() => {
    const fetchAllModrinthIcons = async () => {
      if (!mods || mods.length === 0) {
        setModrinthIcons({});
        return;
      }

      const modrinthProjectIds = mods
        .filter((mod) => mod.source?.type === "modrinth" && (mod.source as ModSourceModrinth).project_id)
        .map((mod) => (mod.source as ModSourceModrinth).project_id!);

      if (modrinthProjectIds.length > 0) {
        try {
          // Consider adding a loading state specifically for icons if needed
          const projectDetailsList = await ModrinthService.getProjectDetails(modrinthProjectIds);
          const icons: Record<string, string | null> = {};
          projectDetailsList.forEach((detail) => {
            if (detail?.id && detail.icon_url) {
              icons[detail.id] = detail.icon_url;
            }
          });
          setModrinthIcons(icons);
        } catch (err) {
          console.error("Failed to fetch Modrinth project details for icons:", err);
          // Optionally set an error state for icons or handle partial failures
        }
      } else {
        setModrinthIcons({});
      }
    };

    fetchAllModrinthIcons();
  }, [mods]);

  // Fetch local archive icons for mods
  useEffect(() => {
    const fetchLocalArchiveIconsForMods = async () => {
      if (!profile || !mods || mods.length === 0) {
        setLocalArchiveIcons({});
        return;
      }

      const pathsToFetchIconsFor = mods
        .filter(mod => {
          const source = mod.source as ModSourceLocal;
          // Only consider local mods where we can construct a path
          return mod.source?.type === "local" && 
                 source.file_name && 
                 localArchiveIcons[`${profile.path}/mods/${source.file_name}`] === undefined;
        })
        .map(mod => {
          const source = mod.source as ModSourceLocal;
          return `${profile.path}/mods/${source.file_name}`;
        });

      const uniquePaths = [...new Set(pathsToFetchIconsFor)];

      if (uniquePaths.length > 0) {
        try {
          const iconsResult = await invoke<Record<string, string | null>>(
            "get_icons_for_archives",
            { archivePaths: uniquePaths }
          );
          
          if (iconsResult) {
            const newLocalIcons: Record<string, string | null> = {};
            for (const path of uniquePaths) {
              newLocalIcons[path] = iconsResult[path] || null; // Store null if not found
            }
            setLocalArchiveIcons(prevIcons => ({ ...prevIcons, ...newLocalIcons }));
          }
        } catch (err) {
          console.error("Failed to fetch local archive icons for mods:", err);
        }
      }
    };

    fetchLocalArchiveIconsForMods();
  }, [mods, profile?.path]);

  // Click outside to close dropdown
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (activeDropdownModId && dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        // Also check if the click was on the toggle button itself, if so, the button's own handler will manage it.
        // This check might need to be more robust if the button is deeply nested or event propagation is stopped.
        const moreActionsButton = (event.target as HTMLElement).closest(`[data-mod-id="${activeDropdownModId}"] [title="More Actions"]`);
        if (!moreActionsButton) {
          setActiveDropdownModId(null);
        }
      }
    };

    if (activeDropdownModId) {
      document.addEventListener("mousedown", handleClickOutside);
    } else {
      document.removeEventListener("mousedown", handleClickOutside);
    }

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [activeDropdownModId]);

  const handleToggleMod = useCallback(async (modId: string, currentEnabledState?: boolean) => {
    const mod = mods.find(m => m.id === modId);
    if (!mod || !profile) return;

    const newEnabledStateForBackend = !mod.enabled;
    const modDisplayName = mod.display_name || getModFileNameFromSource(mod) || mod.id;

    setModBeingToggled(modId);
    const actionKey = newEnabledStateForBackend ? "enabling" : "disabling"; // For error message
    justToggledRef.current = true; // Set flag before backend call

    try {
      // Always use ProfileService.setProfileModEnabled
      await ProfileService.setProfileModEnabled(
        profile.id,
        modId,
        newEnabledStateForBackend,
      );

      // Success case: update state, no toast
      setMods((currentMods) =>
        currentMods.map((m) =>
          m.id === modId ? { ...m, enabled: newEnabledStateForBackend } : m
        )
      );
    } catch (err) {
      console.error(`Failed to ${actionKey} ${modDisplayName}:`, err);
      toast.error(t('mods.toggle_failed', { action: actionKey, name: modDisplayName, error: err instanceof Error ? err.message : String(err) }));
    } finally {
      setModBeingToggled(null);
    }
  }, [mods, profile]);

  const handleDeleteMod = useCallback(async (mod: Mod) => {
    if (!profile) {
      setError(t('mods.errors.profile_missing_delete'));
      return;
    }
    setModToDelete(mod);
    setIsBatchDeleteConfirmActive(false);
    setIsConfirmDeleteDialogOpen(true);
    // Actual deletion logic moved to handleConfirmDeletion
  }, [profile]);

  const handleOpenFolder = useCallback((mod: Mod) => {
    const modFileName = getModFileNameFromSource(mod);
    const displayName = mod.display_name || modFileName || mod.id;
    alert(`PROTOTYPE: Open folder for ${displayName}. Path: (not implemented)`);
  }, []);

  const handleMoreActions = useCallback((mod: Mod) => {
    const modFileName = getModFileNameFromSource(mod);
    const displayName = mod.display_name || modFileName || mod.id;
    const actions = [
      `1. Select Version (currently ${mod.version || 'N/A'})`,
      `2. Toggle Autoupdate (Status: N/A)`,
      `3. Mod Settings`,
      `4. More Info`,
    ];
    alert(`PROTOTYPE: More actions for ${displayName}:\n\n${actions.join('\n')}`);
  }, []);

  const handleModSelectionChange = useCallback((modId: string, isSelected: boolean) => {
    setSelectedModIds(prevSelectedIds => {
      const newSelectedIds = new Set(prevSelectedIds);
      if (isSelected) {
        newSelectedIds.add(modId);
      } else {
        newSelectedIds.delete(modId);
      }
      return newSelectedIds;
    });
  }, []);

  const renderModItem = useCallback((mod: Mod) => {
    const isToggling = modBeingToggled === mod.id;
    const isDeleting = modBeingDeleted === mod.id;
    const isThisModInBatchProcess = batchProcessingModIds.has(mod.id);
    const isCurrentlyUpdatingThisMod = updatingMods.has(mod.id);
    
    const modFileName = getModFileNameFromSource(mod);
    const itemTitle = mod.display_name || modFileName || mod.id;

    // Icon Node
    let modIconUrl: string | undefined = undefined;
    let localIconData: string | null = null;

    if (mod.source?.type === "modrinth" && (mod.source as ModSourceModrinth).project_id) {
      modIconUrl = modrinthIcons[(mod.source as ModSourceModrinth).project_id!] || undefined;
    }
    if (!modIconUrl && mod.source?.type === "local" && (mod.source as ModSourceLocal).file_name && profile?.path) {
      const localModPath = `${profile.path}/mods/${(mod.source as ModSourceLocal).file_name}`;
      localIconData = localArchiveIcons[localModPath] || null;
    }

    const itemIconNode = (
      <div
        className="absolute inset-0 w-full h-full flex items-center justify-center"
      >
        {modIconUrl ? (
          <img
            src={modIconUrl}
            alt={`${itemTitle} icon`}
            className="w-full h-full object-contain image-pixelated"
            onError={(e) => { 
              (e.target as HTMLImageElement).style.visibility = 'hidden'; 
            }}
          />
        ) : localIconData ? (
          <img 
            src={`data:image/png;base64,${localIconData}`} 
            alt={`${itemTitle} local icon`} 
            className="w-full h-full object-contain image-pixelated"
          />
        ) : (
          <Icon icon={MODS_TAB_ICONS_TO_PRELOAD[5]} className="w-8 h-8 sm:w-10 sm:h-10 text-white/40" />
        )}
      </div>
    );

    // Description Node (Version)
    const itemDescriptionNode = (
      <span title={t('mods.version_label', { version: mod.version || t('common.not_available') })}>
        {t('mods.version_label', { version: mod.version || t('common.not_available') })}
      </span>
    );

    // Badges Node
    const itemBadgesNode = (
      <>
        <TagBadge
          size="sm"
          variant={mod.enabled ? "success" : "destructive"}
          iconElement={mod.enabled ? <Icon icon={MODS_TAB_ICONS_TO_PRELOAD[3]} className="w-3 h-3"/> : <Icon icon={MODS_TAB_ICONS_TO_PRELOAD[4]} className="w-3 h-3"/>}
        >
          {mod.enabled ? t('mods.enabled') : t('mods.disabled')}
        </TagBadge>
        {mod.source?.type === "modrinth" && <TagBadge size="sm" variant="info">Modrinth</TagBadge>}
      </>
    );

    // Update Action Node
    const isModrinthModWithHash = mod.source?.type === "modrinth" && (mod.source as ModSourceModrinth).file_hash_sha1;
    const updateAvailableVersion = isModrinthModWithHash ? modUpdates[(mod.source as ModSourceModrinth).file_hash_sha1!] : null;
    let itemUpdateActionNode: React.ReactNode = null;
    if (updateAvailableVersion && !isCurrentlyUpdatingThisMod) {
      itemUpdateActionNode = (
        <IconButton
          size="sm"
          onClick={() => handleUpdateMod(mod, updateAvailableVersion)}
          disabled={isToggling || isDeleting || isThisModInBatchProcess || isBatchDeleting || checkingUpdates || isCurrentlyUpdatingThisMod}
          icon={<Icon icon="solar:cloud-download-bold-duotone" className="w-3.5 h-3.5" />}
          title={t('mods.update_to', { version: updateAvailableVersion.version_number })}
        />
      );
    } else if (isCurrentlyUpdatingThisMod) {
      itemUpdateActionNode = (
         <IconButton
          size="sm"
          disabled={true}
          icon={<Icon icon="solar:refresh-bold" className="animate-spin w-3.5 h-3.5" />}
          title={t('mods.updating_to', { version: updateAvailableVersion?.version_number })}
        />
      );
    }

    // Main Action Node (Toggle)
    const itemMainActionNode = (
      <Button
        size="sm"
        variant={mod.enabled ? "secondary" : "default"}
        onClick={() => handleToggleMod(mod.id, mod.enabled)}
        disabled={isToggling || isDeleting || isThisModInBatchProcess || isBatchDeleting || checkingUpdates || isCurrentlyUpdatingThisMod}
      >
        {isToggling || isThisModInBatchProcess ? t('mods.toggling') : (mod.enabled ? t('common.disable') : t('common.enable'))}
      </Button>
    );

    // Delete Action Node
    const itemDeleteActionNode = (
      <IconButton
        title={t('mods.delete_mod')}
        icon={isDeleting ? <Icon icon="solar:refresh-circle-bold-duotone" className="animate-spin w-3.5 h-3.5" /> : <Icon icon="solar:trash-bin-trash-bold" className="w-3.5 h-3.5" />}
        size="sm"
        onClick={() => handleDeleteMod(mod)}
        disabled={isToggling || isDeleting || isThisModInBatchProcess || isBatchDeleting || checkingUpdates || isCurrentlyUpdatingThisMod}
      />
    );

    // More Actions Trigger Node
    const itemMoreActionsTriggerNode = (
      <IconButton
        title={t('mods.more_actions')}
        icon={<Icon icon="solar:menu-dots-bold" className="w-3.5 h-3.5" />} 
        size="sm"
        onClick={(e) => {
          e.stopPropagation();
          setActiveDropdownModId(prevId => prevId === mod.id ? null : mod.id);
        }}
        disabled={isToggling || isDeleting || isThisModInBatchProcess || isBatchDeleting || checkingUpdates || isCurrentlyUpdatingThisMod}
        data-mod-id={mod.id}
      />
    );

    // Dropdown Node
    const itemDropdownNode = (
      <div 
        ref={dropdownRef} // This ref is managed by ModsTabV2 for click-outside detection
        className="absolute top-full right-0 mt-1 w-44 bg-opacity-80 backdrop-blur-md border rounded-md shadow-lg z-20 p-1 flex flex-col gap-0.5"
        onClick={(e) => e.stopPropagation()}
        style={{
          backgroundColor: `${accentColor.value}CC`, // BF is ~75%, CC is ~80%
          borderColor: `${accentColor.value}50`,
        }}
      >
        <button 
          onClick={() => { handleOpenFolder(mod); setActiveDropdownModId(null); }}
          className="w-full text-left px-2 py-1.5 text-[11px] font-minecraft-ten hover:bg-[var(--accent-color-soft)] rounded-sm text-white/80 hover:text-white transition-colors duration-100 flex items-center gap-1.5"
        >
          <Icon icon="solar:folder-open-bold-duotone" className="w-3 h-3 flex-shrink-0" />
          Open Folder
        </button>
        <div className="h-px bg-[var(--border-color-soft)] my-0.5 mx-1"></div>
        {[
          `Select Version (v${mod.version || 'N/A'})`,
          `Toggle Autoupdate (N/A)`,
          // `Mod Settings`,
          // `More Info`,
        ].map(actionText => (
          <button 
            key={actionText}
            onClick={() => { alert(`PROTOTYPE: ${actionText}`); setActiveDropdownModId(null); }}
            className="w-full text-left px-2 py-1.5 text-[11px] font-minecraft-ten hover:bg-[var(--accent-color-soft)] rounded-sm text-white/70 hover:text-white transition-colors duration-100"
          >
            {actionText.startsWith("Select Version") ? actionText : actionText.split(" (")[0]}
          </button>
        ))}
      </div>
    );

    return (
              <GenericDetailListItem
        id={mod.id}
        isSelected={selectedModIds.has(mod.id)}
        onSelectionChange={(checked) => handleModSelectionChange(mod.id, checked)}
        iconNode={itemIconNode}
        title={itemTitle}
        descriptionNode={itemDescriptionNode}
        updateActionNode={itemUpdateActionNode}
        mainActionNode={itemMainActionNode}
        deleteActionNode={itemDeleteActionNode}
        moreActionsTriggerNode={itemMoreActionsTriggerNode}
        dropdownNode={itemDropdownNode}
        isDropdownVisible={activeDropdownModId === mod.id}
        accentColor={accentColor.value}
      />
    );
  }, [
    accentColor.value, 
    handleToggleMod, 
    modrinthIcons, 
    localArchiveIcons,
    modBeingToggled, 
    modBeingDeleted, 
    handleDeleteMod, 
    handleOpenFolder, 
    profile,
    selectedModIds, 
    handleModSelectionChange,
    batchProcessingModIds,
    isBatchDeleting,
    checkingUpdates,
    updatingMods,
    modUpdates, 
    activeDropdownModId,
    setActiveDropdownModId
  ]);

  const filteredMods = useMemo(() => {
    if (!searchQuery) return mods;
    return mods.filter((mod) => {
      const name = mod.display_name || getModFileNameFromSource(mod) || "";
      const id = mod.id || "";
      const fileName = getModFileNameFromSource(mod) || "";
      return (
        name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        id.toLowerCase().includes(searchQuery.toLowerCase()) ||
        fileName.toLowerCase().includes(searchQuery.toLowerCase())
      );
    });
  }, [mods, searchQuery]);

  const handleSelectAllToggle = useCallback((isChecked: boolean) => {
    setSelectedModIds(prevSelectedIds => {
      const newSelectedIds = new Set(prevSelectedIds);
      if (isChecked) {
        filteredMods.forEach(mod => newSelectedIds.add(mod.id));
      } else {
        filteredMods.forEach(mod => newSelectedIds.delete(mod.id));
      }
      return newSelectedIds;
    });
  }, [filteredMods]);

  const areAllFilteredSelected = useMemo(() => {
    return filteredMods.length > 0 && filteredMods.every(mod => selectedModIds.has(mod.id));
  }, [filteredMods, selectedModIds]);

  const handleAddMods = () => alert("PROTOTYPE: Add Mods (e.g., open file dialog or navigate to discovery)");

  const refreshModsData = async () => {
    if (!profile) return; 
    setIsLoading(true);
    setError(null);
    try {
      const updatedProfile = await ProfileService.getProfile(profile.id);
      setMods(updatedProfile.mods || []);
      setSelectedModIds(new Set()); 
      if (onRefreshRequired) onRefreshRequired(); 
      // After refreshing mods data, explicitly check for updates with the new data
      checkForModUpdates(updatedProfile); 
    } catch (err) {
      console.error("Failed to refresh mods data:", err);
      setError(`Failed to refresh mods: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setIsLoading(false);
    }
  };

  const checkForModUpdates = async (currentProfile = profile) => {
    if (!currentProfile || !currentProfile.mods || currentProfile.mods.length === 0) return;

    const modsWithHashes = currentProfile.mods.filter(
      (mod: Mod) =>
        mod.source?.type === "modrinth" &&
        (mod.source as ModSourceModrinth).file_hash_sha1 != null,
    );

    if (modsWithHashes.length === 0) {
      setModUpdates({});
      // alert("No Modrinth mods with file hashes found to check for updates.");
      return;
    }

    const hashes = modsWithHashes.map(
      (mod: Mod) => (mod.source as ModSourceModrinth).file_hash_sha1!,
    );

    setCheckingUpdates(true);
    setUpdateError(null);
    // alert(`PROTOTYPE: Checking for updates for ${hashes.length} mods...`);

    try {
      const request: ModrinthBulkUpdateRequestBody = {
        hashes,
        algorithm: "sha1" as ModrinthHashAlgorithm,
        loaders: [currentProfile.loader], // Ensure profile.loader is available and correct
        game_versions: [currentProfile.game_version], // Ensure profile.game_version is available
      };

      const updates = await invoke<Record<string, ModrinthVersion>>(
        "check_modrinth_updates",
        { request },
      );

      const filteredUpdates: Record<string, ModrinthVersion> = {};
      const modsByHash = new Map<string, Mod>();
      for (const mod of modsWithHashes) {
        const hash = (mod.source as ModSourceModrinth).file_hash_sha1!;
        modsByHash.set(hash, mod);
      }

      for (const [hash, version] of Object.entries(updates)) {
        const mod = modsByHash.get(hash);
        if (mod && mod.version !== version.version_number) {
          filteredUpdates[hash] = version;
        } 
      }
      setModUpdates(filteredUpdates);
      if (Object.keys(filteredUpdates).length > 0) {
        // alert(`PROTOTYPE: Found updates for ${Object.keys(filteredUpdates).length} mods.`);
      } else {
        // alert("PROTOTYPE: No updates available for any mods.");
      }
    } catch (error) {
      console.error("Error checking for mod updates:", error);
      setUpdateError(
        error instanceof Error
          ? error.message
          : "Error checking for mod updates",
      );
    } finally {
      setCheckingUpdates(false);
    }
  };

  // Initial check for updates on mount and if profile ID changes (indicating a new profile is selected)
  useEffect(() => {
    if (profile && profile.id && profile.mods && profile.mods.length > 0) {
      // Ensure this runs only when the profile context genuinely changes to a new one,
      // or on initial load of a profile.
      checkForModUpdates(profile);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.id]); // Rerun only if profile.id changes

  const handleUpdateMod = async (mod: Mod, updateVersion: ModrinthVersion) => {
    if (
      mod.source?.type !== "modrinth" ||
      !(mod.source as ModSourceModrinth).file_hash_sha1
    ) {
      console.error("Cannot update non-Modrinth mod or mod without original hash");
      setError("This mod cannot be automatically updated (missing Modrinth source information).");
      return;
    }
    if (!profile) {
        console.error("Profile not available for updating mod");
        setError(t('mods.errors.profile_missing_update'));
        return;
    }

    setUpdatingMods((prev) => new Set(prev).add(mod.id));
    setError(null);
    setUpdateError(null);

    try {
      await invoke("update_modrinth_mod_version", {
        profileId: profile.id,
        modInstanceId: mod.id,
        newVersionDetails: updateVersion,
      });

      // Refresh local mods state to reflect the update
      setMods((currentMods) =>
        currentMods.map((m) =>
          m.id === mod.id
            ? {
                ...m,
                version: updateVersion.version_number,
                source:
                  m.source?.type === "modrinth"
                    ? {
                        ...(m.source as ModSourceModrinth),
                        version_id: updateVersion.id,
                        file_name: updateVersion.files[0]?.filename, // Assuming first file is primary
                        file_hash_sha1: updateVersion.files[0]?.hashes?.sha1, // Update hash if available
                      }
                    : m.source,
              }
            : m,
        ),
      );
      // Remove from modUpdates as it's now up-to-date
      const currentModSource = mod.source as ModSourceModrinth;
      if (currentModSource.file_hash_sha1) { 
        setModUpdates(prevUpdates => {
            const newUpdates = {...prevUpdates};
            delete newUpdates[currentModSource.file_hash_sha1!];
            return newUpdates;
        });
      }
      if (onRefreshRequired) onRefreshRequired();
    } catch (err) {
      console.error("Failed to update mod:", err);
      const displayName = mod.display_name || getModFileNameFromSource(mod) || mod.id;
      setError(
        `Failed to update ${displayName}: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      setUpdatingMods((prev) => {
        const newSet = new Set(prev);
        newSet.delete(mod.id);
        return newSet;
      });
    }
  };

  const handleBatchToggleSelected = async () => {
    if (!profile || selectedModIds.size === 0) return;
    
    setIsBatchToggling(true); // Disables the main batch "Toggle" button in header
    setBatchProcessingModIds(new Set(selectedModIds)); // Mark specific mods as processing
    justToggledRef.current = true; // Set flag before backend calls
    const collectedErrors: string[] = [];

    // Prepare data for each mod to be toggled
    const toggleOperations = Array.from(selectedModIds).map(modId => {
      const mod = mods.find(m => m.id === modId);
      if (mod && profile) {
        const newEnabledStateForBackend = !mod.enabled;
        const modDisplayName = mod.display_name || getModFileNameFromSource(mod) || mod.id;
        const actionDescription = newEnabledStateForBackend ? "enable" : "disable";

        let promise;
        const modSource = mod.source as ModSourceModrinth; // Type assertion for clarity
        if (mod.source?.type === "modrinth" && modSource.file_hash_sha1) {
          const payload: ToggleContentPayload = {
            profile_id: profile.id,
            sha1_hash: modSource.file_hash_sha1,
            enabled: newEnabledStateForBackend,
          };
          promise = toggleContentFromProfile(payload);
        } else {
          promise = ProfileService.setProfileModEnabled(profile.id, modId, newEnabledStateForBackend);
        }
        return { modId, modDisplayName, actionDescription, newEnabledStateForBackend, promise };
      }
      const errorMsg = !mod ? `Could not find mod with ID ${modId}.` : `Profile data missing for mod ${modId}.`;
      toast.error(errorMsg);
      collectedErrors.push(errorMsg);
      return null;
    }).filter(op => op !== null) as { modId: string; modDisplayName: string; actionDescription: string; newEnabledStateForBackend: boolean; promise: Promise<any> }[];

    if (toggleOperations.length === 0) {
      setIsBatchToggling(false);
      setSelectedModIds(new Set());
      if (collectedErrors.length > 0) {
        console.warn("Batch mod toggle pre-flight errors:", collectedErrors);
      }
      return;
    }

    const results = await Promise.allSettled(
      toggleOperations.map(op => op.promise)
    );

    let successfulTogglesCount = 0;
    const updatedMods = mods.map(mod => {
      const operationIndex = toggleOperations.findIndex(op => op.modId === mod.id);
      if (operationIndex !== -1) {
        const result = results[operationIndex];
        const opData = toggleOperations[operationIndex];
        if (result.status === 'fulfilled') {
          successfulTogglesCount++;
          return { ...mod, enabled: opData.newEnabledStateForBackend };
        } else { // result.status === 'rejected'
          const errorDetail = result.reason instanceof Error ? result.reason.message : String(result.reason);
          const errorMessage = `Failed to ${opData.actionDescription} ${opData.modDisplayName}: ${errorDetail}`;
          collectedErrors.push(errorMessage);
          console.error(`Batch toggle: ${errorMessage}`, result.reason);
          toast.error(errorMessage);
          return mod; // Return original mod on failure
        }
      }
      return mod; // Not part of this batch operation
    });

    setMods(updatedMods);

    setIsBatchToggling(false); // Re-enable main batch "Toggle" button
    setBatchProcessingModIds(new Set()); // Clear specific mod processing states
    if (collectedErrors.length > 0 && successfulTogglesCount < toggleOperations.length) {
      // Log only if there were actual processing errors, not just pre-flight ones already handled
      const processingErrors = collectedErrors.filter(e => e.startsWith("Failed to"));
      if (processingErrors.length > 0) {
        console.warn("Batch mod toggle finished with some errors:", processingErrors);
      }
    }

    // Removed onRefreshRequired call
    // if (successfulTogglesCount > 0) {
    //   if (onRefreshRequired) onRefreshRequired();
    // }
    setSelectedModIds(new Set());
  };

  const handleBatchDeleteSelected = async () => {
    if (!profile || selectedModIds.size === 0) return;
    setModToDelete(null); // No single mod target for batch
    setIsBatchDeleteConfirmActive(true);
    setIsConfirmDeleteDialogOpen(true);
    // Actual deletion logic moved to handleConfirmDeletion
  };

  const handleCloseDeleteDialog = () => {
    setIsConfirmDeleteDialogOpen(false);
    setModToDelete(null);
    setIsBatchDeleteConfirmActive(false);
    // modBeingDeleted and isBatchDeleting are for row/header button states, not dialog's internal loading
  };

  const handleConfirmDeletion = async () => {
    if (!profile) {
      setError(t('mods.errors.profile_missing_complete'));
      handleCloseDeleteDialog();
      return;
    }

    setIsDialogActionLoading(true);
    setError(null); // Clear previous general errors

    if (isBatchDeleteConfirmActive) {
      // Batch Delete Logic
      setIsBatchDeleting(true); // For the main button in header, if needed, though dialog takes over
      let successfulDeletes = 0;
      const errors: string[] = [];
      for (const modId of selectedModIds) {
        try {
          await ProfileService.deleteModFromProfile(profile.id, modId);
          successfulDeletes++;
        } catch (err) {
          const modBeingProcessed = mods.find(m => m.id === modId);
          const modDisplayName = modBeingProcessed?.display_name || getModFileNameFromSource(modBeingProcessed!) || modId;
          errors.push(`Failed to delete ${modDisplayName}: ${err instanceof Error ? err.message : String(err)}`);
          console.error(`Failed to delete mod ${modId} during batch:`, err);
        }
      }
      setMods(currentMods => currentMods.filter(mod => !selectedModIds.has(mod.id) || errors.some(e => e.includes(mod.id))));
      setSelectedModIds(new Set());
      if (errors.length > 0) {
        setError(`Batch delete: ${errors.join(". ")}`);
      } else {
        // toast.success(`${successfulDeletes} mod(s) deleted.`); // Example toast
      }
      setIsBatchDeleting(false); // Reset main button state

    } else if (modToDelete) {
      // Single Mod Delete Logic
      setModBeingDeleted(modToDelete.id); // For the row button state
      const modDisplayName = modToDelete.display_name || getModFileNameFromSource(modToDelete) || modToDelete.id;
      try {
        await ProfileService.deleteModFromProfile(profile.id, modToDelete.id);
        setMods(prevMods => prevMods.filter(m => m.id !== modToDelete.id));
        setSelectedModIds(prevSelected => {
          const newSelected = new Set(prevSelected);
          newSelected.delete(modToDelete.id!);
          return newSelected;
        });
        // toast.success(`Mod '${modDisplayName}' deleted.`); // Example toast
      } catch (err) {
        setError(`Failed to delete ${modDisplayName}: ${err instanceof Error ? err.message : String(err)}`);
        console.error(`Failed to delete mod ${modToDelete.id}:`, err);
      } finally {
        setModBeingDeleted(null); // Reset row button state
      }
    }

    setIsDialogActionLoading(false);
    handleCloseDeleteDialog();
    if (onRefreshRequired) onRefreshRequired(); // Refresh if any deletion occurred
  };
  
  const handleUpdateAllAvailableMods = async () => {
    if (Object.keys(modUpdates).length === 0 || !profile) return;

    setIsUpdatingAll(true);
    setError(null);
    setUpdateError(null);
    let updateCount = 0;

    const modsToUpdateWithDetails: {mod: Mod, version: ModrinthVersion}[] = [];

    // First, gather all mods that actually need updating based on modUpdates
    for (const mod of mods) {
      if (mod.source?.type === "modrinth" && (mod.source as ModSourceModrinth).file_hash_sha1) {
        const hash = (mod.source as ModSourceModrinth).file_hash_sha1!;
        const updateVersion = modUpdates[hash];
        if (updateVersion) {
          modsToUpdateWithDetails.push({ mod, version: updateVersion });
        }
      }
    }

    if (modsToUpdateWithDetails.length === 0) {
        setIsUpdatingAll(false);
        return;
    }

    for (const { mod, version } of modsToUpdateWithDetails) {
      // Use the existing handleUpdateMod logic for each mod
      // handleUpdateMod already handles its own errors and UI updates for individual mods.
      await handleUpdateMod(mod, version);
      updateCount++;
    }
    
    setIsUpdatingAll(false);
    // After all updates, re-trigger a check to clear out any remaining modUpdates that might be stale
    // or to confirm all were updated. checkForModUpdates will set its own loading state.
    if (updateCount > 0) {
        await checkForModUpdates(profile); 
    }
    // Optionally, add a summary toast here if needed.
  };

  const primaryLeftActionsContent = (
    <div className="flex flex-col gap-2 flex-grow min-w-0">
      <div className="flex items-center gap-2"> {/* Wrapper for SearchInput and Action IconButtons */}
        <SearchInput
          value={searchQuery}
          onChange={setSearchQuery}
          placeholder={t('mods.search_placeholder')}
          className="flex-grow !h-9"
          disabled={isBatchToggling || isBatchDeleting || isLoading || checkingUpdates || isUpdatingAll}
        />
        <IconButton
            icon={<Icon icon="solar:add-circle-bold-duotone" />}
            onClick={handleAddMods}
            disabled={isLoading || isBatchToggling || isBatchDeleting || checkingUpdates || isUpdatingAll}
            size="sm"
            title={t('mods.add_mods')}
            className="!h-9 !w-9 flex-shrink-0"
        />
        {/* Check for Updates Button REMOVED */}
        <IconButton
            icon={isLoading ? <Icon icon="solar:refresh-bold" className="animate-spin" /> : <Icon icon="solar:refresh-outline" />}
            onClick={refreshModsData}
            disabled={isLoading || isBatchToggling || isBatchDeleting || checkingUpdates || isUpdatingAll}
            size="sm"
            title={isLoading ? t('mods.refreshing') : t('mods.refresh_mods')}
            className="!h-9 !w-9 flex-shrink-0 ml-auto"
        />
      </div>
      {/* Display update error if any */}
      {updateError && (
        <div
          className="p-2 text-sm flex items-center gap-2 my-1 rounded-md border"
          style={{
            backgroundColor: `rgba(220, 38, 38, 0.1)`,
            borderColor: `rgba(220, 38, 38, 0.3)`,
            color: `rgb(252, 165, 165)`
          }}
        >
          <Icon
            icon="solar:danger-triangle-bold"
            className="w-4 h-4 text-red-400 flex-shrink-0"
          />
          <span className="font-minecraft">{t('mods.update_error')}: {updateError}</span>
        </div>
      )}
      {mods.length > 0 && (
        <>
          <div 
            className="h-px w-full my-1"
            style={{ backgroundColor: `${accentColor.value}30` }} 
          />
          <div className="flex items-center justify-between w-full min-h-14"> {/* Wrapper for SelectAll and Batch Actions - User set min-h-14 */}
            <Checkbox
              customSize="md" 
              checked={areAllFilteredSelected}
              onChange={(e) => handleSelectAllToggle(e.target.checked)}
              disabled={filteredMods.length === 0 || isBatchToggling || isBatchDeleting || isLoading || checkingUpdates || isUpdatingAll}
              label={selectedModIds.size > 0 ? t('mods.count_selected', { count: selectedModIds.size }) : t('mods.select_all')}
              title={areAllFilteredSelected ? t('mods.deselect_all_visible') : t('mods.select_all_visible')}
            />
            <div className="flex items-center gap-2"> {/* Wrapper for batch actions and Update All */}
              {selectedModIds.size > 0 && (
                <>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={handleBatchToggleSelected}
                    disabled={isBatchToggling || isBatchDeleting || isLoading || checkingUpdates || isUpdatingAll}
                    icon={isBatchToggling ? <Icon icon="solar:refresh-bold" className="animate-spin mr-1.5" /> : undefined}
                  >
                    {isBatchToggling ? t('mods.toggling') : t('mods.toggle_count', { count: selectedModIds.size })}
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={handleBatchDeleteSelected}
                    disabled={isBatchToggling || isBatchDeleting || isLoading || checkingUpdates || isUpdatingAll}
                    icon={isBatchDeleting ? <Icon icon="solar:refresh-bold" className="animate-spin mr-1.5" /> : undefined}
                  >
                    {isBatchDeleting ? t('mods.deleting') : t('mods.delete_count', { count: selectedModIds.size })}
                  </Button>
                </>
              )}
              {Object.keys(modUpdates).length > 0 && (
                <Button
                  size="sm"
                  variant="success" // Or use "secondary" or a new variant
                  onClick={handleUpdateAllAvailableMods}
                  disabled={isUpdatingAll || isLoading || isBatchToggling || isBatchDeleting || checkingUpdates}
                  icon={isUpdatingAll ? <Icon icon="solar:refresh-bold" className="animate-spin mr-1.5" /> : <Icon icon="solar:double-alt-arrow-up-bold-duotone" className="mr-1.5" />}
                  className={selectedModIds.size > 0 ? "ml-2" : ""} // Add margin if batch actions are present
                >
                  {isUpdatingAll ? t('mods.updating_all') : t('mods.update_all_count', { count: Object.keys(modUpdates).length })}
                </Button>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );

  const primaryRightActionsContent = null; // Now empty as batch actions moved to the left

  return (
    <>
      <GenericContentTab<Mod>
        items={filteredMods}
        renderListItem={renderModItem}
        isLoading={isLoading} 
        error={error} 
        searchQuery={searchQuery} 
        primaryLeftActions={primaryLeftActionsContent}
        primaryRightActions={primaryRightActionsContent}
        emptyStateIcon={MODS_TAB_ICONS_TO_PRELOAD[0]} 
        emptyStateMessage={
          error ? t('mods.error_loading') :
          isLoading && mods.length === 0 ? t('mods.loading') :
          !searchQuery && mods.length === 0 && selectedModIds.size === 0 ? t('mods.no_mods_found') :
          searchQuery && filteredMods.length === 0 && selectedModIds.size === 0 ? t('mods.no_mods_match') :
          t('mods.manage_mods')
        }
        emptyStateDescription={
          error ? t('mods.please_try_refreshing') :
          isLoading && mods.length === 0 ? t('mods.please_wait_loading') :
          !searchQuery && mods.length === 0 && selectedModIds.size === 0 ? t('mods.add_mods_desc') :
          searchQuery && filteredMods.length === 0 && selectedModIds.size === 0 ? t('mods.try_different_search') :
          t('mods.select_to_manage')
        }
        loadingItemCount={Math.min(mods.length > 0 ? mods.length : 5, 10)} 
        accentColorOverride={accentColor.value}
        showSkeletons={false}
      />
    
      <ConfirmDeleteDialog
        isOpen={isConfirmDeleteDialogOpen}
        itemName={isBatchDeleteConfirmActive ? `${selectedModIds.size} mod${selectedModIds.size === 1 ? '' : 's'}` : (modToDelete?.display_name || getModFileNameFromSource(modToDelete!) || modToDelete?.id || "item")}
        onClose={handleCloseDeleteDialog}
        onConfirm={handleConfirmDeletion}
        isDeleting={isDialogActionLoading} // This controls the dialog's confirm button state
        title={isBatchDeleteConfirmActive ? t('mods.delete_selected_title') : t('mods.delete_mod_title')}
      />
    </>
  );
} 


