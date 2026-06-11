"use client";

import { useCallback, useEffect, useState } from "react";
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
import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";
import { usePinnedProfilesStore } from "../../store/usePinnedProfilesStore";
import { setDiscordState } from "../../utils/discordRpc";
import { EditionSwitch, useLauncherEdition } from "../edition/EditionSwitch";
import { useMinecraftAuthStore } from "../../store/minecraft-auth-store";
import type { MinecraftAccount } from "../../types/minecraft";
import { LocalServerService } from "../../services/local-server-service";
import { useCrafatarAvatar } from "../../hooks/useCrafatarAvatar";
import type { BedrockContentKind, BedrockProfile } from "../../types/localServer";
import { convertFileSrc } from "@tauri-apps/api/core";

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
  const { edition } = useLauncherEdition();
  const { activeAccount, initializeAccounts } = useMinecraftAuthStore();
  
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
  
  useEffect(() => { setDiscordState("Managing Profiles"); }, []);

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

  useEffect(() => {
    initializeAccounts().catch(() => {});
  }, [initializeAccounts]);

  if (edition === "bedrock") {
    return (
      <>
        <BedrockProfilesPanel
          activeAccount={activeAccount}
          confirm={confirm}
        />
        {confirmDialog}
      </>
    );
  }

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
      case "version_newest":
        // Sort by Minecraft version descending (newest first), name as tiebreaker
        return (
          (b.game_version || "").localeCompare(a.game_version || "", undefined, { numeric: true }) ||
          a.name.localeCompare(b.name)
        );
      case "version_oldest":
        // Sort by Minecraft version ascending (oldest first), name as tiebreaker
        return (
          (a.game_version || "").localeCompare(b.game_version || "", undefined, { numeric: true }) ||
          a.name.localeCompare(b.name)
        );
      default:
        return a.name.localeCompare(b.name);
    }
  });

  return (
    <div className="h-full flex flex-col overflow-hidden p-4 relative">
      <div className="mb-4 flex items-center justify-end">
        <EditionSwitch />
      </div>
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
                { value: "version_newest", label: t('profiles.sort.versionNewest'), icon: "solar:arrow-down-bold" },
                { value: "version_oldest", label: t('profiles.sort.versionOldest'), icon: "solar:arrow-up-bold" },
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
              dropdownSize="sm"
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

function BedrockProfilesPanel({
  activeAccount,
  confirm,
}: {
  activeAccount: MinecraftAccount | null;
  confirm: (options: any) => Promise<string | boolean>;
}) {
  const { t } = useTranslation();
  const avatarUrl = useCrafatarAvatar({ uuid: activeAccount?.id, size: 96 });
  const [profiles, setProfiles] = useState<BedrockProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [profileName, setProfileName] = useState("");
  const [profileTarget, setProfileTarget] = useState<"release" | "preview">("release");
  const [iconPath, setIconPath] = useState<string | null>(null);
  const [busyProfileId, setBusyProfileId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeTarget, setActiveTarget] = useState("all");
  const [showCreate, setShowCreate] = useState(false);

  const accountName = activeAccount?.minecraft_username || activeAccount?.username || t("bedrock.profiles.playerFallback");

  const loadProfiles = useCallback(async () => {
    setLoading(true);
    try {
      const nextProfiles = await LocalServerService.listBedrockProfiles();
      setProfiles(nextProfiles);
    } catch (error) {
      toast.error(t("bedrock.profiles.loadFailed", { error: String(error) }));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    loadProfiles();
  }, [loadProfiles]);

  const chooseIcon = async () => {
    const selected = await LocalServerService.pickIconFile();
    if (selected) setIconPath(selected);
  };

  const createProfile = async () => {
    const name = profileName.trim() || `${accountName} Bedrock`;
    setCreating(true);
    try {
      const created = await LocalServerService.createBedrockProfile({
        name,
        target: profileTarget,
        iconPath,
      });
      setProfiles((current) => [...current, created].sort((a, b) => a.name.localeCompare(b.name)));
      setProfileName("");
      setIconPath(null);
      setProfileTarget("release");
      setShowCreate(false);
      toast.success(t("bedrock.profiles.created", { name: created.name }));
    } catch (error) {
      toast.error(t("bedrock.profiles.createFailed", { error: String(error) }));
    } finally {
      setCreating(false);
    }
  };

  const launchProfile = async (profile: BedrockProfile) => {
    setBusyProfileId(profile.id);
    try {
      localStorage.setItem("nrc-bedrock-selected-profile-id", profile.id);
      const launched = await LocalServerService.launchBedrockProfile(profile.id);
      setProfiles((current) => current.map((item) => (item.id === launched.id ? launched : item)));
      window.dispatchEvent(new CustomEvent("nrc-bedrock-instance-changed"));
      toast.success(t("bedrock.profiles.launching", { name: profile.name }));
    } catch (error) {
      toast.error(t("bedrock.profiles.launchFailed", { error: String(error) }));
    } finally {
      setBusyProfileId(null);
    }
  };

  const visibleProfiles = profiles
    .filter((profile) => activeTarget === "all" || profile.target === activeTarget)
    .filter((profile) => profile.name.toLowerCase().includes(searchQuery.trim().toLowerCase()))
    .sort((a, b) => new Date(b.lastLaunchedAt || b.createdAt).getTime() - new Date(a.lastLaunchedAt || a.createdAt).getTime());

  const updateTarget = async (profile: BedrockProfile, target: "release" | "preview") => {
    setBusyProfileId(profile.id);
    try {
      const updated = await LocalServerService.updateBedrockProfile(profile.id, { target });
      setProfiles((current) => current.map((item) => (item.id === updated.id ? updated : item)));
    } catch (error) {
      toast.error(t("bedrock.profiles.updateFailed", { error: String(error) }));
    } finally {
      setBusyProfileId(null);
    }
  };

  const importContent = async (profile: BedrockProfile, kind: BedrockContentKind) => {
    const selected = await LocalServerService.pickBedrockContentFile(kind);
    if (!selected) return;

    setBusyProfileId(profile.id);
    try {
      const updated = await LocalServerService.importBedrockProfileContent(profile.id, selected, kind);
      setProfiles((current) => current.map((item) => (item.id === updated.id ? updated : item)));
      toast.success(t("bedrock.profiles.contentImported"));
    } catch (error) {
      toast.error(t("bedrock.profiles.contentFailed", { error: String(error) }));
    } finally {
      setBusyProfileId(null);
    }
  };

  const deleteProfile = async (profile: BedrockProfile) => {
    const confirmed = await confirm({
      title: t("bedrock.profiles.deleteTitle"),
      message: t("bedrock.profiles.deleteMessage", { name: profile.name }),
      confirmText: t("profiles.deleteConfirm"),
      cancelText: t("profiles.cancelAction"),
      type: "danger",
      fullscreen: true,
    });

    if (confirmed !== true) return;
    setBusyProfileId(profile.id);
    try {
      await LocalServerService.deleteBedrockProfile(profile.id);
      setProfiles((current) => current.filter((item) => item.id !== profile.id));
      toast.success(t("bedrock.profiles.deleted", { name: profile.name }));
    } catch (error) {
      toast.error(t("bedrock.profiles.deleteFailed", { error: String(error) }));
    } finally {
      setBusyProfileId(null);
    }
  };

  return (
    <div className="h-full flex flex-col overflow-hidden p-4 relative">
      <div className="mb-4 flex items-center justify-end"><EditionSwitch /></div>
      <div className="flex-1 min-h-0 overflow-y-auto no-scrollbar">
        <GroupTabs
          groups={[
            { id: "all", name: t("profiles.all", { defaultValue: "Alle" }), count: profiles.length },
            { id: "release", name: "Release", count: profiles.filter((profile) => profile.target === "release").length },
            { id: "preview", name: "Preview", count: profiles.filter((profile) => profile.target === "preview").length },
          ]}
          activeGroup={activeTarget}
          onGroupChange={setActiveTarget}
          showAddButton={false}
        />

        <div className="mb-6 pb-4 border-b border-white/10 flex items-center gap-4">
          <SearchWithFilters
            placeholder={t("profiles.searchProfiles")}
            searchValue={searchQuery}
            onSearchChange={setSearchQuery}
            sortOptions={[]}
            sortValue="last_played"
            onSortChange={() => {}}
            filterOptions={[]}
            filterValue="all"
            onFilterChange={() => {}}
            dropdownSize="sm"
          />
          <div className="ml-auto">
            <ActionButtons actions={[{
              id: "create-bedrock",
              label: t("profiles.create").toUpperCase(),
              icon: "solar:widget-add-bold",
              tooltip: t("profiles.createNewProfile"),
              onClick: () => setShowCreate(true),
            }]} />
          </div>
        </div>

        {loading ? (
          <LoadingState message={t("bedrock.profiles.loading")} />
        ) : visibleProfiles.length === 0 ? (
          <EmptyState icon="solar:box-bold" message={t("bedrock.profiles.empty")} />
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {visibleProfiles.map((profile) => (
              <BedrockProfileCard
                key={profile.id}
                profile={profile}
                busy={busyProfileId === profile.id}
                onLaunch={() => launchProfile(profile)}
                onDelete={() => deleteProfile(profile)}
                onTargetChange={(target) => updateTarget(profile, target)}
                onImportContent={(kind) => importContent(profile, kind)}
              />
            ))}
          </div>
        )}
      </div>

      {showCreate && (
        <div className="fixed inset-0 z-[120] bg-black/70 backdrop-blur-sm flex items-center justify-center p-8" onClick={() => setShowCreate(false)}>
          <div className="w-full max-w-lg rounded-xl border border-white/15 bg-[#101218] p-5 shadow-2xl" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-center justify-between mb-5">
              <div className="flex items-center gap-3">
                <div className="w-14 h-14 rounded-xl border border-white/15 bg-white/10 overflow-hidden flex items-center justify-center">
                  {iconPath ? <img src={convertFileSrc(iconPath)} alt="" className="w-full h-full object-cover" /> : avatarUrl ? <img src={avatarUrl} alt="" className="w-full h-full object-cover" /> : <Icon icon="solar:box-bold" className="w-7 h-7 text-white/60" />}
                </div>
                <div><h2 className="font-minecraft text-white text-3xl normal-case">{t("bedrock.profiles.create")}</h2><p className="font-minecraft-ten text-white/40 text-xs">{accountName}</p></div>
              </div>
              <button type="button" onClick={() => setShowCreate(false)} className="w-9 h-9 rounded-full hover:bg-white/10 text-white/60 flex items-center justify-center"><Icon icon="solar:close-circle-bold" /></button>
            </div>
            <label className="block font-minecraft-ten text-white/55 text-sm mb-2">{t("bedrock.profiles.name")}</label>
            <input value={profileName} onChange={(event) => setProfileName(event.target.value)} placeholder={t("bedrock.profiles.namePlaceholder")} className="w-full h-11 rounded-lg border border-white/10 bg-black/35 px-3 font-minecraft-ten text-white outline-none focus:border-white/25" />
            <label className="block font-minecraft-ten text-white/55 text-sm mt-4 mb-2">{t("bedrock.profiles.version")}</label>
            <div className="grid grid-cols-2 gap-2">
              {(["release", "preview"] as const).map((target) => <button key={target} type="button" onClick={() => setProfileTarget(target)} className={`h-10 rounded-lg border font-minecraft-ten text-sm ${profileTarget === target ? "border-white/35 bg-white/15 text-white" : "border-white/10 bg-white/5 text-white/55"}`}>{t(`bedrock.target.${target}`)}</button>)}
            </div>
            <button type="button" onClick={chooseIcon} className="mt-4 w-full h-11 rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 text-white/70 font-minecraft-ten text-sm flex items-center justify-center gap-2"><Icon icon="solar:gallery-add-bold" />{iconPath ? t("bedrock.profiles.iconSelected") : t("bedrock.profiles.chooseIcon")}</button>
            <button type="button" onClick={createProfile} disabled={creating} className="mt-5 w-full h-12 rounded-xl border border-emerald-400/40 bg-emerald-500/20 hover:bg-emerald-500/30 disabled:opacity-50 text-white font-minecraft-ten flex items-center justify-center gap-2"><Icon icon={creating ? "solar:refresh-bold" : "solar:add-circle-bold"} className={creating ? "animate-spin" : ""} />{t("bedrock.profiles.create")}</button>
          </div>
        </div>
      )}
    </div>
  );
}

function BedrockProfileCard({
  profile,
  busy,
  onLaunch,
  onDelete,
  onTargetChange,
  onImportContent,
}: {
  profile: BedrockProfile;
  busy: boolean;
  onLaunch: () => void;
  onDelete: () => void;
  onTargetChange: (target: "release" | "preview") => void;
  onImportContent: (kind: BedrockContentKind) => void;
}) {
  const { t } = useTranslation();
  const iconSrc = profile.iconPath
    ? profile.iconPath.startsWith("http") || profile.iconPath.startsWith("/")
      ? profile.iconPath
      : convertFileSrc(profile.iconPath)
    : null;
  const lastLaunch = profile.lastLaunchedAt
    ? new Date(profile.lastLaunchedAt).toLocaleString()
    : t("bedrock.profiles.neverLaunched");

  return (
    <article className="border border-white/10 bg-black/30 rounded-xl p-4 min-h-[190px] flex flex-col">
      <div className="flex items-start gap-3">
        <div className="w-16 h-16 rounded-xl border border-white/15 bg-white/10 overflow-hidden flex items-center justify-center">
          {iconSrc ? (
            <img src={iconSrc} alt="" className="w-full h-full object-cover" />
          ) : (
            <Icon icon="solar:box-bold" className="w-8 h-8 text-white/65" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="font-minecraft-ten text-white text-xl truncate">{profile.name}</h2>
          <p className="font-minecraft-ten text-white/45 text-xs mt-1">{t("bedrock.profiles.lastLaunch", { date: lastLaunch })}</p>
          <div className="mt-3 inline-flex rounded-lg border border-white/10 bg-black/30 p-1">
            {(["release", "preview"] as const).map((target) => (
              <button
                key={target}
                type="button"
                disabled={busy || profile.target === target}
                onClick={() => onTargetChange(target)}
                className={`h-8 px-3 rounded-md font-minecraft-ten text-xs transition-colors ${
                  profile.target === target ? "bg-white/15 text-white" : "text-white/45 hover:text-white hover:bg-white/10"
                }`}
              >
                {t(`bedrock.target.${target}`)}
              </button>
            ))}
          </div>
        </div>
        <div className="flex flex-col gap-2">
          <button type="button" onClick={onDelete} disabled={busy} className="w-9 h-9 rounded-full border border-white/10 bg-white/5 hover:bg-red-500/20 text-white/55 hover:text-white flex items-center justify-center disabled:opacity-50" title={t("profiles.delete")}><Icon icon="solar:trash-bin-trash-bold" className="w-4 h-4" /></button>
          <button type="button" onClick={() => onImportContent("addon")} disabled={busy} className="w-9 h-9 rounded-full border border-white/10 bg-white/5 hover:bg-white/10 text-white/55 hover:text-white flex items-center justify-center disabled:opacity-50" title={t("bedrock.content.addon")}><Icon icon="solar:box-minimalistic-bold" className="w-4 h-4" /></button>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-3 gap-2">
        <MiniStat label={t("bedrock.profiles.addons")} value={String(profile.installedContent.filter((item) => item.kind === "addon").length)} />
        <MiniStat label={t("bedrock.profiles.packs")} value={String(profile.installedContent.filter((item) => item.kind === "resourcepack").length)} />
        <MiniStat label={t("bedrock.profiles.worlds")} value={String(profile.installedContent.filter((item) => item.kind === "world").length)} />
      </div>

      <button
        type="button"
        onClick={onLaunch}
        disabled={busy}
        className="mt-4 h-11 rounded-xl border border-emerald-400/40 bg-emerald-500/20 hover:bg-emerald-500/30 disabled:opacity-50 text-white font-minecraft-ten text-base flex items-center justify-center gap-2 transition-colors"
      >
        <Icon icon={busy ? "solar:refresh-bold" : "solar:play-bold"} className={`w-5 h-5 ${busy ? "animate-spin" : ""}`} />
        {t("bedrock.profiles.play")}
      </button>
    </article>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/5 px-3 py-2">
      <p className="font-minecraft-ten text-white/35 text-[11px] uppercase">{label}</p>
      <p className="font-minecraft-ten text-white text-base">{value}</p>
    </div>
  );
}
