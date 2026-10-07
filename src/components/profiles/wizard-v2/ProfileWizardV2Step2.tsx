"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "@iconify/react";
import type { ModLoader } from "../../../types/profile";
import { invoke } from "@tauri-apps/api/core";
import { Modal } from "../../ui/Modal";
import { Button } from "../../ui/buttons/Button";
import { StatusMessage } from "../../ui/StatusMessage";
import { useThemeStore } from "../../../store/useThemeStore";
import { Select } from "../../ui/Select";
import { Tooltip } from "../../ui/Tooltip";
import type { NrcCompatibilityData } from "../../../utils/nrc-compatibility";
import { useTranslation } from "react-i18next";
import { parseErrorMessage } from "../../../utils/error-utils";

function NrcLoaderCompatibleTooltipContent() {
  const { t } = useTranslation();
  return (
    <div className="space-y-2">
      <div className="text-sm text-white">{t('profiles.wizard.nrcLoaderCompatible')}</div>
      <div className="flex items-start gap-2">
        <Icon icon="solar:lightbulb-bold" className="text-yellow-400 text-base flex-shrink-0" />
        <div className="text-gray-300 text-xs italic">
          {t('profiles.wizard.nrcLoaderFeatures')}
        </div>
      </div>
    </div>
  );
}

interface LoaderVersionInfo {
  loader: {
    version: string;
    stable?: boolean;
  };
}

async function readLoaderVersions(loader: Exclude<ModLoader, "vanilla">, minecraftVersion: string): Promise<string[]> {
  if (loader === "fabric" || loader === "quilt") {
    const versions = await invoke<LoaderVersionInfo[]>(
      loader === "fabric" ? "get_fabric_loader_versions" : "get_quilt_loader_versions",
      { minecraftVersion },
    );
    // The installers explicitly accept this stable-version annotation.
    return versions.map(v => `${v.loader.version}${v.loader.stable ? " (stable)" : ""}`);
  }
  return invoke<string[]>(loader === "forge" ? "get_forge_versions" : "get_neoforge_versions", { minecraftVersion });
}

function isNoVersionsError(error: unknown): boolean {
  const message = parseErrorMessage(error);
  const kind = typeof error === "object" && error !== null && "kind" in error ? String(error.kind) : "";
  return [message, kind].some(value => value.includes("Status 400") || value.includes("Status 404"));
}

interface ProfileWizardV2Step2Props {
  onClose: () => void;
  onNext: (selectedLoader: ModLoader, selectedLoaderVersion: string | null) => void;
  onBack: () => void;
  selectedMinecraftVersion: string;
  nrcCompatibility: NrcCompatibilityData | null;
  initialLoader?: ModLoader;
  initialLoaderVersion?: string | null;
}

export function ProfileWizardV2Step2({
  onClose,
  onNext,
  onBack,
  selectedMinecraftVersion,
  nrcCompatibility,
  initialLoader = "fabric",
  initialLoaderVersion = null,
}: ProfileWizardV2Step2Props) {
  const { t } = useTranslation();
  const accentColor = useThemeStore((state) => state.accentColor);
  const [error, setError] = useState<string | null>(null);
  const [selectedLoader, setSelectedLoader] = useState<ModLoader>(initialLoader);
  const [selectedLoaderVersion, setSelectedLoaderVersion] = useState<string | null>(initialLoaderVersion);
  const selectedLoaderRef = useRef(selectedLoader);
  selectedLoaderRef.current = selectedLoader;
  const [readAttempt, setReadAttempt] = useState(0);
  const [loaderVersions, setLoaderVersions] = useState<string[]>([]);
  const [loadingVersions, setLoadingVersions] = useState(initialLoader !== "vanilla");
  const versionsPendingRef = useRef(initialLoader !== "vanilla");
  const [showLoadingIndicator, setShowLoadingIndicator] = useState(false);
  const [showNoVersionsFound, setShowNoVersionsFound] = useState(false);
  const [unavailableLoaders, setUnavailableLoaders] = useState<Set<ModLoader>>(new Set());

  const modLoaders: { key: ModLoader; label: string; icon: string; backgroundImage: string }[] = [
    { key: "vanilla", label: "Vanilla", icon: "solar:gamepad-bold", backgroundImage: "/icons/minecraft.png" },
    { key: "fabric", label: "Fabric", icon: "solar:box-bold", backgroundImage: "/icons/fabric.png" },
    { key: "forge", label: "Forge", icon: "solar:sledgehammer-bold", backgroundImage: "/icons/forge.png" },
    { key: "neoforge", label: "NeoForge", icon: "solar:shield-bold", backgroundImage: "/icons/neoforge.png" },
    { key: "quilt", label: "Quilt", icon: "solar:widget-bold", backgroundImage: "/icons/quilt.png" },
  ];

  // Availability probes never turn a transport failure into "not available".
  useEffect(() => {
    let cancelled = false;
    setUnavailableLoaders(new Set());
    const loaders: Exclude<ModLoader, "vanilla">[] = ["fabric", "forge", "neoforge", "quilt"];
    void Promise.all(loaders.map(async loader => {
      try {
        return (await readLoaderVersions(loader, selectedMinecraftVersion)).length === 0 ? loader : null;
      } catch (err) {
        return isNoVersionsError(err) ? loader : null;
      }
    })).then(results => {
      if (cancelled) return;
      const unavailable = new Set(results.filter((loader): loader is Exclude<ModLoader, "vanilla"> => loader !== null));
      setUnavailableLoaders(unavailable);
      if (unavailable.has(selectedLoaderRef.current as Exclude<ModLoader, "vanilla">)) {
        selectedLoaderRef.current = "vanilla";
        setSelectedLoader("vanilla");
      }
    });
    return () => { cancelled = true; };
  }, [selectedMinecraftVersion, readAttempt]);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    setLoaderVersions([]);
    setShowLoadingIndicator(false);
    setShowNoVersionsFound(false);
    if (selectedLoader === "vanilla") {
      versionsPendingRef.current = false;
      setSelectedLoaderVersion(null);
      setLoadingVersions(false);
      return;
    }

    setLoadingVersions(true);
    versionsPendingRef.current = true;
    const loadingTimeout = setTimeout(() => {
      if (!cancelled) setShowLoadingIndicator(true);
    }, 800);
    void (async () => {
      try {
        const versions = await readLoaderVersions(selectedLoader, selectedMinecraftVersion);
        if (cancelled) return;
        setLoaderVersions(versions);
        setSelectedLoaderVersion(current => current && versions.includes(current) ? current : versions[0] ?? null);
        if (versions.length === 0) {
          setUnavailableLoaders(current => new Set(current).add(selectedLoader));
          selectedLoaderRef.current = "vanilla";
          setSelectedLoader("vanilla");
        }
      } catch (err) {
        if (cancelled) return;
        setSelectedLoaderVersion(null);
        if (isNoVersionsError(err)) {
          setUnavailableLoaders(current => new Set(current).add(selectedLoader));
          selectedLoaderRef.current = "vanilla";
          setSelectedLoader("vanilla");
        } else {
          console.error(`Failed to fetch ${selectedLoader} versions:`, err);
          setError(t('profiles.wizard.loadLoaderVersionsError', { loader: selectedLoader }));
        }
      } finally {
        clearTimeout(loadingTimeout);
        if (!cancelled) {
          versionsPendingRef.current = false;
          setLoadingVersions(false);
          setShowLoadingIndicator(false);
        }
      }
    })();
    return () => {
      cancelled = true;
      clearTimeout(loadingTimeout);
    };
  }, [selectedLoader, selectedMinecraftVersion, readAttempt, t]);

  const handleNext = () => {
    if (selectedLoaderRef.current !== selectedLoader || versionsPendingRef.current || loadingVersions || error || (selectedLoader !== "vanilla" && !selectedLoaderVersion)) return;
    onNext(selectedLoader, selectedLoaderVersion);
  };

  const selectLoader = (loader: ModLoader) => {
    if (loader === selectedLoader || unavailableLoaders.has(loader)) return;
    selectedLoaderRef.current = loader;
    versionsPendingRef.current = loader !== "vanilla";
    setLoadingVersions(loader !== "vanilla");
    setError(null);
    setLoaderVersions([]);
    setSelectedLoaderVersion(null);
    setSelectedLoader(loader);
  };

  const renderContent = () => {
    return (
      <div className="min-h-[380px] flex flex-col space-y-6">
        {error && (
          <div className="space-y-3">
            <StatusMessage type="error" message={error} />
            <Button size="sm" variant="secondary" onClick={() => setReadAttempt(attempt => attempt + 1)} disabled={loadingVersions}>
              {t('common.retry')}
            </Button>
          </div>
        )}
        {/* Mod Loader Selection */}
        <div className="grid grid-cols-2 gap-3 flex-shrink-0">
          {modLoaders.map(loader => {
            const isUnavailable = unavailableLoaders.has(loader.key);
            const isDisabled = isUnavailable && loader.key !== "vanilla";
            const isNrcCompatible = nrcCompatibility
              ?.compatibleLoadersByVersion
              .get(selectedMinecraftVersion)
              ?.has(loader.key) ?? false;

            return (
              <button
                type="button"
                aria-pressed={selectedLoader === loader.key}
                aria-label={loader.label}
                disabled={isDisabled}
                key={loader.key}
                className={`relative p-4 h-28 transition-all duration-200 rounded-lg overflow-hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80 ${
                  isDisabled
                    ? "opacity-50 cursor-not-allowed pointer-events-none border-0"
                    : selectedLoader === loader.key
                    ? "border-2 border-current hover:bg-current/15 cursor-pointer"
                    : "border-2 border-transparent hover:bg-black/30 cursor-pointer"
                }`}
                style={{
                  backgroundImage: `url('${loader.backgroundImage}')`,
                  backgroundSize: 'cover',
                  backgroundPosition: 'center',
                  backgroundRepeat: 'no-repeat',
                  border: isDisabled ? 'none' : undefined,
                  ...(selectedLoader === loader.key && !isDisabled ? {
                    borderColor: accentColor.value,
                    color: accentColor.value
                  } : {})
                }}
                onClick={() => !isDisabled && selectLoader(loader.key)}
              >
                {/* NRC Compatibility Star */}
                {isNrcCompatible && !isDisabled && (
                  <div className="absolute top-2 right-2 z-20">
                    <Tooltip content={<NrcLoaderCompatibleTooltipContent />}>
                      <div className="flex items-center justify-center w-6 h-6 rounded-full">
                        <Icon icon="solar:star-bold" className="w-4 h-4 text-yellow-400 drop-shadow-lg" />
                      </div>
                    </Tooltip>
                  </div>
                )}
                {/* Dark overlay for better text readability */}
                <div className={`absolute inset-0 transition-all duration-200 ${
                  selectedLoader === loader.key && !isDisabled
                    ? "bg-black/40"
                    : isDisabled
                    ? "bg-black/80"
                    : "bg-black/60"
                }`} />

                {/* Content */}
                <div className="relative z-10 flex flex-col items-center text-center justify-center h-full">
                  <h4 className="font-smallcaps text-xl text-white drop-shadow-lg">
                    {loader.label}
                  </h4>
                  {isDisabled && (
                    <p className="font-smallcaps text-base text-white/70 mt-1">
                      {t('profiles.wizard.notAvailable')}
                    </p>
                  )}
                </div>
              </button>
            );
          })}
        </div>

        {/* Version Selection */}
        <div className="h-20 flex items-center flex-shrink-0">
          {selectedLoader === "vanilla" ? (
            <div className="text-center w-full">
              <p className="text-xs font-smallcaps text-white/50">
                {t('profiles.wizard.noAdditionalVersion')}
              </p>
            </div>
          ) : showLoadingIndicator ? (
            <div className="flex items-center justify-center w-full">
              <Icon icon="svg-spinners:ring-resize" className="w-6 h-6 text-white mr-3" />
              <p className="text-xs font-smallcaps text-white">{t('profiles.wizard.loadingVersions')}</p>
            </div>
          ) : loaderVersions.length > 0 ? (
            <Select
              aria-label={t('profiles.wizard.selectLoaderVersion', { loader: modLoaders.find(l => l.key === selectedLoader)?.label })}
              value={selectedLoaderVersion || ""}
              onChange={setSelectedLoaderVersion}
              options={loaderVersions.map(version => ({
                value: version,
                label: version
              }))}
              placeholder={t('profiles.wizard.selectLoaderVersion', { loader: modLoaders.find(l => l.key === selectedLoader)?.label })}
              size="md"
              className="w-full"
            />
          ) : showNoVersionsFound ? (
            <div className="text-center w-full">
              <Icon icon="solar:danger-triangle-bold" className="w-8 h-8 text-white/50 mx-auto mb-2" />
              <p className="text-xs font-smallcaps text-white/70">
                {t('profiles.wizard.noLoaderVersions', { loader: selectedLoader, version: selectedMinecraftVersion })}
              </p>
            </div>
          ) : null}
        </div>
      </div>
    );
  };

  const renderFooter = () => (
    <div className="flex flex-wrap gap-3 justify-between items-center">
      <Button
        variant="secondary"
        onClick={onBack}
        size="md"
        className="text-sm"
        icon={<Icon icon="solar:arrow-left-bold" className="w-5 h-5" />}
        iconPosition="left"
      >
        {t('profiles.wizard.back')}
      </Button>

      <Button
        variant="default"
        onClick={handleNext}
        disabled={loadingVersions || Boolean(error) || (selectedLoader !== "vanilla" && !selectedLoaderVersion)}
        size="md"
        className="min-w-[180px] text-sm"
        icon={<Icon icon="solar:arrow-right-bold" className="w-5 h-5" />}
        iconPosition="right"
      >
        {t('profiles.wizard.next')}
      </Button>
    </div>
  );

  return (
    <Modal
      title={t('profiles.wizard.step2Title')}
      onClose={onClose}
      width="lg"
      footer={renderFooter()}
    >
      <div className="min-h-[500px] p-6">
        {renderContent()}
      </div>
    </Modal>
  );
}
