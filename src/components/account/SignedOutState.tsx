"use client";

import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";
import { EmptyState } from "../ui/EmptyState";
import { Button } from "../ui/buttons/Button";
import { useMinecraftAuthStore } from "../../store/minecraft-auth-store";
import { useAddMinecraftAccount } from "../../hooks/useAddMinecraftAccount";

interface SignedOutStateProps {
  /** Iconify name, normally the one the surface already uses elsewhere. */
  icon: string;
  /** Headline, already translated. */
  title: string;
  /** One line naming what signing in unlocks. */
  description: string;
}

/**
 * Stand-in for surfaces that have nothing to show until someone signs in.
 *
 * Skins and Capes previously rendered a bare line of italic text on an empty
 * page, which reads as broken rather than as a precondition. Built on the
 * shared `EmptyState` so it matches every other empty surface in the app; the
 * only thing added is the sign-in button, since the point here is to give the
 * user the one action that fills the page.
 */
export function SignedOutState({ icon, title, description }: SignedOutStateProps) {
  const { t } = useTranslation();
  const isLoading = useMinecraftAuthStore((s) => s.isLoading);
  const { startLogin } = useAddMinecraftAccount();

  return (
    <EmptyState
      icon={icon}
      message={title}
      description={description}
      smallDescription
      action={
        <Button
          onClick={startLogin}
          disabled={isLoading}
          variant="default"
          size="md"
          icon={
            <Icon
              icon={isLoading ? "svg-spinners:ring-resize" : "simple-icons:microsoft"}
              className="w-5 h-5"
            />
          }
        >
          {isLoading ? t("auth.login_required.cta_loading") : t("auth.login_required.cta")}
        </Button>
      }
    />
  );
}
