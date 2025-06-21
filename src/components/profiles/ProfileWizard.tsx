"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "@iconify/react";
import { gsap } from "gsap";
import type {
  CreateProfileParams,
  ModLoader,  Profile,
} from "../../types/profile";
import type { MinecraftVersion, VersionManifest } from "../../types/minecraft";
import { useProfileStore } from "../../store/profile-store";
import { invoke } from "@tauri-apps/api/core";
import { Modal } from "../ui/Modal";
import { Button } from "../ui/buttons/Button";
import { StatusMessage } from "../ui/StatusMessage";
import { useThemeStore } from "../../store/useThemeStore";
import { WizardSidebar } from "./wizard/WizardSidebar";
import { GeneralStep } from "./wizard/GeneralStep";
import { VersionStep } from "./wizard/VersionStep";
import { ModLoaderStep } from "./wizard/ModLoaderStep";
import { WizardSummary } from "./wizard/WizardSummary";
import { toast } from "react-hot-toast";
import { Card } from "../ui/Card";

interface ProfileWizardProps {
  onClose: () => void;
  onSave: (profile: Profile) => void;
}

export function ProfileWizard({ onClose, onSave }: ProfileWizardProps) {
  const { createProfile } = useProfileStore();
  const accentColor = useThemeStore((state) => state.accentColor);
  const isBackgroundAnimationEnabled = useThemeStore(
    (state) => state.isBackgroundAnimationEnabled,
  );
  const [step, setStep] = useState(1);
  const [profile, setProfile] = useState<Partial<Profile>>({
    name: "",
    game_version: "",
    loader: "vanilla" as ModLoader,
    loader_version: null,
    description: null,
    group: null,
    settings: {
      memory: { min: 1024, max: 4096 },
      resolution: { width: 854, height: 480 },
      fullscreen: false,
      custom_jvm_args: null,
      java_path: null,
      use_custom_java_path: false,
      extra_game_args: [],
    },
  });
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [minecraftVersions, setMinecraftVersions] =
    useState<VersionManifest | null>(null);
  const [systemRamMb, setSystemRamMb] = useState<number>(8192);
  const contentRef = useRef<HTMLDivElement>(null);

  const totalSteps = 4;
  const stepTitles = ["details", "version", "mod loader", "summary"];
  const stepIcons = [
    "solar:user-bold",
    "solar:widget-bold",
    "solar:code-bold",
    "solar:check-circle-bold",
  ];

  useEffect(() => {
    const loadInitialData = async () => {
      setLoading(true);
      try {
        const versions = await invoke<VersionManifest>(
          "get_minecraft_versions",
        );
        setMinecraftVersions(versions);

        const latestRelease = versions.versions.find(
          (v: MinecraftVersion) => v.type === "release",
        );
        if (latestRelease && !profile.game_version) {
          setProfile((prev) => ({ ...prev, game_version: latestRelease.id }));
        }        try {
          const ramMb = await invoke<number>("get_system_ram_mb");
          setSystemRamMb(ramMb);

          let initialMaxMemory;
          if (ramMb <= 8192) {
            initialMaxMemory = Math.min(2048, ramMb);
          } else {
            initialMaxMemory = Math.min(4096, ramMb);
          }
          initialMaxMemory = Math.max(initialMaxMemory, 1024);

          setProfile((prev) => ({
            ...prev,
            settings: {
              ...prev.settings!,
              memory: {
                min: 1024,
                max: initialMaxMemory,
              },
            },
          }));
        } catch (err) {
          // System RAM detection failed, using defaults
        }      } catch (err) {
        setError("Failed to load Minecraft versions. Please try again.");
      } finally {
        setLoading(false);
      }
    };

    loadInitialData();
  }, []);

  useEffect(() => {
    if (isBackgroundAnimationEnabled && contentRef.current) {
      gsap.fromTo(
        contentRef.current,
        { opacity: 0, y: 20 },
        { opacity: 1, y: 0, duration: 0.3, ease: "power2.out" },
      );
    }
  }, [step, isBackgroundAnimationEnabled]);

  const updateProfile = (updates: Partial<Profile>) => {
    setProfile((prev) => ({ ...prev, ...updates }));
  };

  const handleNext = () => {
    if (step < totalSteps) {
      if (isBackgroundAnimationEnabled && contentRef.current) {
        gsap.to(contentRef.current, {
          opacity: 0,
          y: 20,
          duration: 0.2,
          ease: "power2.in",
          onComplete: () => setStep(step + 1),
        });
      } else {
        setStep(step + 1);
      }
    } else {
      handleCreate();
    }
  };

  const handleBack = () => {
    if (step > 1) {
      if (isBackgroundAnimationEnabled && contentRef.current) {
        gsap.to(contentRef.current, {
          opacity: 0,
          y: 20,
          duration: 0.2,
          ease: "power2.in",
          onComplete: () => setStep(step - 1),
        });
      } else {
        setStep(step - 1);
      }
    }
  };
  const handleStepClick = (stepNumber: number) => {
    if (stepNumber === step) {
      return;
    }
    
    if (stepNumber <= step || isStepValid(step)) {
      if (isBackgroundAnimationEnabled && contentRef.current) {
        gsap.to(contentRef.current, {
          opacity: 0,
          y: 20,
          duration: 0.2,
          ease: "power2.in",
          onComplete: () => setStep(stepNumber),
        });
      } else {
        setStep(stepNumber);
      }
    }
  };

  const isStepValid = (stepNumber: number) => {
    switch (stepNumber) {
      case 1:
        return !!profile.name;
      case 2:
        return !!profile.game_version;
      case 3:
        return true;
      default:
        return true;
    }
  };

  const handleCreate = async () => {
    setCreating(true);
    setError(null);

    if (!profile.name) {
      setError("Profile name is required");
      setCreating(false);
      toast.error("Profile name is required");
      return;
    }

    if (!profile.game_version) {
      setError("Minecraft version is required");
      setCreating(false);
      toast.error("Minecraft version is required");
      return;
    }

    const creationPromise = async () => {
      const createParams: CreateProfileParams = {
        name: profile.name!,
        game_version: profile.game_version!,
        loader: profile.loader || "vanilla",
        loader_version: profile.loader_version || undefined,
        selected_norisk_pack_id:
          profile.selected_norisk_pack_id || null || undefined,
      };

      const profileId = await createProfile(createParams);

      if (profile.description || profile.group || profile.settings) {
        await useProfileStore.getState().updateProfile(profileId, {
          description: profile.description,
          group: profile.group,
          settings: profile.settings,
        });
      }

      const createdProfile = await useProfileStore
        .getState()
        .getProfile(profileId);
      onSave(createdProfile);
      return createdProfile;
    };

    toast
      .promise(creationPromise(), {
        loading: "Creating profile...",
        success: (createdProf) =>
          `Profile '${createdProf.name}' created successfully!`,
        error: (err) =>
          `Failed to create profile: ${err instanceof Error ? err.message : String(err)}`,
      })      .catch((err) => {
        setError(
          `Failed to create profile: ${err instanceof Error ? err.message : String(err)}`,
        );
      })
      .finally(() => {
        setCreating(false);
      });
  };

  const renderStepContent = () => {
    if (loading) {
      return (
        <Card
          variant="flat"
          className="flex flex-col items-center justify-center h-full p-8 bg-black/20 border border-white/10"
        >
          <div className="w-16 h-16 mb-4">
            <Icon
              icon="solar:refresh-bold"
              className="w-16 h-16 text-white animate-spin"
            />
          </div>
          <p className="text-2xl font-minecraft text-white lowercase">
            loading...
          </p>
        </Card>
      );
    }

    if (error && step !== 4) {
      return <StatusMessage type="error" message={error} />;
    }

    switch (step) {
      case 1:
        return (
          <GeneralStep
            profile={profile}
            updateProfile={updateProfile}
            systemRamMb={systemRamMb}
          />
        );
      case 2:
        return (
          <VersionStep
            profile={profile}
            updateProfile={updateProfile}
            minecraftVersions={minecraftVersions?.versions || []}
          />
        );
      case 3:
        return (
          <ModLoaderStep profile={profile} updateProfile={updateProfile} />
        );
      case 4:
        return <WizardSummary profile={profile} error={error} />;
      default:
        return null;
    }
  };

  const canProceed = () => {
    switch (step) {
      case 1:
        return !!profile.name;
      case 2:
        return !!profile.game_version;
      case 3:
        return true;
      case 4:
        return !error;
      default:
        return false;
    }
  };

  const renderFooter = () => (
    <div className="flex justify-between">
      <div>
        {step > 1 && (
          <Button
            variant="secondary"
            onClick={handleBack}
            disabled={creating || loading}
            icon={<Icon icon="solar:arrow-left-bold" className="w-5 h-5" />}
            size="md"
            className="text-2xl"
          >
            back
          </Button>
        )}
      </div>
      <div className="flex gap-3">
        <Button
          variant="secondary"
          onClick={onClose}
          disabled={creating || loading}
          size="md"
          className="text-2xl"
        >
          cancel
        </Button>
        <Button
          variant="default"
          onClick={handleNext}
          disabled={creating || loading || !canProceed()}
          size="md"
          className="min-w-[180px] text-2xl"
          icon={
            step < totalSteps ? (
              <Icon icon="solar:arrow-right-bold" className="w-5 h-5" />
            ) : undefined
          }
          iconPosition={step < totalSteps ? "right" : "left"}
        >
          {creating ? (
            <>
              <Icon
                icon="solar:refresh-bold"
                className="w-5 h-5 animate-spin"
              />
              <span>creating...</span>
            </>
          ) : step < totalSteps ? (
            "next"
          ) : (
            "create profile"
          )}
        </Button>
      </div>
    </div>
  );
  return (    <Modal
      title="create new profile"
      onClose={onClose}
      width="xl"
      footer={renderFooter()}
    >
      <div className="flex h-[500px] overflow-hidden">
        <WizardSidebar
          currentStep={step}
          totalSteps={totalSteps}
          stepTitles={stepTitles}
          stepIcons={stepIcons}
          onStepClick={handleStepClick}
          isStepValid={isStepValid}
        />

        <div
          ref={contentRef}
          className="flex-1 p-6 overflow-y-auto custom-scrollbar"
        >
          {renderStepContent()}
        </div>
      </div>
    </Modal>
  );
}
