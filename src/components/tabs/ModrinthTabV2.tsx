"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ModrinthSearchV2 } from "../modrinth/v2/ModrinthSearchV2"; // Adjusted import path
import type { Profile } from "../../types/profile";
import { getAllProfilesAndLastPlayed } from "../../services/profile-service";
import { ErrorMessage } from "../ui/ErrorMessage";
import { setDiscordState } from "../../utils/discordRpc";
import { EditionSwitch, useLauncherEdition } from "../edition/EditionSwitch";
import { Icon } from "@iconify/react";
import { toast } from "react-hot-toast";
import { LocalServerService } from "../../services/local-server-service";
import type { BedrockCatalogResult, BedrockContentKind, BedrockProfile } from "../../types/localServer";
import { openExternalUrl } from "../../services/tauri-service";
// import { LoadingOverlay } from "../ui/LoadingOverlay"; // Removed
// import { Card } from "../ui/Card"; // Card might not be directly needed here anymore
// import { useThemeStore } from "../../store/useThemeStore"; // Theme store might be used by sub-components
// import { ModrinthFilters } from "../modrinth/ModrinthFilters"; // Filters will be part of ModrinthSearchV2 or a new V2 component
// import type { ModrinthProjectType } from "../../types/modrinth"; // ProjectType will be managed within ModrinthSearchV2

interface ModrinthTabV2Props {
  profiles?: Profile[];
}

export function ModrinthTabV2({
  profiles: initialProfiles = [],
}: ModrinthTabV2Props) {
  const [error, setError] = useState<string | null>(null);
  // const [refreshKey, setRefreshKey] = useState(0); // May or may not be needed depending on V2 search interaction
  const [profiles, setProfiles] = useState<Profile[]>(initialProfiles);
  const [profilesLoaded, setProfilesLoaded] = useState(initialProfiles.length > 0);
  const { edition } = useLauncherEdition();

  useEffect(() => { setDiscordState("Browsing Mods"); }, []);

  // const [isLoading, setIsLoading] = useState(initialProfiles.length === 0); // Removed
  // const [loadingProgress, setLoadingProgress] = useState(0); // Removed

  useEffect(() => {
    // Only load profiles if they haven't been loaded yet
    if (initialProfiles.length === 0 && !profilesLoaded) {
      const loadProfiles = async () => {
        try {
          const fetched = await getAllProfilesAndLastPlayed();
          setProfiles(fetched.all_profiles);
        } catch (err) {
          console.error("Failed to load profiles:", err);
          setError(
            `Failed to load profiles: ${err instanceof Error ? err.message : String(err)}`,
          );
        } finally {
          setProfilesLoaded(true);
        }
      };

      // Use requestIdleCallback for non-critical loading if available
      if (typeof window !== "undefined" && "requestIdleCallback" in window) {
        (window as any).requestIdleCallback(loadProfiles);
      } else {
        // Fallback to setTimeout with a small delay
        setTimeout(loadProfiles, 10);
      }
    }
  }, [initialProfiles, profilesLoaded]);

  const handleInstallSuccess = useCallback(() => {
    // This might trigger a refresh of profile list or other UI elements
    // setRefreshKey((prev) => prev + 1);
    // Potentially reload profiles if an installation changes them
    // getAllProfilesAndLastPlayed().then(res => setProfiles(res.all_profiles)).catch(err => console.error("Failed to refresh profiles after install", err));
  }, []);

  // Memoize the ModrinthSearchV2 component to prevent unnecessary re-renders
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

  if (initialProfiles.length === 0 && !profilesLoaded) {
    // Still loading profiles, can show a minimal loading state or null
    // For direct display, we might return null or a very simple placeholder
    // Or, ensure profiles are loaded before rendering ModrinthSearchV2
    return null; // Or a minimal loader if preferred, but goal is direct display
  }

  return (
    <div className="h-full flex flex-col overflow-hidden p-4 relative">
      <div className="mb-4 flex items-center justify-between gap-4">
        <div className="font-minecraft text-white/80 text-3xl">Mods</div>
        <EditionSwitch />
      </div>

      {edition === "bedrock" ? (
        <BedrockModsPanel />
      ) : (
        <>
      {/* <LoadingOverlay // Removed
        isLoading={isLoading}
        message={loadingMessage}
        progress={loadingProgress}
        variant="default"
        shadowDepth="default"
      /> */}

      {error && <ErrorMessage message={error} />}

      <div className="flex-1 overflow-hidden flex space-x-4">
        <div className="flex-1 overflow-hidden">{memoizedSearch}</div>
        {/**
          Filters are now intended to be part of ModrinthSearchV2 or a new ModrinthFiltersV2.
          If ModrinthFiltersV2 is separate, it would be placed here or within ModrinthSearchV2 layout.
          For now, assuming filters are integrated or will be added to ModrinthSearchV2 itself.
        */}
        {/**
        <div className="w-1/4 max-w-xs flex-shrink-0">
          <ModrinthFiltersV2 ... />
        </div>
        */}
      </div>
        </>
      )}
    </div>
  );
}

export default ModrinthTabV2;

function BedrockModsPanel() {
  const { t } = useTranslation();
  const [profiles, setProfiles] = useState<BedrockProfile[]>([]);
  const [selectedProfileId, setSelectedProfileId] = useState("");
  const [activeKind, setActiveKind] = useState<BedrockContentKind>("addon");
  const [query, setQuery] = useState("");
  const [catalogResults, setCatalogResults] = useState<BedrockCatalogResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [installingProjectId, setInstallingProjectId] = useState<string | null>(null);
  const [loadingProfiles, setLoadingProfiles] = useState(true);
  const selectedProfile = profiles.find((profile) => profile.id === selectedProfileId) ?? profiles[0] ?? null;

  const loadProfiles = useCallback(async () => {
    setLoadingProfiles(true);
    try {
      const nextProfiles = await LocalServerService.listBedrockProfiles();
      setProfiles(nextProfiles);
      if (!selectedProfileId && nextProfiles[0]) {
        setSelectedProfileId(nextProfiles[0].id);
      }
    } catch (error) {
      toast.error(t("bedrock.mods.loadProfilesFailed", { error: String(error) }));
    } finally {
      setLoadingProfiles(false);
    }
  }, [selectedProfileId, t]);

  useEffect(() => {
    loadProfiles();
  }, [loadProfiles]);

  const importLocal = async () => {
    if (!selectedProfile) {
      toast.error(t("bedrock.mods.noProfile"));
      return;
    }

    const selected = await LocalServerService.pickBedrockContentFile(activeKind);
    if (!selected) return;

    try {
      const updated = await LocalServerService.importBedrockProfileContent(selectedProfile.id, selected, activeKind);
      setProfiles((current) => current.map((profile) => (profile.id === updated.id ? updated : profile)));
      toast.success(t("bedrock.mods.imported"));
    } catch (error) {
      toast.error(t("bedrock.mods.importFailed", { error: String(error) }));
    }
  };

  const searchCatalog = async () => {
    const trimmedQuery = query.trim();
    if (!trimmedQuery) return;

    setSearching(true);
    try {
      setCatalogResults(await LocalServerService.searchBedrockCatalog(trimmedQuery, activeKind));
    } catch (error) {
      toast.error(t("bedrock.mods.searchFailed", { error: String(error) }));
    } finally {
      setSearching(false);
    }
  };

  const installCatalogResult = async (result: BedrockCatalogResult) => {
    if (!selectedProfile) {
      toast.error(t("bedrock.mods.noProfile"));
      return;
    }
    if (!result.downloadAvailable) {
      await openExternalUrl(result.projectUrl);
      return;
    }
    setInstallingProjectId(result.projectId);
    try {
      const updated = await LocalServerService.installBedrockCatalogProject(selectedProfile.id, result.projectId, activeKind);
      setProfiles((current) => current.map((profile) => profile.id === updated.id ? updated : profile));
      toast.success(t("bedrock.mods.imported"));
    } catch (error) {
      toast.error(t("bedrock.mods.importFailed", { error: String(error) }));
    } finally {
      setInstallingProjectId(null);
    }
  };

  const content = selectedProfile?.installedContent.filter((item) => item.kind === activeKind) ?? [];

  return (
    <div className="flex-1 min-h-0 flex flex-col gap-4">
      <div className="flex items-center gap-2 border-b border-white/10 pb-4">
        {(["addon", "resourcepack", "world", "skinpack"] as BedrockContentKind[]).map((kind) => (
          <button key={kind} type="button" onClick={() => { setActiveKind(kind); setCatalogResults([]); }} className={`h-11 px-5 rounded-lg border font-minecraft-ten text-sm transition-colors ${activeKind === kind ? "border-white/35 bg-white/15 text-white" : "border-white/10 bg-white/5 text-white/55 hover:text-white hover:bg-white/10"}`}>
            {t(`bedrock.content.${kind}`)}
          </button>
        ))}
        <div className="ml-auto inline-flex items-center gap-2 rounded-full border border-orange-400/30 bg-orange-500/10 px-4 py-2 font-minecraft-ten text-xs text-orange-100/80">
          <Icon icon="simple-icons:curseforge" className="w-4 h-4" /> CurseForge Bedrock
        </div>
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)_290px] gap-4 min-h-0 flex-1">
      <main className="border border-white/10 bg-black/25 rounded-xl p-4 min-h-0 flex flex-col order-1">
        <div className="flex items-center gap-3">
          <div className="flex-1 h-12 rounded-xl border border-white/10 bg-black/35 px-4 flex items-center gap-3">
            <Icon icon="solar:magnifer-bold" className="w-5 h-5 text-white/35" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") searchCatalog();
              }}
              placeholder={t("bedrock.mods.searchPlaceholder")}
              className="flex-1 bg-transparent outline-none font-minecraft-ten text-white placeholder:text-white/30"
            />
          </div>
          <button
            type="button"
            onClick={searchCatalog}
            disabled={searching || !query.trim()}
            className="h-12 px-5 rounded-xl border border-white/15 bg-white/10 hover:bg-white/15 disabled:opacity-50 text-white font-minecraft-ten text-base flex items-center gap-2 transition-colors"
          >
            <Icon icon={searching ? "solar:refresh-bold" : "solar:magnifer-bold"} className={`w-5 h-5 ${searching ? "animate-spin" : ""}`} />
            {t("bedrock.mods.search")}
          </button>
        </div>

        <div className="mt-4 rounded-xl border border-amber-400/20 bg-amber-500/10 px-4 py-3 font-minecraft-ten text-amber-100/80 text-sm">
          {t("bedrock.mods.curseforgeNotice")}
        </div>

        <div className="mt-4 flex-1 min-h-0 overflow-y-auto custom-scrollbar space-y-2">
          {catalogResults.length === 0 ? (
            <EmptyBedrockCatalogMessage />
          ) : (
            catalogResults.map((result) => (
              <div key={result.projectId} className="rounded-xl border border-white/10 bg-white/5 p-3 flex gap-3">
                {result.iconUrl ? (
                  <img src={result.iconUrl} alt="" className="w-14 h-14 rounded-lg object-cover" />
                ) : (
                  <div className="w-14 h-14 rounded-lg border border-white/10 bg-black/30 flex items-center justify-center">
                    <Icon icon="solar:gallery-bold" className="w-7 h-7 text-white/45" />
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <h3 className="font-minecraft-ten text-white text-lg truncate">{result.title}</h3>
                  {result.author && <p className="font-minecraft-ten text-white/35 text-xs truncate">von {result.author}</p>}
                  <p className="font-minecraft-ten text-white/45 text-sm line-clamp-2">{result.description}</p>
                  <p className="font-minecraft-ten text-white/30 text-xs mt-1">{t("bedrock.mods.downloads", { count: result.downloads })}</p>
                </div>
                <button
                  type="button"
                  onClick={() => void installCatalogResult(result)}
                  disabled={installingProjectId === result.projectId}
                  className="self-center h-10 px-4 rounded-lg border border-white/15 bg-white/10 hover:bg-white/15 disabled:opacity-50 text-white font-minecraft-ten text-sm flex items-center gap-2"
                  title={result.downloadAvailable ? t("bedrock.mods.install") : t("bedrock.mods.installUnavailable")}
                >
                  <Icon icon={installingProjectId === result.projectId ? "solar:refresh-bold" : result.downloadAvailable ? "solar:download-bold" : "solar:square-arrow-right-up-bold"} className={installingProjectId === result.projectId ? "animate-spin" : ""} />
                  {result.downloadAvailable ? t("bedrock.mods.install") : t("common.open", { defaultValue: "Öffnen" })}
                </button>
              </div>
            ))
          )}
        </div>
      </main>
      <aside className="order-2 border border-white/10 bg-black/35 rounded-xl p-4 min-h-0 overflow-y-auto custom-scrollbar">
        <h2 className="font-minecraft-ten text-white text-lg mb-3">{t("bedrock.mods.profile")}</h2>
        <select value={selectedProfile?.id ?? ""} onChange={(event) => setSelectedProfileId(event.target.value)} className="w-full h-11 rounded-lg border border-white/10 bg-black/40 px-3 font-minecraft-ten text-white outline-none">
          {loadingProfiles ? <option>{t("bedrock.mods.loadingProfiles")}</option> : profiles.length === 0 ? <option>{t("bedrock.mods.noProfiles")}</option> : profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}
        </select>
        <button type="button" onClick={importLocal} disabled={!selectedProfile} className="mt-4 w-full h-11 rounded-xl border border-emerald-400/40 bg-emerald-500/20 hover:bg-emerald-500/30 disabled:opacity-50 text-white font-minecraft-ten text-sm flex items-center justify-center gap-2 transition-colors"><Icon icon="solar:upload-bold" className="w-4 h-4" />{t("bedrock.mods.importLocal")}</button>
        <div className="mt-5 border-t border-white/10 pt-4">
          <div className="flex items-center justify-between"><p className="font-minecraft-ten text-white/65 text-sm">{t("bedrock.mods.installed")}</p><span className="font-minecraft-ten text-white/35 text-xs">{content.length}</span></div>
          <div className="mt-2 space-y-2">
            {content.length === 0 ? <p className="font-minecraft-ten text-white/35 text-sm">{t("bedrock.mods.emptyKind")}</p> : content.map((item) => <div key={`${item.kind}-${item.fileName}`} className="rounded-lg border border-white/10 bg-white/5 px-3 py-2"><p className="font-minecraft-ten text-white text-sm truncate">{item.name}</p><p className="font-minecraft-ten text-white/35 text-xs truncate">{item.fileName}</p></div>)}
          </div>
        </div>
      </aside>
      </div>
    </div>
  );
}

function EmptyBedrockCatalogMessage() {
  const { t } = useTranslation();
  return (
    <div className="h-full flex items-center justify-center text-center">
      <div>
        <Icon icon="solar:box-bold" className="w-14 h-14 mx-auto text-white/30 mb-3" />
        <p className="font-minecraft-ten text-white/55 text-lg">{t("bedrock.mods.catalogEmpty")}</p>
        <p className="font-minecraft-ten text-white/35 text-sm mt-1">{t("bedrock.mods.catalogHint")}</p>
      </div>
    </div>
  );
}
