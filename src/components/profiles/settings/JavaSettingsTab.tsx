"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "@iconify/react";
import type { Profile } from "../../../types/profile";
import { Button } from "../../ui/buttons/Button";
import { useThemeStore } from "../../../store/useThemeStore";
import { RangeSlider } from "../../ui/RangeSlider";
import { Input, SearchStyleTextArea } from "../../ui/Input";
import { Checkbox } from "../../ui/Checkbox";
import { Card } from "../../ui/Card";
import { gsap } from "gsap";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { toast } from "react-hot-toast";
import { cn } from "../../../lib/utils";
import { getGlobalMemorySettings, setGlobalMemorySettings, getGlobalCustomJvmArgs, setGlobalCustomJvmArgs } from "../../../services/launcher-config-service";
import type { MemorySettings } from "../../../types/launcherConfig";
import { useTranslation } from "react-i18next";

interface JavaSettingsTabProps {
  editedProfile: Profile;
  updateProfile: (updates: Partial<Profile>) => void;
  systemRam: number;
  tempRamMb: number;
  setTempRamMb: (value: number) => void;
}

// New type for Java Installation
interface JavaInstallation {
  path: string;
  major_version: number;
  vendor: string;
  architecture: string;
  is_default?: boolean; // Optional: if your backend provides this
}

export function JavaSettingsTab({
  editedProfile,
  updateProfile,
  systemRam,
  tempRamMb,
  setTempRamMb,
}: JavaSettingsTabProps) {
  const { t } = useTranslation();
  const [useCustomJava, setUseCustomJava] = useState(
    editedProfile.settings?.use_custom_java_path ?? false,
  );
  const [useCustomArgs, setUseCustomArgs] = useState(
    (editedProfile.settings?.custom_jvm_args?.length || 0) > 0,
  );
  const accentColor = useThemeStore((state) => state.accentColor);
  const isBackgroundAnimationEnabled = useThemeStore(
    (state) => state.isBackgroundAnimationEnabled,
  );
  const tabRef = useRef<HTMLDivElement>(null);
  const javaInstallRef = useRef<HTMLDivElement>(null);
  const memoryRef = useRef<HTMLDivElement>(null);
  const argsRef = useRef<HTMLDivElement>(null);

  // New state variables for Java detection and validation
  const [detectedJavaInstallations, setDetectedJavaInstallations] = useState<
    JavaInstallation[]
  >([]);
  const [isDetectingJava, setIsDetectingJava] = useState(false);
  const [javaDetectionError, setJavaDetectionError] = useState<string | null>(
    null,
  );
  const [customJavaPathInput, setCustomJavaPathInput] = useState(
    editedProfile.settings?.java_path || "",
  );
  const [isValidatingJavaPath, setIsValidatingJavaPath] = useState(false);
  const [validationResult, setValidationResult] = useState<
    "valid" | "invalid" | "error" | null
  >(null);
  const [validationMessage, setValidationMessage] = useState<string | null>(
    null,
  );
  
  // Global memory settings for standard profiles
  const [globalMemorySettings, setGlobalMemorySettingsState] = useState<MemorySettings | null>(null);
  const [isLoadingGlobalMemory, setIsLoadingGlobalMemory] = useState(false);
  const [isSystemRamLoaded, setIsSystemRamLoaded] = useState(false);

  // Global JVM args for standard profiles
  const [globalJvmArgs, setGlobalJvmArgsState] = useState<string | null>(null);
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

      const elements = [
        javaInstallRef.current,
        memoryRef.current,
        argsRef.current,
      ].filter(Boolean);

      if (elements.length > 0) {
        gsap.fromTo(
          elements,
          { opacity: 0, y: 20 },
          {
            opacity: 1,
            y: 0,
            duration: 0.4,
            stagger: 0.1,
            ease: "power2.out",
            delay: 0.2,
          },
        );
      }
    }
  }, [isBackgroundAnimationEnabled]);

  const detectJavaInstallations = async () => {
    setIsDetectingJava(true);
    setJavaDetectionError(null);
    setValidationResult(null);
    setValidationMessage(null);
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
          // await testCustomJavaPath(preselected.path); // Optionally auto-test
        }
      }
    } catch (error) {
      console.error("Error detecting Java installations:", error);
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      setJavaDetectionError(errorMessage); // Store for internal reference if needed
      toast.error(t('java.detect_failed', { error: errorMessage }));
      setDetectedJavaInstallations([]);
    } finally {
      setIsDetectingJava(false);
    }
  };

  useEffect(() => {
    detectJavaInstallations();
  }, []);

  // Track when systemRam changes from initial value
  useEffect(() => {
    if (systemRam !== 8192) {
      setIsSystemRamLoaded(true);
    }
  }, [systemRam]);

  // Load global memory settings for standard profiles
  useEffect(() => {
    if (editedProfile.is_standard_version) {
      setIsLoadingGlobalMemory(true);
      getGlobalMemorySettings()
        .then((settings) => {
          setGlobalMemorySettingsState(settings);
          // Synchronize tempRamMb with global settings for standard profiles
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
      // For custom profiles, we're not loading anything
      setIsLoadingGlobalMemory(false);
    }
  }, [editedProfile.is_standard_version, setTempRamMb]);

  // Load global JVM args for standard profiles
  useEffect(() => {
    if (editedProfile.is_standard_version) {
      setIsLoadingGlobalJvmArgs(true);
      getGlobalCustomJvmArgs()
        .then((args) => {
          setGlobalJvmArgsState(args);
          // Initialize useCustomArgs based on whether global args exist
          setUseCustomArgs((args?.length || 0) > 0);
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
    setValidationResult(null);
    setValidationMessage(null);
    try {
      const isValid: boolean = await invoke("validate_java_path_command", {
        path: currentPath,
      });
      if (isValid) {
        setValidationResult("valid");
        toast.success(t('java.path_valid'));
        updateProfile({
          settings: {
            ...editedProfile.settings,
            java_path: currentPath,
            use_custom_java_path: true,
          },
        });
      } else {
        setValidationResult("invalid");
        toast.error(t('java.path_invalid'));
      }
    } catch (error: any) {
      console.error(`Error validating Java path ${currentPath}:`, error);
      setValidationResult("error");
      const message = error?.message?.includes("Java path does not exist")
        ? t('java.path_not_exist')
        : error?.message || String(error);
      toast.error(t('java.validation_error', { error: message }));
    } finally {
      setIsValidatingJavaPath(false);
    }
  };

  let recommendedMaxRam;
  if (systemRam <= 8192) {
    recommendedMaxRam = Math.min(2048, systemRam);
  } else {
    recommendedMaxRam = Math.min(4096, systemRam);
  }
  
  // Use global memory settings for standard profiles, profile settings for custom profiles
  const memory = editedProfile.is_standard_version
    ? (globalMemorySettings || { min: 1024, max: recommendedMaxRam })
    : (editedProfile.settings?.memory || { min: 1024, max: recommendedMaxRam });

  const handleMemoryChange = async (value: number) => {
    if (editedProfile.is_standard_version) {
      // For standard profiles, save to global settings
      const newGlobalSettings: MemorySettings = {
        min: memory.min,
        max: value,
      };
      
      try {
        await setGlobalMemorySettings(newGlobalSettings);
        setGlobalMemorySettingsState(newGlobalSettings);
      } catch (error) {
        console.error("Failed to save global memory settings:", error);
        toast.error(t('java.save_ram_failed'));
      }
    } else {
      // For custom profiles, save to profile settings
      const newSettings = { ...editedProfile.settings };
      if (!newSettings.memory) {
        newSettings.memory = {
          min: 1024,
          max: value,
        };
      } else {
        newSettings.memory.max = value;
      }
      updateProfile({ settings: newSettings });
    }
  };

  const handleJavaPathInputChange = (newPath: string) => {
    setCustomJavaPathInput(newPath);
    setValidationResult(null);
  };

  const handleDetectedJavaListItemClick = (installation: JavaInstallation) => {
    setCustomJavaPathInput(installation.path);
    testCustomJavaPath(installation.path); // Auto-test selected detected path
  };

  const handleJavaArgsChange = async (args: string) => {
    if (editedProfile.is_standard_version) {
      // For standard profiles, save to global settings
      try {
        await setGlobalCustomJvmArgs(args || null);
        setGlobalJvmArgsState(args || null);
      } catch (error) {
        console.error("Failed to save global JVM args:", error);
        toast.error(t('java.save_jvm_failed'));
      }
    } else {
      // For custom profiles, save to profile settings
      const newSettings = { ...editedProfile.settings };
      newSettings.custom_jvm_args = args;
      updateProfile({ settings: newSettings });
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
      updateProfile({
        settings: { ...editedProfile.settings, use_custom_java_path: true },
      });
    } else {
      updateProfile({
        settings: { ...editedProfile.settings, use_custom_java_path: false },
      });
      setValidationResult(null);
    }
  };

  const handleCustomArgsToggle = async (checked: boolean) => {
    setUseCustomArgs(checked);

    const defaultArgs = [
      "-XX:+UseG1GC",
      "-XX:+ParallelRefProcEnabled",
      "-XX:MaxGCPauseMillis=200",
    ].join(" ");

    if (editedProfile.is_standard_version) {
      // For standard profiles, save to global settings
      try {
        if (checked) {
          const argsToSet = globalJvmArgs || defaultArgs;
          await setGlobalCustomJvmArgs(argsToSet);
          setGlobalJvmArgsState(argsToSet);
        } else {
          await setGlobalCustomJvmArgs(null);
          setGlobalJvmArgsState(null);
        }
      } catch (error) {
        console.error("Failed to save global JVM args:", error);
        toast.error(t('java.save_jvm_failed'));
      }
    } else {
      // For custom profiles, save to profile settings
      const newSettings = { ...editedProfile.settings };
      if (checked) {
        if (!newSettings.custom_jvm_args) {
          newSettings.custom_jvm_args = defaultArgs;
        }
      } else {
        newSettings.custom_jvm_args = null;
      }
      updateProfile({ settings: newSettings });
    }

    if (checked && isBackgroundAnimationEnabled) {
      const textareaContainer = argsRef.current?.querySelector(
        ".custom-args-textarea",
      );
      if (textareaContainer) {
        gsap.fromTo(
          textareaContainer,
          { opacity: 0, height: 0 },
          {
            opacity: 1,
            height: "auto",
            duration: 0.3,
            ease: "power2.out",
          },
        );
      }
    }
  };


  return (
    <div ref={tabRef} className="space-y-6 select-none">
      <div ref={memoryRef} className="space-y-4">
        <div>
          <h3 className="text-3xl font-minecraft text-white mb-3 lowercase">
            {editedProfile.is_standard_version ? t('profiles.settings.globalMemoryAllocated') : t('profiles.settings.memoryAllocated')}
          </h3>
          <Card
            variant="flat"
            className="p-4 border border-white/10 bg-black/20"
          >
            {(editedProfile.is_standard_version && (isLoadingGlobalMemory || !globalMemorySettings)) || !isSystemRamLoaded ? (
              <div className="flex items-center justify-center py-8">
                <Icon icon="solar:refresh-bold" className="w-6 h-6 animate-spin text-white mr-3" />
                <span className="text-white font-minecraft">
                  {t('profiles.settings.loadingSettings')}
                </span>
              </div>
            ) : (
              <>
                <RangeSlider
                  value={tempRamMb}
                  onChange={(value) => {
                    setTempRamMb(value);
                    // For standard profiles, save to global settings immediately
                    if (editedProfile.is_standard_version) {
                      handleMemoryChange(value);
                    }
                  }}
                  min={512}
                  max={systemRam}
                  step={512}
                  valueLabel={`${tempRamMb} MB (${(tempRamMb / 1024).toFixed(1)} GB)`}
                  minLabel="512 MB"
                  maxLabel={`${systemRam} MB`}
                  variant="flat"
                  recommendedRange={[4096, 8192]}
                  unit="MB"
                />
                <div className="mt-3 text-xs text-white/70 tracking-wide font-minecraft-ten">
                  {t('profiles.settings.recommended')}: {recommendedMaxRam} MB (
                  {(recommendedMaxRam / 1024).toFixed(1)} GB)
                  {editedProfile.is_standard_version && (
                    <div className="mt-1 text-accent font-minecraft-ten">
                      {t('profiles.settings.appliesToAllStandard')}
                    </div>
                  )}
                </div>
              </>
            )}
          </Card>
        </div>
      </div>

      <div ref={javaInstallRef} className="space-y-4">
        <div>

          <div className="mb-3">
            <Checkbox
              checked={useCustomJava}
              onChange={(e) => handleCustomJavaToggle(e.target.checked)}
              label={t('profiles.settings.customJavaInstallation')}
              className="text-2xl"
              variant="flat"
            />
          </div>

          {!useCustomJava && (
            <div className="mt-3">
              <div className="text-2xl text-white font-minecraft mb-2 lowercase tracking-wide select-none">
                {t('profiles.settings.usingDefaultJava')}
              </div>
              <div className="text-xs text-white/70 font-minecraft-ten break-all lowercase tracking-wide select-none">
                {t('profiles.settings.defaultJavaDescription')}
              </div>
            </div>
          )}

          {useCustomJava && (
            <div className="mt-3 space-y-4">
              {isDetectingJava && (
                <div className="flex items-center text-white/70 font-minecraft">
                  <Icon
                    icon="solar:refresh-bold"
                    className="w-5 h-5 mr-2 animate-spin"
                  />
                  <span>{t('profiles.settings.detectingJava')}</span>
                </div>
              )}

              <div>
                <label
                  htmlFor="custom-java-path-input"
                  className="block text-xs text-white/70 font-minecraft-ten mt-3 mb-2 tracking-wide"
                >
                  {t('profiles.settings.manualJavaPath')}
                </label>
                <div className="flex gap-3">
                  <Input
                    id="custom-java-path-input"
                    value={customJavaPathInput}
                    onChange={(e) => handleJavaPathInputChange(e.target.value)}
                    placeholder={t('placeholders.java_path')}
                    className="flex-1 text-2xl py-3"
                    variant="flat"
                  />
                  <Button
                    variant="secondary"
                    size="md"
                    onClick={browseForJavaPath}
                    shadowDepth="short"
                    icon={
                      <Icon
                        icon="solar:folder-with-files-bold"
                        className="w-5 h-5 text-white"
                      />
                    }
                    className="text-2xl"
                    aria-label={t('profiles.settings.browse_java')}
                  >
                    {t('profiles.settings.browse')}
                  </Button>
                </div>
              </div>

              {detectedJavaInstallations.length > 0 && !isDetectingJava && (
                <div className="space-y-2 pt-2">
                  <h4 className="text-xs text-white/70 font-minecraft-ten mb-2 tracking-wide">
                    {t('profiles.settings.detectedJavaInstallations')}
                  </h4>
                  <div className="max-h-40 overflow-y-auto custom-scrollbar space-y-1 p-2 bg-black/10 rounded-lg">
                    {detectedJavaInstallations.map((java) => (
                      <button
                        key={java.path}
                        onClick={() => handleDetectedJavaListItemClick(java)}
                        title={java.path}
                        className={cn(
                          "w-full text-left p-2 border transition-all duration-150 font-minecraft-ten text-xs rounded-md",
                          customJavaPathInput === java.path
                            ? "bg-accent/30 border-accent text-white"
                            : "bg-black/20 border-white/10 hover:bg-black/30 hover:border-white/20 text-white/80",
                        )}
                        style={
                          customJavaPathInput === java.path
                            ? {
                                borderColor: accentColor.value,
                                backgroundColor: `${accentColor.value}20`,
                              }
                            : {}
                        }
                      >
                        <span className="block truncate">{java.path}</span>
                        <span className="block text-xs opacity-70 font-minecraft-ten truncate">
                          (v{java.major_version} - {java.vendor} -{" "}
                          {java.architecture})
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <Button
                variant="default"
                size="md"
                onClick={() => testCustomJavaPath()}
                disabled={isValidatingJavaPath || !customJavaPathInput}
                icon={
                  isValidatingJavaPath ? (
                    <Icon
                      icon="solar:refresh-bold"
                      className="w-5 h-5 animate-spin"
                    />
                  ) : (
                    <Icon icon="solar:test-tube-bold" className="w-5 h-5" />
                  )
                }
                className="text-2xl mt-2 w-full sm:w-auto"
              >
                {isValidatingJavaPath ? t('profiles.settings.testing') : t('profiles.settings.testAndUsePath')}
              </Button>
            </div>
          )}
        </div>
      </div>

      <div ref={argsRef} className="space-y-4">
        <div>

        <div className="mb-3">
          <Checkbox
            checked={useCustomArgs}
            onChange={(e) => handleCustomArgsToggle(e.target.checked)}
            label={editedProfile.is_standard_version ? t('profiles.settings.globalCustomJavaArgs') : t('profiles.settings.customJavaArgs')}
            className="text-2xl"
            variant="flat"
            disabled={editedProfile.is_standard_version && isLoadingGlobalJvmArgs}
          />
        </div>

        {useCustomArgs && (
          <div className="custom-args-textarea">
            {editedProfile.is_standard_version && isLoadingGlobalJvmArgs ? (
              <div className="flex items-center justify-center py-8">
                <Icon icon="solar:refresh-bold" className="w-6 h-6 animate-spin text-white mr-3" />
                <span className="text-white font-minecraft">{t('profiles.settings.loadingSettings')}</span>
              </div>
            ) : (
              <>
                <SearchStyleTextArea
                  value={editedProfile.is_standard_version
                    ? (globalJvmArgs || "")
                    : (editedProfile.settings?.custom_jvm_args || "")}
                  onChange={(e) => handleJavaArgsChange(e.target.value)}
                  placeholder={t('profiles.settings.enterJavaArgs')}
                  minHeight="100px"
                />
                <p className="mt-2 text-xs text-white/50 font-minecraft-ten tracking-wide">
                  {t('profiles.settings.javaArgsHint')}
                  {editedProfile.is_standard_version && (
                    <span className="block mt-1 text-accent">
                      {t('profiles.settings.appliesToAllStandard')}
                    </span>
                  )}
                </p>
              </>
            )}
          </div>
        )}
      </div>
    </div>
    </div>
  );
}
