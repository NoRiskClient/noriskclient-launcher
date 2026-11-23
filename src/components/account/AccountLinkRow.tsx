"use client";

import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";
import { Button } from "../ui/buttons/Button";
import { IconButton } from "../ui/buttons/IconButton";
import { openExternalUrl } from "../../services/tauri-service";

interface AccountLinkRowProps {
  icon: string;
  name: string;
  info?: string;
  iconClassName?: string;
  isLoading: boolean;
  isLinked: boolean;
  isProcessing: boolean;
  onLink: () => void;
  onUnlink: () => void;
  visitUrl?: string;
}

export function AccountLinkRow({
  icon,
  name,
  info,
  iconClassName,
  isLoading,
  isLinked,
  isProcessing,
  onLink,
  onUnlink,
  visitUrl,
}: AccountLinkRowProps) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center justify-between gap-3 px-3 py-2 bg-black/20 rounded-md min-h-[58px]">
      <div className="flex items-center min-w-0">
        <Icon icon={icon} className={`w-6 h-6 mr-3 ${iconClassName ?? "text-white/80"}`} />
        <div className="min-w-0">
          <p className="text-white/90 font-minecraft text-xs">{name}</p>
          {info && <p className="text-white/55 font-minecraft text-[10px] leading-tight">{info}</p>}
        </div>
      </div>
      <div className="flex items-center gap-2">
        {isLinked ? (
          <Button
            variant="destructive"
            size="sm"
            onClick={onUnlink}
            disabled={isProcessing || isLoading}
            icon={<Icon icon={isLoading ? "mdi:loading" : "mdi:link-off"} className={isLoading ? "animate-spin" : ""} />}
            widthClassName="w-[140px]"
          >
            {t('socials.button.unlink')}
          </Button>
        ) : (
          <Button
            variant="default"
            size="sm"
            onClick={onLink}
            disabled={isProcessing || isLoading}
            icon={<Icon icon={isLoading ? "mdi:loading" : "mdi:link-variant"} className={isLoading ? "animate-spin" : ""} />}
            widthClassName="w-[140px]"
          >
            {t('socials.button.link')}
          </Button>
        )}
        <IconButton
          variant="ghost"
          size="sm"
          onClick={() => visitUrl && openExternalUrl(visitUrl)}
          icon={<Icon icon="mdi:open-in-new" className="w-5 h-5" />}
          disabled={!visitUrl}
          className={!visitUrl ? "invisible" : ""}
        />
      </div>
    </div>
  );
}
