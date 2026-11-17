import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@iconify/react";
import { invoke } from "@tauri-apps/api/core";
import { gsap } from "gsap";
import { useTranslation } from "react-i18next";

import type { ModLoader, Profile } from "../../../types/profile";
import type { MinecraftVersion } from "../../../types/minecraft";
import { useResolvedLoaderVersion } from "../../../hooks/useResolvedLoaderVersion";
import { useThemeStore } from "../../../store/useThemeStore";
import { StatusMessage } from "../../ui/StatusMessage";
import { Chip, Section } from "./SettingsSection";
import { Combobox } from "../../ui/Combobox";
import { ToggleSwitch } from "../../ui/ToggleSwitch";
import { cn } from "../../../lib/utils";
import { parseErrorMessage } from "../../../utils/error-utils";
import { withoutStableTag } from "../../../utils/loader-version";

interface InstallationSettingsTabProps {
  profile: Profile;
  editedProfile: Profile;
  updateProfile: (updates: Partial<Profile>) => void;
  refreshTrigger?: number;
}

type VersionType = "release" | "snapshot" | "old_beta" | "old_alpha";

const VERSION_TYPES: { value: VersionType; labelKey: string }[] = [
  { value: "release", labelKey: "profiles.settings.release" },
  { value: "snapshot", labelKey: "profiles.settings.snapshot" },
  { value: "old_beta", labelKey: "profiles.settings.oldBeta" },
  { value: "old_alpha", labelKey: "profiles.settings.oldAlpha" },
];

const RECENT_FAMILIES = 8;
const LATEST_LOADER_VERSION = "latest";

const LOADERS: { name: ModLoader; label: string; icon: string; since?: string }[] = [
  { name: "vanilla", label: "Vanilla", icon: "/icons/minecraft.png" },
  { name: "fabric", label: "Fabric", icon: "/icons/fabric.png", since: "1.14" },
  { name: "forge", label: "Forge", icon: "/icons/forge.png" },
  { name: "quilt", label: "Quilt", icon: "/icons/quilt.png", since: "1.14" },
  { name: "neoforge", label: "NeoForge", icon: "/icons/neoforge.png", since: "1.20.1" },
];

function loaderOf(name: string) {
  return LOADERS.find((loader) => loader.name === name) ?? LOADERS[0];
}

function isVersionNewerOrEqual(version: string, baseVersion: string): boolean {
  const parse = (v: string) => v.split(".").map((part) => Number.parseInt(part) || 0);
  const [a, b] = [parse(version), parse(baseVersion)];
  for (let i = 0; i < 3; i++) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0);
  }
  return true;
}

function isLoaderCompatible(loader: string, gameVersion: string): boolean {
  const since = loaderOf(loader).since;
  return !since || isVersionNewerOrEqual(gameVersion, since);
}

function familyOf(versionId: string): string {
  const parts = versionId.split(".");
  return parts[0] === "1" ? parts.slice(0, 2).join(".") : parts[0];
}

async function fetchLoaderVersions(loader: string, minecraftVersion: string): Promise<string[]> {
  switch (loader) {
    case "fabric":
      return (
        await invoke<{ loader: { version: string } }[]>("get_fabric_loader_versions", { minecraftVersion })
      ).map((v) => v.loader.version);
    case "quilt":
      return (
        await invoke<{ loader: { version: string } }[]>("get_quilt_loader_versions", { minecraftVersion })
      ).map((v) => v.loader.version);
    case "forge":
      return invoke<string[]>("get_forge_versions", { minecraftVersion });
    case "neoforge":
      return invoke<string[]>("get_neoforge_versions", { minecraftVersion });
    default:
      return [];
  }
}

export function InstallationSettingsTab({
  profile,
  editedProfile,
  updateProfile,
  refreshTrigger,
}: InstallationSettingsTabProps) {
  const { t } = useTranslation();
  const accent = useThemeStore((state) => state.accentColor.value);
  const isBackgroundAnimationEnabled = useThemeStore((state) => state.isBackgroundAnimationEnabled);
  const resolvedLoaderVersion = useResolvedLoaderVersion(editedProfile, refreshTrigger);

  const [minecraftVersions, setMinecraftVersions] = useState<MinecraftVersion[]>([]);
  const [isLoadingVersions, setIsLoadingVersions] = useState(true);
  const [loaderVersions, setLoaderVersions] = useState<string[]>([]);
  const [isLoadingLoaderVersions, setIsLoadingLoaderVersions] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [versionType, setVersionType] = useState<VersionType>("release");
  const [chosenFamily, setFamily] = useState(() => familyOf(editedProfile.game_version));

  const tabRef = useRef<HTMLDivElement>(null);
  const olderRef = useRef<HTMLDivElement>(null);
  const [olderOpen, setOlderOpen] = useState(false);

  useEffect(() => {
    if (!olderOpen) return;
    const close = (event: MouseEvent) => {
      if (!olderRef.current?.contains(event.target as Node)) setOlderOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [olderOpen]);

  const locked = profile.is_standard_version;
  const gameVersion = editedProfile.game_version;
  const loader = editedProfile.loader || "vanilla";
  const current = loaderOf(loader);
  const changed = gameVersion !== profile.game_version || loader !== (profile.loader || "vanilla");
  const customLoaderVersion = editedProfile.settings.use_overwrite_loader_version;
  const overwrittenVersion =
    editedProfile.settings.overwrite_loader_versions?.[loader] ?? editedProfile.settings.overwrite_loader_version ?? "";

  useEffect(() => {
    if (isBackgroundAnimationEnabled && tabRef.current) {
      gsap.fromTo(tabRef.current, { opacity: 0 }, { opacity: 1, duration: 0.3, ease: "power2.out" });
    }
  }, [isBackgroundAnimationEnabled]);

  useEffect(() => {
    invoke<{ versions: MinecraftVersion[] }>("get_minecraft_versions")
      .then((result) => {
        setMinecraftVersions(result.versions);
        const type = result.versions.find((version) => version.id === editedProfile.game_version)?.type;
        if (type && VERSION_TYPES.some((option) => option.value === type)) setVersionType(type as VersionType);
      })
      .catch((err) => setError(`failed to fetch minecraft versions: ${parseErrorMessage(err)}`))
      .finally(() => setIsLoadingVersions(false));
  }, []);

  useEffect(() => {
    if (!gameVersion || loader === "vanilla") {
      setLoaderVersions([]);
      return;
    }
    let alive = true;
    setIsLoadingLoaderVersions(true);
    setError(null);
    fetchLoaderVersions(loader, gameVersion)
      .then((versions) => alive && setLoaderVersions(versions))
      .catch((err) => alive && setError(`failed to fetch ${loader} versions: ${parseErrorMessage(err)}`))
      .finally(() => alive && setIsLoadingLoaderVersions(false));
    return () => {
      alive = false;
    };
  }, [gameVersion, loader]);

  const versionsOfType = useMemo(
    () => minecraftVersions.filter((version) => version.type === versionType).map((version) => version.id),
    [minecraftVersions, versionType],
  );
  const families = useMemo(() => [...new Set(versionsOfType.map(familyOf))], [versionsOfType]);
  const family = families.includes(chosenFamily) ? chosenFamily : families[0];
  const recentFamilies = families.slice(0, RECENT_FAMILIES);
  const olderFamilies = families.slice(RECENT_FAMILIES);
  const versionsOfFamily = useMemo(
    () => versionsOfType.filter((version) => familyOf(version) === family),
    [versionsOfType, family],
  );

  const selectGameVersion = (versionId: string) => {
    if (locked || !versionId || versionId === gameVersion) return;
    updateProfile({
      game_version: versionId,
      loader_version: null,
      ...(isLoaderCompatible(loader, versionId) ? {} : { loader: "vanilla" as ModLoader }),
    });
  };

  const selectLoader = (name: ModLoader) => {
    if (name === loader || !isLoaderCompatible(name, gameVersion)) return;
    updateProfile({ loader: name, loader_version: null });
  };

  const latestLabel = t("profiles.settings.loaderLatest");
  const setCustomLoaderVersion = (
    custom: boolean,
    version = overwrittenVersion || LATEST_LOADER_VERSION,
  ) =>
    updateProfile({
      settings: {
        ...editedProfile.settings,
        use_overwrite_loader_version: custom,
        overwrite_loader_version: null,
        overwrite_loader_versions: { ...editedProfile.settings.overwrite_loader_versions, [loader]: version },
      },
    });

  const reasonText = (reason: string) =>
    ({
      norisk_pack: t("profiles.settings.reasonNoriskPack"),
      user_overwrite: t("profiles.settings.reasonUserOverwrite"),
      profile_default: t("profiles.settings.reasonProfileDefault"),
      not_resolved: t("profiles.settings.reasonNotResolved"),
    })[reason] ?? reason;

  const typeSwitch = (
    <div className="flex gap-1">
      {VERSION_TYPES.map((type) => (
        <Chip
          key={type.value}
          active={type.value === versionType}
          accent={accent}
          onClick={() => setVersionType(type.value)}
          className="px-2.5 py-1 text-xs"
        >
          {t(type.labelKey)}
        </Chip>
      ))}
    </div>
  );

  return (
    <div ref={tabRef} className="space-y-4 select-none">
      {error && <StatusMessage type="error" message={error} />}

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-white/10 bg-black/30 px-4 py-3 font-minecraft text-sm">
        <span className="flex items-center gap-2 text-white">
          <img src="/icons/minecraft.png" alt="" className="h-5 w-5 object-contain" />
          <span className="text-base">{gameVersion}</span>
        </span>
        <span className="h-4 w-px bg-white/20" />
        <span className="flex items-center gap-2 text-white/80">
          <img src={current.icon} alt="" className="h-5 w-5 object-contain" />
          {current.label}
          {loader !== "vanilla" && resolvedLoaderVersion?.version && (
            <span className="text-white/50">{resolvedLoaderVersion.version}</span>
          )}
        </span>
        {changed && (
          <span className="ml-auto flex items-center gap-2 text-xs text-white/60">
            <Icon icon="solar:pen-bold" className="h-3.5 w-3.5" style={{ color: accent }} />
            {t("profiles.settings.unsavedFrom", {
              version: profile.game_version,
              loader: loaderOf(profile.loader || "vanilla").label,
            })}
          </span>
        )}
      </div>

      <Section title={t("profiles.settings.gameVersion")} aside={typeSwitch}>
        {locked && (
          <p className="mb-3 flex items-center gap-2 font-minecraft text-xs text-white/60">
            <Icon icon="solar:lock-keyhole-bold" className="h-4 w-4 shrink-0" />
            {t("profiles.settings.versionManaged")}
          </p>
        )}
        {isLoadingVersions ? (
          <div className="flex items-center gap-2 py-2 font-smallcaps text-white/60">
            <Icon icon="svg-spinners:ring-resize" className="h-5 w-5" />
            {t("profiles.settings.loadingVersions")}
          </div>
        ) : versionType === "release" ? (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-1.5">
              {recentFamilies.map((name) => (
                <Chip
                  key={name}
                  active={name === family}
                  marked={name === familyOf(gameVersion)}
                  accent={accent}
                  onClick={() => setFamily(name)}
                  className="px-2.5 py-1 text-xs"
                >
                  {name}
                </Chip>
              ))}
              {olderFamilies.length > 0 && (
                <div ref={olderRef} className="relative">
                  <Chip
                    active={olderFamilies.includes(family)}
                    marked={olderFamilies.includes(familyOf(gameVersion))}
                    accent={accent}
                    onClick={() => setOlderOpen((open) => !open)}
                    className="flex items-center gap-1 px-2.5 py-1 text-xs"
                  >
                    {olderFamilies.includes(family) ? family : t("profiles.settings.olderVersions")}
                    <Icon icon="solar:alt-arrow-down-linear" className="h-3 w-3" />
                  </Chip>
                  {olderOpen && (
                    <div className="absolute left-0 top-full z-20 mt-1 flex w-64 flex-wrap gap-1.5 rounded-lg border border-white/20 bg-black/90 p-2 shadow-xl backdrop-blur-sm">
                      {olderFamilies.map((name) => (
                        <Chip
                          key={name}
                          active={name === family}
                          marked={name === familyOf(gameVersion)}
                          accent={accent}
                          onClick={() => {
                            setFamily(name);
                            setOlderOpen(false);
                          }}
                          className="px-2.5 py-1 text-xs"
                        >
                          {name}
                        </Chip>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
            <div className="flex flex-wrap gap-1.5 border-t border-white/10 pt-3">
              {versionsOfFamily.map((version) => (
                <Chip
                  key={version}
                  active={version === gameVersion}
                  disabled={locked}
                  accent={accent}
                  onClick={() => selectGameVersion(version)}
                  className="h-9 px-3.5 text-sm"
                >
                  {version}
                </Chip>
              ))}
            </div>
          </div>
        ) : versionsOfType.length === 0 ? (
          <p className="font-minecraft text-sm text-white/60">{t("profiles.settings.noVersionsFound")}</p>
        ) : (
          <Combobox
            selectOnly
            value={versionsOfType.includes(gameVersion) ? gameVersion : ""}
            onChange={selectGameVersion}
            options={versionsOfType}
            placeholder={t("profiles.settings.searchVersions")}
            disabled={locked}
          />
        )}
      </Section>

      <Section title={t("profiles.settings.platform")}>
        <div className="grid grid-cols-5 overflow-hidden rounded-lg border border-white/10">
          {LOADERS.map((option, index) => {
            const compatible = isLoaderCompatible(option.name, gameVersion);
            const selected = option.name === loader;
            return (
              <button
                key={option.name}
                type="button"
                disabled={!compatible}
                onClick={() => selectLoader(option.name)}
                aria-pressed={selected}
                title={compatible ? undefined : t("profiles.settings.needsVersion", { version: option.since })}
                className={cn(
                  "flex flex-col items-center gap-1 py-2.5 transition-colors",
                  index > 0 && "border-l border-white/10",
                  selected ? "text-white" : "bg-black/20 text-white/60 enabled:hover:bg-white/5 enabled:hover:text-white",
                  !compatible && "cursor-not-allowed opacity-35",
                )}
                style={selected ? { backgroundColor: `${accent}33`, boxShadow: `inset 0 -2px 0 ${accent}` } : undefined}
              >
                <img src={option.icon} alt="" className="h-7 w-7 object-contain" />
                <span className="font-smallcaps text-sm">{option.label}</span>
                {!compatible && (
                  <span className="font-minecraft text-[10px] text-white/60">
                    {t("profiles.settings.needsVersion", { version: option.since })}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {loader !== "vanilla" && (
          <div className="mt-4 space-y-3 border-t border-white/10 pt-4">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="font-smallcaps text-base text-white">
                  {t("profiles.settings.loaderVersion", { loader: current.label })}
                </p>
                {resolvedLoaderVersion && (
                  <p className="font-minecraft text-xs text-white/50">{reasonText(resolvedLoaderVersion.reason)}</p>
                )}
              </div>
              <label className="flex shrink-0 cursor-pointer items-center gap-2 font-minecraft text-xs text-white/70">
                {t("profiles.settings.useCustomLoaderVersion", { loader: current.label })}
                <ToggleSwitch checked={customLoaderVersion} onChange={setCustomLoaderVersion} size="sm" />
              </label>
            </div>
            {isLoadingLoaderVersions ? (
              <div className="flex items-center gap-2 font-smallcaps text-white/60">
                <Icon icon="svg-spinners:ring-resize" className="h-5 w-5" />
                {t("profiles.settings.loadingLoaderVersions", { loader: current.label })}
              </div>
            ) : loaderVersions.length === 0 ? (
              <p className="font-minecraft text-sm text-white/60">
                {t("profiles.settings.noLoaderVersions", { loader: current.label, version: gameVersion })}
              </p>
            ) : (
              <Combobox
                selectOnly
                value={withoutStableTag(
                  !customLoaderVersion
                    ? resolvedLoaderVersion?.version ?? ""
                    : overwrittenVersion === LATEST_LOADER_VERSION
                      ? latestLabel
                      : overwrittenVersion,
                )}
                onChange={(version) =>
                  setCustomLoaderVersion(true, version === latestLabel || !version ? LATEST_LOADER_VERSION : version)
                }
                options={[latestLabel, ...loaderVersions]}
                placeholder={t("profiles.settings.chooseLoaderVersion")}
                disabled={!customLoaderVersion}
              />
            )}
          </div>
        )}
      </Section>
    </div>
  );
}
