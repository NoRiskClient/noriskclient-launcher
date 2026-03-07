"use client";

import { useEffect, useState } from "react";
import type { Profile } from "../../types/profile";
import { useProfileStore } from "../../store/profile-store";
import { LoadingState } from "../ui/LoadingState";
import { EmptyState } from "../ui/EmptyState";

import { ProfileCardV2 } from "../profiles/ProfileCardV2";
import { toast } from "react-hot-toast";
import { SearchWithFilters } from "../ui/SearchWithFilters";
import { GroupTabs, type GroupTab } from "../ui/GroupTabs";
import { ActionButtons, type ActionButton } from "../ui/ActionButtons";
import { useNavigate } from "react-router-dom";
import { ProfileImport } from "../profiles/ProfileImport";
import * as ProfileService from "../../services/profile-service";
import { useConfirmDialog } from "../../hooks/useConfirmDialog";
import { useProfileWizardStore } from "../../store/profile-wizard-store";
import { useThemeStore } from "../../store/useThemeStore";
import { useGlobalModal } from "../../hooks/useGlobalModal";
import { ExportProfileModal } from "../profiles/ExportProfileModal";
import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";
import { usePinnedProfilesStore } from "../../store/usePinnedProfilesStore";

export function ProfilesTabV2() {
  const { t } = useTranslation();
  const {
    profiles,
    loading,
    error,
    fetchProfiles,
  } = useProfileStore();
  const navigate = useNavigate();
  const { confirm, confirmDialog } = useConfirmDialog();
  const { openModal: openWizard } = useProfileWizardStore();
  const { isPinned } = usePinnedProfilesStore();
  const { showModal, hideModal } = useGlobalModal();
  
  // Persistent filters from theme store
  const {
    profilesTabActiveGroup,
    profilesTabSortBy,
    profilesTabVersionFilter,
    profilesTabLayoutMode,
    setProfilesTabActiveGroup,
    setProfilesTabSortBy,
    setProfilesTabVersionFilter,
    setProfilesTabLayoutMode,
  } = useThemeStore();
  
  // Local non-persistent state
  const [searchQuery, setSearchQuery] = useState("");
  
  // Use persistent values instead of local state
  const activeGroup = profilesTabActiveGroup;
  const sortBy = profilesTabSortBy;
  const versionFilter = profilesTabVersionFilter;
  const layoutMode = profilesTabLayoutMode;

  // Action buttons configuration
  const actionButtons: ActionButton[] = [
    {
      id: "import",
      label: t('profiles.import').toUpperCase(),
      icon: "solar:upload-bold",
      tooltip: t('profiles.importProfile'),
      onClick: () => {
        showModal("profile-import", <ProfileImport
          onClose={() => {
            hideModal("profile-import");
            navigate("/profiles");
          }}
          onImportComplete={handleImportComplete}
        />);
        navigate("/profiles");
      },
    },
    {
      id: "create",
      label: t('profiles.create').toUpperCase(),
      icon: "solar:widget-add-bold",
      tooltip: t('profiles.createNewProfile'),
      onClick: () => {
        // Pass current group as default, but not if it's "all" or "server"
        const defaultGroup = (activeGroup === "all" || activeGroup === "server") ? null : activeGroup;
        openWizard(defaultGroup);
        navigate("/profiles");
      },
    },
  ];
  
  // Get unique profile groups dynamically (normalized to lowercase)
  const getUniqueProfileGroups = () => {
    const uniqueGroups = new Set<string>();
    profiles.forEach(profile => {
      if (profile.group && profile.group.trim() !== "") {
        // Normalize to lowercase to avoid duplicates like "Custom" and "CUSTOM"
        uniqueGroups.add(profile.group.toLowerCase());
      }
    });
    return Array.from(uniqueGroups).sort();
  };

  // Helper function to check if a group belongs to NRC
  const isNrcGroup = (groupName: string | null): boolean => {
    if (!groupName) return false;
    const normalized = groupName.toLowerCase();
    return normalized === "nrc" || normalized === "noriskclient" || normalized === "norisk client";
  };

  // Calculate group counts based on current search/filter
  const getFilteredCountForGroup = (groupId: string) => {
    if (groupId === "all") return profiles.length;
    
    // Handle default groups
    if (groupId === "nrc") return profiles.filter(p => isNrcGroup(p.group)).length;
    if (groupId === "server") return profiles.filter(p => p.group === "SERVER").length;
    if (groupId === "modpacks") return profiles.filter(p => p.group === "MODPACKS").length;
    
    // Handle dynamic groups (groupId is normalized lowercase, compare with profile.group in lowercase)
    return profiles.filter(p => p.group && p.group.toLowerCase() === groupId).length;
  };

  // Create groups array with default groups + dynamic groups
  const createGroups = (): GroupTab[] => {
    const defaultGroups: GroupTab[] = [
      { id: "all", name: "All", count: getFilteredCountForGroup("all") },
      { id: "nrc", name: "NRC", count: getFilteredCountForGroup("nrc") },
      { id: "server", name: "SERVER", count: getFilteredCountForGroup("server") },
      { id: "modpacks", name: "MODPACKS", count: getFilteredCountForGroup("modpacks") },
    ];

    // Get unique profile groups and convert to GroupTab format
    const uniqueGroups = getUniqueProfileGroups();
    const dynamicGroups: GroupTab[] = uniqueGroups
      .filter(group => 
        !["server", "modpacks"].includes(group) && // Exclude SERVER and MODPACKS (already normalized)
        !isNrcGroup(group) // Exclude all NRC variations
      )
      .map(group => ({
        id: group, // group is already lowercase from getUniqueProfileGroups
        name: group, // group is already lowercase from getUniqueProfileGroups
        count: getFilteredCountForGroup(group), // Use the updated function
      }));

    return [...defaultGroups, ...dynamicGroups];
  };

  const groups = createGroups();

  useEffect(() => {
    fetchProfiles();
  }, [fetchProfiles]);

  // Handler functions from ProfilesTab.tsx
  const handleCreateProfile = () => {
    console.log("[ProfilesTabV2] handleCreateProfile called.");
    fetchProfiles();
    navigate("/profiles");
  };

  const handleImportComplete = () => {
    console.log("[ProfilesTabV2] handleImportComplete called.");
    fetchProfiles();
    hideModal("profile-import");
    navigate("/profiles");
  };

  const handleDeleteProfile = async (
    profileId: string,
    profileName: string,
  ) => {
    console.log(
      "[ProfilesTabV2] handleDeleteProfile called for:",
      profileId,
      profileName,
    );
    
    // Find the profile to check if it's a standard version
    const profile = profiles.find(p => p.id === profileId);
    
    const confirmed = await confirm({
      title: t('profiles.deleteProfileTitle'),
      message: t('profiles.deleteConfirmMessageSimple', { name: profileName }),
      confirmText: t('profiles.deleteConfirm'),
      cancelText: t('profiles.cancelAction'),
      type: "danger",
      fullscreen: true,
    });

    if (confirmed) {
      const deletePromise = useProfileStore.getState().deleteProfile(profileId);
      toast.promise(deletePromise, {
        loading: t('profiles.deletingProfile', { name: profileName }),
        success: () => {
          fetchProfiles();
          return t('profiles.deleteSuccess', { name: profileName });
        },
        error: (err) =>
          t('profiles.deleteError', { error: err instanceof Error ? err.message : String(err.message) }),
      });
    }
  };

  const handleOpenFolder = async (profile: Profile) => {
    console.log("[ProfilesTabV2] handleOpenFolder called for:", profile.name);
    const openPromise = ProfileService.openProfileFolder(profile.id);
    toast.promise(openPromise, {
      loading: t('profiles.openingFolder', { name: profile.name }),
      success: t('profiles.openFolderSuccess', { name: profile.name }),
      error: (err) => {
        const message = err instanceof Error ? err.message : String(err.message);
        console.error(`Failed to open folder for ${profile.name}:`, err);
        return t('profiles.openFolderError', { error: message });
      },
    });
  };

  // Note: Launch functionality is now handled directly in ProfileCardV2

  const handleSettings = (profile: Profile) => {
    console.log("Opening settings for profile:", profile.name);
    // Navigate to the profile detail view V2
    navigate(`/profilesv2/${profile.id}`);
  };

  const handleMods = (profile: Profile) => {
    console.log("Managing mods for profile:", profile.name);
    // Navigate to the profile detail view V2 with mods tab focus
    navigate(`/profilesv2/${profile.id}`);
    // Note: The ProfileDetailViewV2 will show the mods tab by default
  };

  if (loading) {
    return <LoadingState message={t('profiles.loadingProfiles')} />;
  }

  if (error) {
    return (
      <EmptyState
        icon="solar:danger-triangle-bold"
        message={error || ""}
      />
    );
  }

  if (profiles.length === 0) {
    return (
      <EmptyState
        icon="solar:widget-bold"
        message={t('profiles.noProfilesFound')}
      />
    );
  }

  // Filter profiles based on search query, active group, and version filter
  const filteredProfiles = profiles.filter((profile) => {
    // Search filter
    const matchesSearch = searchQuery === "" || 
      profile.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (profile.group && profile.group.toLowerCase().includes(searchQuery.toLowerCase()));
    
    // Group filter
    const matchesGroup = activeGroup === "all" || 
      (activeGroup === "nrc" && isNrcGroup(profile.group)) ||
      (activeGroup === "server" && profile.group === "SERVER") ||
      (activeGroup === "modpacks" && profile.group === "MODPACKS") ||
      (profile.group && profile.group.toLowerCase() === activeGroup);
    
    // Version filter (simplified for now)
    const matchesVersion = versionFilter === "all" || 
      profile.game_version?.includes(versionFilter);
    
    return matchesSearch && matchesGroup && matchesVersion;
  });

  // Sort filtered profiles
  const sortedProfiles = [...filteredProfiles].sort((a, b) => {
    const aPinned = isPinned(a.id);
    const bPinned = isPinned(b.id);
    if (aPinned !== bPinned) return aPinned ? -1 : 1;

    switch (sortBy) {
      case "name":
        return a.name.localeCompare(b.name);
      case "last_played":
        // Multi-level sorting: last_played -> date_created -> name
        const aTimestamp = a.last_played ? new Date(a.last_played).getTime() : 0;
        const bTimestamp = b.last_played ? new Date(b.last_played).getTime() : 0;

        // Primary sort: by last_played (descending)
        if (bTimestamp !== aTimestamp) {
          return bTimestamp - aTimestamp;
        }

        // Secondary sort: by date_created (descending)
        const aCreated = new Date(a.created).getTime();
        const bCreated = new Date(b.created).getTime();
        if (bCreated !== aCreated) {
          return bCreated - aCreated;
        }

        // Tertiary sort: by name (ascending)
        return a.name.localeCompare(b.name);
      case "date_created":
        // Convert string dates to timestamps for comparison
        const aCreatedTimestamp = new Date(a.created).getTime();
        const bCreatedTimestamp = new Date(b.created).getTime();
        return bCreatedTimestamp - aCreatedTimestamp;
      default:
        return a.name.localeCompare(b.name);
    }
  });

  return (
    <div className="h-full flex flex-col overflow-hidden p-4 relative">
      <div className="flex-1 overflow-y-auto no-scrollbar">
      {/* Group Tabs */}
      <GroupTabs
        groups={groups}
        activeGroup={activeGroup}
        onGroupChange={setProfilesTabActiveGroup}
        showAddButton={false}
      />

      {/* Search & Filter Header */}
      <div className="mb-6 pb-4 border-b border-white/10">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 flex-1">
            <SearchWithFilters
              placeholder={t('profiles.searchProfiles')}
              searchValue={searchQuery}
              onSearchChange={setSearchQuery}
              sortOptions={[
                { value: "name", label: t('profiles.sort.name'), icon: "solar:text-bold" },
                { value: "last_played", label: t('profiles.sort.lastPlayed'), icon: "solar:clock-circle-bold" },
                { value: "date_created", label: t('profiles.sort.dateCreated'), icon: "solar:calendar-add-bold" },
              ]}
              sortValue={sortBy}
              onSortChange={setProfilesTabSortBy}
              filterOptions={[
                { value: "all", label: t('profiles.filter.allVersions'), icon: "solar:layers-bold" },
                { value: "1.21", label: "1.21.x", icon: "solar:gamepad-bold" },
                { value: "1.20", label: "1.20.x", icon: "solar:gamepad-bold" },
                { value: "1.19", label: "1.19.x", icon: "solar:gamepad-bold" },
              ]}
              filterValue={versionFilter}
              onFilterChange={setProfilesTabVersionFilter}
            />
            
                         {/* Layout Toggle Button - Right next to SearchWithFilters */}
                         <button
              onClick={() => {
                const nextMode = layoutMode === "list" ? "grid" : layoutMode === "grid" ? "compact" : "list";
                setProfilesTabLayoutMode(nextMode);
              }}
              className="flex items-center gap-2 px-4 py-2 bg-black/30 hover:bg-black/40 text-white/70 hover:text-white border border-white/10 hover:border-white/20 rounded-lg font-minecraft text-2xl lowercase transition-all duration-200 min-h-[2.5rem]"
              title={
                layoutMode === "list"
                  ? t('profiles.layout.switchToGrid')
                  : layoutMode === "grid"
                  ? t('profiles.layout.switchToCompact')
                  : t('profiles.layout.switchToList')
              }
            >
              <div className="w-4 h-8 flex items-center justify-center">
                <Icon 
                  icon="solar:list-bold"
                  className="w-8 h-8"
                />
              </div>
            </button>
          </div>
          
          <ActionButtons actions={actionButtons} />
        </div>
      </div>

      {/* Profile list */}
      <div className={
        layoutMode === "list" 
          ? "space-y-3"
          : layoutMode === "grid"
          ? "grid grid-cols-2 gap-3" 
          : "grid grid-cols-3 gap-3"
      }>
                 {sortedProfiles.map((profile) => (
           <ProfileCardV2
             key={profile.id}
             profile={profile}
             onSettings={handleSettings}
             onMods={handleMods}
             onDelete={handleDeleteProfile}
             onOpenFolder={handleOpenFolder}
             layoutMode={layoutMode}
           />
         ))}
      </div>

      {/* Bottom tip */}
      </div>

      {/* Modals from ProfilesTab.tsx */}
      {confirmDialog}
    </div>
  );
}
