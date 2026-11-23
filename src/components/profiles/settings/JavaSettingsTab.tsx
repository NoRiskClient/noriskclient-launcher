import { useEffect, useRef, useState } from "react";
import { Icon } from "@iconify/react";
import type { Profile, ProfilePatch } from "../../../types/profile";
import { SLIDER_SAVE_DELAY_MS, TYPING_SAVE_DELAY_MS } from "../../../utils/profile-patch";
import { useThemeStore } from "../../../store/useThemeStore";
import { RangeSlider } from "../../ui/RangeSlider";
import { SearchStyleTextArea } from "../../ui/Input";
import { ToggleSwitch } from "../../ui/ToggleSwitch";
import { Chip, IconAction, Section } from "./SettingsSection";
import { gsap } from "gsap";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { toast } from "react-hot-toast";
import { getGlobalMemorySettings, setGlobalMemorySettings, getGlobalJvmArgs, setGlobalJvmArgs } from "../../../services/launcher-config-service";
import { getDefaultJvmArgs } from "../../../services/profile-service";
import { useDebounce } from "../../../hooks/useDebounce";
import { useDebouncedCallback } from "../../../hooks/useDebouncedCallback";
import type { MemorySettings } from "../../../types/launcherConfig";
import { useTranslation } from "react-i18next";
import { parseErrorMessage } from "../../../utils/error-utils";

const MEMORY_PRESETS_GB = [2, 4, 6, 8, 12, 16];
const HIGH_MEMORY_SHARE = 0.75;

function formatGb(mb: number): string {
  const gb = mb / 1024;
  return `${Number.isInteger(gb) ? gb : gb.toFixed(1)} GB`;
}

interface JavaSettingsTabProps {
  editedProfile: Profile;
  updateProfile: (patch: ProfilePatch, delayMs?: number) => void;
  systemRam: number;
  recommendedRam: number;
  tempRamMb: number;
  setTempRamMb: (value: number) => void;
}

interface JavaInstallation {
  path: string;
  major_version: number;
  vendor: string;
  architecture: string;
  is_default?: boolean;
}

export function JavaSettingsTab({
  editedProfile,
  updateProfile,
  systemRam,
  recommendedRam,
  tempRamMb,
  setTempRamMb,
}: JavaSettingsTabProps) {
  const { t } = useTranslation();
  const [useCustomJava, setUseCustomJava] = useState(
    editedProfile.settings?.use_custom_java_path ?? false,
  );
  const [useCustomArgs, setUseCustomArgs] = useState(editedProfile.settings?.use_custom_jvm_args ?? false);
  const [argsDraft, setArgsDraft] = useState(editedProfile.settings?.jvm_args ?? "");
  const [defaultJvmArgs, setDefaultJvmArgs] = useState("");
  const previewRamMb = useDebounce(tempRamMb, SLIDER_SAVE_DELAY_MS);
  const accentColor = useThemeStore((state) => state.accentColor);
  const isBackgroundAnimationEnabled = useThemeStore(
    (state) => state.isBackgroundAnimationEnabled,
  );
  const tabRef = useRef<HTMLDivElement>(null);

  const [detectedJavaInstallations, setDetectedJavaInstallations] = useState<
    JavaInstallation[]
  >([]);
  const [isDetectingJava, setIsDetectingJava] = useState(false);
  const [customJavaPathInput, setCustomJavaPathInput] = useState(
    editedProfile.settings?.java_path || "",
  );
  const [isValidatingJavaPath, setIsValidatingJavaPath] = useState(false);
  
  const [globalMemorySettings, setGlobalMemorySettingsState] = useState<MemorySettings | null>(null);
  const [isLoadingGlobalMemory, setIsLoadingGlobalMemory] = useState(false);
  const [isSystemRamLoaded, setIsSystemRamLoaded] = useState(false);

  const [isLoadingGlobalJvmArgs, setIsLoadingGlobalJvmArgs] = useState(false);
  

  useEffect(() => {
    if (isBackgroundAnimationEnabled) {
      if (tabRef.current) {
        gsap.fromTo(
          tabRef.current,
          { opacity: 0 },
          { opacity: 1, duration: 0.4, ease: "power2.out" },
        );
      }
    }
  }, [isBackgroundAnimationEnabled]);

  const detectJavaInstallations = async () => {
    setIsDetectingJava(true);
    try {
      const installations: JavaInstallation[] = await invoke(
        "detect_java_installations_command",
      );
      setDetectedJavaInstallations(installations);
      if (installations.length === 0) {
        toast(
          t('java.no_installations_found'),
        );
      } else if (!customJavaPathInput) {
        const currentProfileJavaPath = editedProfile.settings?.java_path;
        const preselected = currentProfileJavaPath
          ? installations.find((inst) => inst.path === currentProfileJavaPath)
          : installations.find((inst) => inst.is_default) || installations[0];
        if (preselected) {
          setCustomJavaPathInput(preselected.path);
        }
      }
    } catch (error) {
      console.error("Error detecting Java installations:", error);
      const errorMessage =
        parseErrorMessage(error);
      toast.error(t('java.detect_failed', { error: errorMessage }));
      setDetectedJavaInstallations([]);
    } finally {
      setIsDetectingJava(false);
    }
  };

  useEffect(() => {
    detectJavaInstallations();
  }, []);

  useEffect(() => {
    let current = true;
    getDefaultJvmArgs(editedProfile, previewRamMb)
      .then((args) => current && setDefaultJvmArgs(args))
      .catch((error) => console.error("Failed to load default JVM args:", error));
    return () => {
      current = false;
    };
  }, [
    editedProfile.selected_norisk_pack_id,
    editedProfile.game_version,
    editedProfile.loader,
    editedProfile.settings?.use_custom_java_path,
    editedProfile.settings?.java_path,
    previewRamMb,
  ]);

  useEffect(() => {
    if (systemRam !== 8192) {
      setIsSystemRamLoaded(true);
    }
  }, [systemRam]);

  useEffect(() => {
    if (editedProfile.is_standard_version) {
      setIsLoadingGlobalMemory(true);
      getGlobalMemorySettings()
        .then((settings) => {
          setGlobalMemorySettingsState(settings);
          setTempRamMb(settings.max);
        })
        .catch((error) => {
          console.error("Failed to load global memory settings:", error);
          toast.error(t('java.load_memory_failed'));
        })
        .finally(() => {
          setIsLoadingGlobalMemory(false);
        });
    } else {
      setIsLoadingGlobalMemory(false);
    }
  }, [editedProfile.is_standard_version, setTempRamMb]);

  useEffect(() => {
    if (editedProfile.is_standard_version) {
      setIsLoadingGlobalJvmArgs(true);
      getGlobalJvmArgs()
        .then(({ use_global_jvm_args, global_jvm_args }) => {
          setArgsDraft(global_jvm_args);
          setUseCustomArgs(use_global_jvm_args);
        })
        .catch((error) => {
          console.error("Failed to load global JVM args:", error);
          toast.error(t('java.load_jvm_failed'));
        })
        .finally(() => {
          setIsLoadingGlobalJvmArgs(false);
        });
    } else {
      setIsLoadingGlobalJvmArgs(false);
    }
  }, [editedProfile.is_standard_version]);

  const browseForJavaPath = async () => {
    try {
      const selected = await open({
        title: t('settings.java.select_java_executable'),
        directory: false,
        multiple: false,
      });
      if (typeof selected === "string" && selected) {
        setCustomJavaPathInput(selected);
        await testCustomJavaPath(selected);
      }
    } catch (error) {
      console.error("Error browsing for Java path:", error);
      const errorMessage = String(
        error instanceof Error ? error.message : error,
      );
      toast.error(t('java.browse_error', { error: errorMessage }));
    }
  };

  const testCustomJavaPath = async (path_to_test?: string) => {
    const currentPath = path_to_test || customJavaPathInput;
    if (!currentPath) {
      toast.error(t('java.select_path_to_test'));
      return;
    }
    setIsValidatingJavaPath(true);
    try {
      const isValid: boolean = await invoke("validate_java_path_command", {
        path: currentPath,
      });
      if (isValid) {
        toast.success(t('java.path_valid'));
        updateProfile({ settings: { java_path: currentPath, use_custom_java_path: true } });
      } else {
        toast.error(t('java.path_invalid'));
      }
    } catch (error: any) {
      console.error(`Error validating Java path ${currentPath}:`, error);
      const message = error?.message?.includes("Java path does not exist")
        ? t('java.path_not_exist')
        : error?.message || parseErrorMessage(error);
      toast.error(t('java.validation_error', { error: message }));
    } finally {
      setIsValidatingJavaPath(false);
    }
  };

  const recommendedMaxRam = Math.min(recommendedRam, systemRam);
  
  const memory = editedProfile.is_standard_version
    ? (globalMemorySettings || { min: 1024, max: recommendedMaxRam })
    : (editedProfile.settings?.memory || { min: 1024, max: recommendedMaxRam });

  const saveGlobalMemory = useDebouncedCallback(async (value: number) => {
    const newGlobalSettings: MemorySettings = { min: memory.min, max: value };
    try {
      await setGlobalMemorySettings(newGlobalSettings);
      setGlobalMemorySettingsState(newGlobalSettings);
    } catch (error) {
      console.error("Failed to save global memory settings:", error);
      toast.error(t('java.save_ram_failed'));
    }
  }, SLIDER_SAVE_DELAY_MS);

  const saveGlobalJvmArgs = async (patch: Parameters<typeof setGlobalJvmArgs>[0]) => {
    try {
      await setGlobalJvmArgs(patch);
    } catch (error) {
      console.error("Failed to save global JVM args:", error);
      toast.error(t('java.save_jvm_failed'));
    }
  };
  const saveGlobalJvmArgsText = useDebouncedCallback(
    (global_jvm_args: string) => saveGlobalJvmArgs({ global_jvm_args }),
    TYPING_SAVE_DELAY_MS,
  );

  const handleJavaPathInputChange = (newPath: string) => {
    setCustomJavaPathInput(newPath);
  };

  const handleDetectedJavaListItemClick = (installation: JavaInstallation) => {
    setCustomJavaPathInput(installation.path);
    testCustomJavaPath(installation.path);
  };

  const handleJavaArgsChange = (args: string) => {
    setArgsDraft(args);
    if (editedProfile.is_standard_version) {
      saveGlobalJvmArgsText(args);
    } else {
      updateProfile({ settings: { jvm_args: args } }, TYPING_SAVE_DELAY_MS);
    }
  };

  const handleCustomJavaToggle = (checked: boolean) => {
    setUseCustomJava(checked);
    if (checked) {
      if (!customJavaPathInput && detectedJavaInstallations.length > 0) {
        const defaultOrFirst =
          detectedJavaInstallations.find((j) => j.is_default) ||
          detectedJavaInstallations[0];
        if (defaultOrFirst) setCustomJavaPathInput(defaultOrFirst.path);
      }
    }
    updateProfile({ settings: { use_custom_java_path: checked } });
  };

  const handleCustomArgsToggle = (checked: boolean) => {
    setUseCustomArgs(checked);
    if (editedProfile.is_standard_version) {
      saveGlobalJvmArgs({ use_global_jvm_args: checked });
    } else {
      updateProfile({ settings: { use_custom_jvm_args: checked } });
    }
  };

  const isStandard = editedProfile.is_standard_version;
  const memoryLoading = (isStandard && (isLoadingGlobalMemory || !globalMemorySettings)) || !isSystemRamLoaded;
  const presets = MEMORY_PRESETS_GB.map((gb) => gb * 1024).filter((mb) => mb <= systemRam);
  const selectRam = (value: number) => {
    setTempRamMb(value);
    if (isStandard) {
      saveGlobalMemory(value);
    } else {
      updateProfile({ settings: { memory: { min: memory.min, max: value } } }, SLIDER_SAVE_DELAY_MS);
    }
  };

  return (
    <div ref={tabRef} className="space-y-4 select-none">
      <Section
        title={isStandard ? t("profiles.settings.globalMemoryAllocated") : t("profiles.settings.memoryAllocated")}
        aside={!memoryLoading && <span className="font-minecraft text-2xl text-white">{formatGb(tempRamMb)}</span>}
      >
        {memoryLoading ? (
          <div className="flex items-center gap-2 py-2 font-smallcaps text-white/60">
            <Icon icon="svg-spinners:ring-resize" className="h-5 w-5" />
            {t("profiles.settings.loadingSettings")}
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-1.5">
              {presets.map((mb) => (
                <Chip
                  key={mb}
                  active={mb === tempRamMb}
                  marked={mb === recommendedMaxRam}
                  accent={accentColor.value}
                  onClick={() => selectRam(mb)}
                  className="px-3 py-1 text-sm"
                >
                  {formatGb(mb)}
                </Chip>
              ))}
            </div>
            <RangeSlider
              value={tempRamMb}
              onChange={selectRam}
              min={512}
              max={systemRam}
              step={512}
              showValue={false}
              variant="flat"
            />
            <div className="flex justify-between font-minecraft text-xs text-white/40">
              <span>{formatGb(512)}</span>
              <span>
                {t("profiles.settings.recommended")}: {formatGb(recommendedMaxRam)}
              </span>
              <span>{formatGb(systemRam)}</span>
            </div>
            {tempRamMb > systemRam * HIGH_MEMORY_SHARE && (
              <p className="flex items-center gap-2 font-minecraft text-xs text-amber-300/90">
                <Icon icon="solar:danger-triangle-bold" className="h-4 w-4 shrink-0" />
                {t("profiles.settings.memoryTooHigh")}
              </p>
            )}
            {isStandard && (
              <p className="font-minecraft text-xs text-white/50">{t("profiles.settings.appliesToAllStandard")}</p>
            )}
          </div>
        )}
      </Section>

      <Section
        title={t("profiles.settings.customJavaInstallation")}
        aside={<ToggleSwitch checked={useCustomJava} onChange={handleCustomJavaToggle} size="sm" />}
      >
        {!useCustomJava ? (
          <p className="flex items-center gap-2 font-minecraft text-sm text-white/60">
            <Icon icon="solar:magic-stick-3-bold" className="h-4 w-4 shrink-0" />
            {t("profiles.settings.defaultJavaDescription")}
          </p>
        ) : (
          <div className="space-y-3">
            {isDetectingJava ? (
              <div className="flex items-center gap-2 font-smallcaps text-white/60">
                <Icon icon="svg-spinners:ring-resize" className="h-5 w-5" />
                {t("profiles.settings.detectingJava")}
              </div>
            ) : (
              detectedJavaInstallations.length > 0 && (
                <div className="space-y-1.5">
                  <p className="font-minecraft text-xs text-white/50">{t("profiles.settings.detectedJavaInstallations")}</p>
                  <div className="custom-scrollbar max-h-48 space-y-1.5 overflow-y-auto">
                    {detectedJavaInstallations.map((java) => {
                      const selected = customJavaPathInput === java.path;
                      return (
                        <Chip
                          key={java.path}
                          active={selected}
                          accent={accentColor.value}
                          onClick={() => handleDetectedJavaListItemClick(java)}
                          title={java.path}
                          className="flex w-full items-center gap-3 px-3 py-2 text-left"
                        >
                          <span className="shrink-0 rounded border border-white/15 px-1.5 py-0.5 text-xs">
                            Java {java.major_version}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm">{java.vendor}</span>
                            <span className="block truncate text-xs normal-case text-white/40">{java.path}</span>
                          </span>
                          <span className="shrink-0 text-xs text-white/40">{java.architecture}</span>
                        </Chip>
                      );
                    })}
                  </div>
                </div>
              )
            )}

            <div className="space-y-1.5">
              <label htmlFor="custom-java-path-input" className="block font-minecraft text-xs text-white/50">
                {t("profiles.settings.manualJavaPath")}
              </label>
              <div className="flex items-center gap-2 rounded-lg border border-white/10 bg-black/40 py-1.5 pl-3 pr-1.5 transition-colors focus-within:border-white/30 hover:border-white/20">
                <Icon icon="solar:file-bold" className="h-4 w-4 shrink-0 text-white/40" />
                <input
                  id="custom-java-path-input"
                  value={customJavaPathInput}
                  onChange={(e) => handleJavaPathInputChange(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && customJavaPathInput) testCustomJavaPath();
                  }}
                  placeholder={t("placeholders.java_path")}
                  spellCheck={false}
                  autoComplete="off"
                  title={customJavaPathInput}
                  className="min-w-0 flex-1 bg-transparent font-minecraft text-sm normal-case text-white placeholder-white/30 outline-none"
                />
                <IconAction
                  icon="solar:folder-with-files-bold"
                  label={t("profiles.settings.browse_java")}
                  onClick={browseForJavaPath}
                />
                <IconAction
                  icon="solar:check-circle-bold"
                  label={t("profiles.settings.testAndUsePath")}
                  tone="accent"
                  busy={isValidatingJavaPath}
                  disabled={!customJavaPathInput}
                  onClick={() => testCustomJavaPath()}
                />
              </div>
            </div>
          </div>
        )}
      </Section>

      <Section
        title={isStandard ? t("profiles.settings.globalCustomJavaArgs") : t("profiles.settings.customJavaArgs")}
        aside={
          <ToggleSwitch
            checked={useCustomArgs}
            onChange={handleCustomArgsToggle}
            size="sm"
            disabled={isStandard && isLoadingGlobalJvmArgs}
          />
        }
      >
        {!useCustomArgs ? (
          <div className="space-y-1.5">
            <p className="font-minecraft text-sm text-white/60">{t("profiles.settings.javaArgsHint")}</p>
            {defaultJvmArgs && (
              <p className="font-minecraft text-xs normal-case text-white/40">
                {t("profiles.settings.javaArgsDefaults")}: {defaultJvmArgs}
              </p>
            )}
          </div>
        ) : isStandard && isLoadingGlobalJvmArgs ? (
          <div className="flex items-center gap-2 font-smallcaps text-white/60">
            <Icon icon="svg-spinners:ring-resize" className="h-5 w-5" />
            {t("profiles.settings.loadingSettings")}
          </div>
        ) : (
          <div className="space-y-2">
            <SearchStyleTextArea
              value={argsDraft}
              onChange={(e) => handleJavaArgsChange(e.target.value)}
              placeholder={defaultJvmArgs || t("profiles.settings.enterJavaArgs")}
              minHeight="90px"
            />
            <p className="font-minecraft text-xs text-white/50">
              {t("profiles.settings.javaArgsHint")}
              {isStandard && <span className="mt-1 block">{t("profiles.settings.appliesToAllStandard")}</span>}
            </p>
          </div>
        )}
      </Section>
    </div>
  );
}
