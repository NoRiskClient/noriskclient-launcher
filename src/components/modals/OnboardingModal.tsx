import { useEffect, useMemo, useState } from "react";
import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";
import { toast } from "react-hot-toast";
import { Modal } from "../ui/Modal";
import { Button } from "../ui/buttons/Button";
import { useThemeStore } from "../../store/useThemeStore";

interface OnboardingModalProps {
  isOpen: boolean;
  onClose: () => Promise<void> | void;
  onNavigate?: (tabId: string) => void;
}

interface OnboardingStep {
  key: string;
  icon: string;
  accentClassName: string;
  navTarget?: string;
  label: string;
  title: string;
  subtitle: string;
  description: string;
  tips: [string, string];
}

const ONBOARDING_STEPS: OnboardingStep[] = [
  {
    key: "welcome",
    icon: "solar:compass-bold",
    accentClassName: "text-sky-300",
    label: "Welcome",
    title: "welcome",
    subtitle: "A short tour of the launcher",
    description:
      "NoRisk Launcher is organized around the left navigation. You can start playing immediately, then come back to profiles, mods, cosmetics, and settings when you need them.",
    tips: [
      "Use the icons on the left to switch between the main launcher areas.",
      "You can close this tour now and replay it later from Settings.",
    ],
  },
  {
    key: "play",
    icon: "solar:play-bold",
    accentClassName: "text-emerald-300",
    navTarget: "play",
    label: "Play",
    title: "play",
    subtitle: "Start Minecraft from the main screen",
    description:
      "The Play screen keeps launching focused: choose the profile/version you want, check the selected account, then start the game.",
    tips: [
      "If no profile is selected, the launcher picks the first available profile.",
      "News and referral information stay on the side so launch controls remain easy to find.",
    ],
  },
  {
    key: "profiles",
    icon: "solar:user-id-bold",
    accentClassName: "text-violet-300",
    navTarget: "profiles",
    label: "Profiles",
    title: "profiles",
    subtitle: "Create and manage installations",
    description:
      "Profiles are separate Minecraft setups. Use them for different versions, mod loaders, modpacks, worlds, and launch settings.",
    tips: [
      "Create custom profiles when you want a setup that differs from the standard NoRisk profiles.",
      "Profile detail pages are where you manage worlds, screenshots, logs, and local content.",
    ],
  },
  {
    key: "mods",
    icon: "solar:widget-bold",
    accentClassName: "text-amber-300",
    navTarget: "mods",
    label: "Mods",
    title: "mods",
    subtitle: "Browse and install content",
    description:
      "The Mods area lets you search online content and add it to a profile without manually moving files around.",
    tips: [
      "Choose the target profile before installing so content lands in the right place.",
      "Profile content tabs let you enable, disable, update, or remove installed items later.",
    ],
  },
  {
    key: "cosmetics",
    icon: "solar:emoji-funny-circle-bold",
    accentClassName: "text-pink-300",
    navTarget: "skins",
    label: "Cosmetics",
    title: "cosmetics",
    subtitle: "Manage skins and capes",
    description:
      "Skins and capes live in their own areas. Sign in first, then upload, preview, apply, or manage your cosmetic items.",
    tips: [
      "Skin tools support uploads and imports by username, UUID, or URL.",
      "Cape uploads can be previewed before submission. Some capes may need review.",
    ],
  },
  {
    key: "settings",
    icon: "solar:settings-bold",
    accentClassName: "text-cyan-300",
    navTarget: "settings",
    label: "Settings",
    title: "settings",
    subtitle: "Tune launcher behavior",
    description:
      "Settings contains language, appearance, update behavior, analytics preference, data location, and advanced launch options.",
    tips: [
      "Most general launcher preferences save automatically after a short delay.",
      "Advanced hooks run system commands, so only enable them when you know what they do.",
    ],
  },
];

export function OnboardingModal({
  isOpen,
  onClose,
  onNavigate,
}: OnboardingModalProps) {
  const { t } = useTranslation();
  const accentColor = useThemeStore((state) => state.accentColor);
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [isClosing, setIsClosing] = useState(false);
  const [isDocked, setIsDocked] = useState(false);

  const currentStep = ONBOARDING_STEPS[currentStepIndex];
  const isFirstStep = currentStepIndex === 0;
  const isLastStep = currentStepIndex === ONBOARDING_STEPS.length - 1;
  const progressPercent = useMemo(
    () => ((currentStepIndex + 1) / ONBOARDING_STEPS.length) * 100,
    [currentStepIndex],
  );

  useEffect(() => {
    if (isOpen) {
      setIsClosing(false);
      setIsDocked(false);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const finish = async () => {
    if (isClosing) return;
    setIsClosing(true);
    try {
      await onClose();
      toast.success(
        t("onboarding.toast.completed", {
          defaultValue: "Onboarding completed. You can replay it from Settings.",
        }),
      );
    } catch (error) {
      console.error("[OnboardingModal] Failed to save onboarding state:", error);
      toast.error(
        t("onboarding.toast.failed", {
          defaultValue: "Failed to save onboarding state. Please try again.",
        }),
      );
      setIsClosing(false);
    }
  };

  const goToStep = (index: number) => {
    setCurrentStepIndex(Math.max(0, Math.min(index, ONBOARDING_STEPS.length - 1)));
  };

  const handleNavigate = () => {
    if (currentStep.navTarget && onNavigate) {
      onNavigate(currentStep.navTarget);
      setIsDocked(true);
    }
  };

  if (isDocked) {
    return (
      <div className="fixed left-1/2 top-4 z-[1000] w-[min(720px,calc(100vw-2rem))] -translate-x-1/2">
        <div
          className="border border-b-2 bg-black/75 px-4 py-3 shadow-2xl backdrop-blur-md"
          style={{
            borderColor: `${accentColor.value}80`,
            borderBottomColor: accentColor.value,
          }}
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <Icon
                icon={currentStep.icon}
                className={`h-7 w-7 flex-shrink-0 ${currentStep.accentClassName}`}
              />
              <div className="min-w-0">
                <div className="font-minecraft text-2xl lowercase text-white">
                  {t("onboarding.docked_title", {
                    section: t(`onboarding.steps.${currentStep.key}.label`, {
                      defaultValue: currentStep.label,
                    }),
                    defaultValue: "{{section}} is open",
                  })}
                </div>
                <div className="truncate font-minecraft-ten text-sm text-white/60">
                  {t("onboarding.docked_description", {
                    defaultValue: "The tour is docked while you look around.",
                  })}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="xs"
                onClick={finish}
                disabled={isClosing}
                icon={<Icon icon="solar:check-circle-bold" className="w-4 h-4" />}
              >
                {t("onboarding.button.finish", { defaultValue: "finish" })}
              </Button>
              <Button
                variant="flat"
                size="xs"
                onClick={() => setIsDocked(false)}
                disabled={isClosing}
                icon={<Icon icon="solar:full-screen-bold" className="w-4 h-4" />}
              >
                {t("onboarding.button.resume", { defaultValue: "resume" })}
              </Button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const footer = (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <Button
        variant="ghost"
        size="sm"
        onClick={finish}
        disabled={isClosing}
        icon={<Icon icon="solar:close-circle-bold" className="w-5 h-5" />}
      >
        {t("onboarding.button.skip", { defaultValue: "skip" })}
      </Button>

      <div className="flex flex-wrap items-center gap-3">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => goToStep(currentStepIndex - 1)}
          disabled={isFirstStep || isClosing}
          icon={<Icon icon="solar:alt-arrow-left-bold" className="w-5 h-5" />}
        >
          {t("onboarding.button.back", { defaultValue: "back" })}
        </Button>
        <Button
          variant="default"
          size="sm"
          onClick={isLastStep ? finish : () => goToStep(currentStepIndex + 1)}
          disabled={isClosing}
          icon={
            <Icon
              icon={isLastStep ? "solar:check-circle-bold" : "solar:alt-arrow-right-bold"}
              className="w-5 h-5"
            />
          }
          iconPosition="right"
        >
          {isLastStep
            ? t("onboarding.button.finish", { defaultValue: "finish" })
            : t("onboarding.button.next", { defaultValue: "next" })}
        </Button>
      </div>
    </div>
  );

  return (
    <Modal
      title={t("onboarding.title", { defaultValue: "Launcher Onboarding" })}
      titleIcon={<Icon icon="solar:compass-bold" className="w-7 h-7 text-white" />}
      titleSubtitle={
        <span className="font-minecraft-ten text-sm text-white/60">
          {t("onboarding.step_count", {
            current: currentStepIndex + 1,
            total: ONBOARDING_STEPS.length,
            defaultValue: "Step {{current}} of {{total}}",
          })}
        </span>
      }
      onClose={finish}
      closeOnClickOutside={false}
      width="xl"
      footer={footer}
      contentClassName="bg-black/35"
    >
      <div className="p-6 space-y-6 text-white">
        <div className="h-2 overflow-hidden rounded bg-white/10">
          <div
            className="h-full transition-all duration-300"
            style={{
              width: `${progressPercent}%`,
              backgroundColor: accentColor.value,
            }}
          />
        </div>

        <div className="grid gap-6 lg:grid-cols-[260px_minmax(0,1fr)]">
          <div className="space-y-2">
            {ONBOARDING_STEPS.map((step, index) => {
              const isActive = index === currentStepIndex;
              return (
                <button
                  key={step.key}
                  type="button"
                  onClick={() => goToStep(index)}
                  className="flex min-h-[48px] w-full items-center gap-3 border border-white/10 bg-white/[0.03] px-3 py-2 text-left transition-colors hover:bg-white/10"
                  style={{
                    borderColor: isActive ? `${accentColor.value}90` : undefined,
                    backgroundColor: isActive ? `${accentColor.value}22` : undefined,
                  }}
                >
                  <Icon icon={step.icon} className={`h-6 w-6 ${step.accentClassName}`} />
                  <span className="font-minecraft-ten text-base text-white/85">
                    {t(`onboarding.steps.${step.key}.label`, {
                      defaultValue: step.label,
                    })}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="min-h-[360px] border border-white/10 bg-black/25 p-6">
            <div className="flex h-full flex-col">
              <div className="mb-6 flex items-center gap-4">
                <div
                  className="flex h-16 w-16 items-center justify-center border border-white/15 bg-black/30"
                  style={{ borderColor: `${accentColor.value}70` }}
                >
                  <Icon
                    icon={currentStep.icon}
                    className={`h-10 w-10 ${currentStep.accentClassName}`}
                  />
                </div>
                <div className="min-w-0">
                  <h3 className="font-minecraft text-4xl lowercase text-white">
                    {t(`onboarding.steps.${currentStep.key}.title`, {
                      defaultValue: currentStep.title,
                    })}
                  </h3>
                  <p className="mt-1 font-minecraft-ten text-base text-white/60">
                    {t(`onboarding.steps.${currentStep.key}.subtitle`, {
                      defaultValue: currentStep.subtitle,
                    })}
                  </p>
                </div>
              </div>

              <p className="font-minecraft-ten text-lg leading-relaxed text-white/80">
                {t(`onboarding.steps.${currentStep.key}.description`, {
                  defaultValue: currentStep.description,
                })}
              </p>

              <div className="mt-6 grid gap-3 md:grid-cols-2">
                {[0, 1].map((tipIndex) => (
                  <div
                    key={tipIndex}
                    className="min-h-[92px] border border-white/10 bg-white/[0.04] p-4"
                  >
                    <div className="mb-2 flex items-center gap-2">
                      <Icon
                        icon="solar:check-circle-bold"
                        className="h-5 w-5 text-emerald-300"
                      />
                      <span className="font-minecraft-ten text-sm uppercase text-white/50">
                        {t("onboarding.tip_label", { defaultValue: "Tip" })}
                      </span>
                    </div>
                    <p className="font-minecraft-ten text-base leading-relaxed text-white/75">
                      {t(`onboarding.steps.${currentStep.key}.tips.${tipIndex}`, {
                        defaultValue: currentStep.tips[tipIndex],
                      })}
                    </p>
                  </div>
                ))}
              </div>

              <div className="mt-auto pt-6">
                {currentStep.navTarget && (
                  <Button
                    variant="flat"
                    size="sm"
                    onClick={handleNavigate}
                    icon={<Icon icon="solar:map-arrow-right-bold" className="w-5 h-5" />}
                  >
                    {t("onboarding.button.open_section", {
                      defaultValue: "open section",
                    })}
                  </Button>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </Modal>
  );
}
