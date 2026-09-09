"use client";

import { useEffect, useMemo, useState } from "react";
import { Virtuoso } from "react-virtuoso";
import type { Profile } from "../../types/profile";
import { useProfileStore } from "../../store/profile-store";
import { LoadingState } from "../ui/LoadingState";
import { EmptyState } from "../ui/EmptyState";
import { Button } from "../ui/buttons/Button";

import { ProfileCardV2 } from "../profiles/ProfileCardV2";
import { toast } from "react-hot-toast";
import { SearchWithFilters } from "../ui/SearchWithFilters";
import { MultiVersionFilter } from "../ui/MultiVersionFilter";
import { GroupTabs, type GroupTab } from "../ui/GroupTabs";
import { ActionButtons, type ActionButton } from "../ui/ActionButtons";
import { useNavigate } from "react-router-dom";
import * as ProfileService from "../../services/profile-service";
import { useConfirmDialog } from "../../hooks/useConfirmDialog";
import { useProfileWizardStore } from "../../store/profile-wizard-store";
import { useThemeStore } from "../../store/useThemeStore";
import { ExportProfileModal } from "../profiles/ExportProfileModal";
import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";
import { usePinnedProfilesStore } from "../../store/usePinnedProfilesStore";
import { setDiscordState } from "../../utils/discordRpc";
import { parseErrorMessage } from "../../utils/error-utils";

// A vertical virtualizer row: a version-section divider header, or a row of up to N cards.
type VirtualRow =
  | { type: "cards"; profiles: Profile[] }
  | { type: "header"; version: string };

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
  const { isPinned, pinnedProfileIds } = usePinnedProfilesStore();
  
  // Persistent filters from theme store
  const {
    profilesTabActiveGroup,
    profilesTabSortBy,
    profilesTabVersionFilters,
    profilesTabLayoutMode,
    setProfilesTabActiveGroup,
    setProfilesTabSortBy,
    setProfilesTabVersionFilters,
    toggleProfilesTabVersionFilter,
    setProfilesTabLayoutMode,
  } = useThemeStore();
  
  useEffect(() => { setDiscordState("Managing Profiles"); }, []);

  // Local non-persistent state
  const [searchQuery, setSearchQuery] = useState("");
  
  // Use persistent values instead of local state
  const activeGroup = profilesTabActiveGroup;
  const sortBy = profilesTabSortBy;
  const selectedVersions = profilesTabVersionFilters;
  const layoutMode = profilesTabLayoutMode;

  // Action buttons configuration
  const actionButtons: ActionButton[] = [
    {
      id: "create",
      label: t('profiles.create'),
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

  // Reduce a full game version to its major bucket, e.g. "1.21.10" -> "1.21", "26.1.2" -> "26.1"
  const toVersionMajor = (version?: string | null): string => {
    if (!version) return "?";
    const parts = version.split(".");
    return parts.length >= 2 ? `${parts[0]}.${parts[1]}` : parts[0];
  };

  // Whether a profile belongs to the currently active group tab.
  const profileMatchesActiveGroup = (profile: Profile): boolean =>
    activeGroup === "all" ||
    (activeGroup === "nrc" && isNrcGroup(profile.group)) ||
    (activeGroup === "server" && profile.group === "SERVER") ||
    (activeGroup === "modpacks" && profile.group === "MODPACKS") ||
    (!!profile.group && profile.group.toLowerCase() === activeGroup);

  // Major version buckets present in the active group, with counts, sorted newest-first.
  const getVersionFilterOptions = (): { value: string; count: number }[] => {
    const counts = new Map<string, number>();
    profiles.filter(profileMatchesActiveGroup).forEach((p) => {
      const major = toVersionMajor(p.game_version);
      counts.set(major, (counts.get(major) ?? 0) + 1);
    });
    return Array.from(counts.entries())
      .sort((a, b) => b[0].localeCompare(a[0], undefined, { numeric: true }))
      .map(([value, count]) => ({ value, count }));
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
          t('profiles.deleteError', { error: parseErrorMessage(err) }),
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
        const message = parseErrorMessage(err);
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

  // Columns per layout mode (also used by the virtual grid).
  const columnCount = layoutMode === "grid" ? 2 : layoutMode === "compact" ? 3 : 1;

  // Filter -> sort (memoized; avoids re-running on unrelated re-renders like hover).
  const filteredProfiles = useMemo(
    () =>
      profiles.filter((profile) => {
        const q = searchQuery.toLowerCase();
        const matchesSearch =
          searchQuery === "" ||
          profile.name.toLowerCase().includes(q) ||
          (!!profile.group && profile.group.toLowerCase().includes(q));
        const matchesVersion =
          selectedVersions.length === 0 ||
          selectedVersions.includes(toVersionMajor(profile.game_version));
        return matchesSearch && profileMatchesActiveGroup(profile) && matchesVersion;
      }),
    [profiles, searchQuery, activeGroup, selectedVersions],
  );

  const sortedProfiles = useMemo(
    () =>
      [...filteredProfiles].sort((a, b) => {
        const aPinned = isPinned(a.id);
        const bPinned = isPinned(b.id);
        if (aPinned !== bPinned) return aPinned ? -1 : 1;

        switch (sortBy) {
          case "name":
            return a.name.localeCompare(b.name);
          case "last_played": {
            const at = a.last_played ? new Date(a.last_played).getTime() : 0;
            const bt = b.last_played ? new Date(b.last_played).getTime() : 0;
            if (bt !== at) return bt - at;
            const ac = new Date(a.created).getTime();
            const bc = new Date(b.created).getTime();
            if (bc !== ac) return bc - ac;
            return a.name.localeCompare(b.name);
          }
          case "date_created":
            return new Date(b.created).getTime() - new Date(a.created).getTime();
          case "version_newest":
            return (
              (b.game_version || "").localeCompare(a.game_version || "", undefined, { numeric: true }) ||
              a.name.localeCompare(b.name)
            );
          case "version_oldest":
            return (
              (a.game_version || "").localeCompare(b.game_version || "", undefined, { numeric: true }) ||
              a.name.localeCompare(b.name)
            );
          default:
            return a.name.localeCompare(b.name);
        }
      }),
    [filteredProfiles, sortBy, pinnedProfileIds],
  );

  // Build vertical virtualizer rows: one row = a divider header OR a row of up to `columnCount`
  // cards. Plain Virtuoso measures each row, so scrolling is reliable for variable-height cards
  // (VirtuosoGrid's grid measurement was undercounting and blocking scroll).
  const virtualRows = useMemo<VirtualRow[]>(() => {
    const chunk = (list: Profile[]): VirtualRow[] => {
      const out: VirtualRow[] = [];
      for (let i = 0; i < list.length; i += columnCount) {
        out.push({ type: "cards", profiles: list.slice(i, i + columnCount) });
      }
      return out;
    };

    if (selectedVersions.length === 0) return chunk(sortedProfiles);

    const sections = new Map<string, Profile[]>();
    sortedProfiles.forEach((profile) => {
      const major = toVersionMajor(profile.game_version);
      if (!sections.has(major)) sections.set(major, []);
      sections.get(major)!.push(profile);
    });
    const ordered = Array.from(sections.entries()).sort((a, b) =>
      b[0].localeCompare(a[0], undefined, { numeric: true }),
    );
    const out: VirtualRow[] = [];
    ordered.forEach(([version, list]) => {
      out.push({ type: "header", version });
      out.push(...chunk(list));
    });
    return out;
  }, [sortedProfiles, selectedVersions, columnCount]);

  const gridColsClass = columnCount === 3 ? "grid-cols-3" : columnCount === 2 ? "grid-cols-2" : "grid-cols-1";

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
        action={
          <Button
            variant="default"
            size="md"
            onClick={() => openWizard(null)}
            icon={<Icon icon="solar:widget-add-bold" className="w-5 h-5" />}
          >
            {t('profiles.createNewProfile')}
          </Button>
        }
      />
    );
  }

  return (
    <div className="h-full flex flex-col overflow-hidden p-4 relative">
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
                { value: "version_newest", label: t('profiles.sort.versionNewest'), icon: "solar:arrow-down-bold" },
                { value: "version_oldest", label: t('profiles.sort.versionOldest'), icon: "solar:arrow-up-bold" },
              ]}
              sortValue={sortBy}
              onSortChange={setProfilesTabSortBy}
              dropdownSize="sm"
              filterSlot={
                <MultiVersionFilter
                  options={getVersionFilterOptions()}
                  selected={selectedVersions}
                  onToggle={toggleProfilesTabVersionFilter}
                  onClear={() => setProfilesTabVersionFilters([])}
                  size="sm"
                />
              }
            />

                         {/* Layout Toggle Button - Right next to SearchWithFilters */}
                         <button
              onClick={() => {
                const nextMode = layoutMode === "list" ? "grid" : layoutMode === "grid" ? "compact" : "list";
                setProfilesTabLayoutMode(nextMode);
              }}
              className="flex items-center gap-2 px-4 py-2 bg-black/30 hover:bg-black/40 text-white/70 hover:text-white border border-white/10 hover:border-white/20 rounded-lg font-smallcaps text-base transition-all duration-200 min-h-[2.5rem]"
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

      {/* Virtualized profile list. Version-divider headers appear only while a version filter is active. */}
      <div className="flex-1 min-h-0 h-full">
        {virtualRows.length === 0 ? (
          <EmptyState icon="solar:widget-bold" message={t('profiles.noProfilesFound')} />
        ) : (
          <Virtuoso
            data={virtualRows}
            className="custom-scrollbar"
            style={{ height: "100%" }}
            itemContent={(_index, row) => {
              if (row.type === "header") {
                return (
                  // Version divider header, e.g. "── 26.1 ──────────────"
                  <div className="flex items-center gap-3 mb-3">
                    <div className="h-px w-6 bg-white/10" />
                    <span className="font-smallcaps text-base text-white/60 whitespace-nowrap">
                      {row.version}
                    </span>
                    <div className="h-px flex-1 bg-white/10" />
                  </div>
                );
              }
              return (
                <div className={`grid ${gridColsClass} gap-3 mb-3`}>
                  {row.profiles.map((profile) => (
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
              );
            }}
          />
        )}
      </div>

      {/* Modals from ProfilesTab.tsx */}
      {confirmDialog}
    </div>
  );
}
