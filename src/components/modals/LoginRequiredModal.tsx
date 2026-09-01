"use client";

import { useEffect, useRef } from "react";
import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";
import { Modal } from "../ui/Modal";
import { Button } from "../ui/buttons/Button";
import { useThemeStore } from "../../store/useThemeStore";
import { useMinecraftAuthStore } from "../../store/minecraft-auth-store";
import { useAddMinecraftAccount } from "../../hooks/useAddMinecraftAccount";

interface LoginRequiredModalProps {
  onClose: () => void;
  /** Name of the profile the user tried to launch, shown as context. */
  profileName?: string;
  /** Fired once an account is active, so the interrupted launch can resume. */
  onAuthenticated?: () => void;
}

/**
 * Shown when Play is pressed without a signed-in account.
 *
 * The backend would otherwise reject the launch with a bare
 * `NoCredentialsError`, surfacing as a red toast — a poor thing to hand a new
 * user. This takes over before the launch is attempted and turns the dead end
 * into the sign-in step, resuming the launch afterwards.
 *
 * Uses the shared `Modal` rather than its own surface: this appears inside the
 * running app alongside every other dialog, so looking different from them
 * would read as a style break, not as polish. The welcome screen can afford its
 * own look because it stands alone as the front door.
 */
export function LoginRequiredModal({
  onClose,
  profileName,
  onAuthenticated,
}: LoginRequiredModalProps) {
  const { t } = useTranslation();
  const accentColor = useThemeStore((s) => s.accentColor);
  const isLoading = useMinecraftAuthStore((s) => s.isLoading);
  const activeAccount = useMinecraftAuthStore((s) => s.activeAccount);
  const { startLogin } = useAddMinecraftAccount();

  // Resume the launch the moment an account becomes active. Guarded by a ref so
  // a re-render after closing cannot fire it twice.
  const resumedRef = useRef(false);
  useEffect(() => {
    if (!activeAccount || resumedRef.current) return;
    resumedRef.current = true;
    onClose();
    onAuthenticated?.();
  }, [activeAccount, onClose, onAuthenticated]);

  return (
    <Modal
      title={t("auth.login_required.headline")}
      titleIcon={<Icon icon="solar:login-3-bold" className="w-5 h-5" />}
      onClose={onClose}
      width="sm"
    >
      <div className="p-6 flex flex-col items-center text-center">
        {profileName && (
          <div className="flex items-center gap-2 mb-4">
            <Icon icon="solar:play-bold" className="w-3.5 h-3.5" style={{ color: accentColor.value }} />
            <span className="text-xs font-minecraft text-white/70 truncate max-w-[18rem]">
              {t("auth.login_required.for_profile", { profile: profileName })}
            </span>
          </div>
        )}

        <p className="text-sm font-minecraft text-white/70 leading-relaxed">
          {t("auth.login_required.description")}
        </p>

        <Button
          onClick={startLogin}
          disabled={isLoading}
          variant="default"
          size="md"
          widthClassName="w-full"
          className="mt-6"
          icon={
            <Icon
              icon={isLoading ? "svg-spinners:ring-resize" : "simple-icons:microsoft"}
              className="w-5 h-5"
            />
          }
        >
          {isLoading ? t("auth.login_required.cta_loading") : t("auth.login_required.cta")}
        </Button>

        <button
          onClick={onClose}
          className="mt-3 text-xs font-minecraft text-white/40 hover:text-white/75 transition-colors"
        >
          {t("auth.login_required.later")}
        </button>
      </div>
    </Modal>
  );
}
