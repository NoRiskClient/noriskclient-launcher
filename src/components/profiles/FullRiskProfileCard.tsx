"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Profile } from "../../types/profile";
import { useProfileLaunch } from "../../hooks/useProfileLaunch";
import { Button } from "../ui/buttons/Button";
import { ProfileIconV2 } from "./ProfileIconV2";
import { resolveImagePath } from "../../services/profile-service";
import { convertFileSrc } from "@tauri-apps/api/core";
import { SettingsContextMenu, type ContextMenuItem } from "../ui/SettingsContextMenu";
import { useProfileSettingsStore } from "../../store/profile-settings-store";
import { useProfileDuplicateStore } from "../../store/profile-duplicate-store";
import { usePinnedProfilesStore } from "../../store/usePinnedProfilesStore";
import { useThemeStore } from "../../store/useThemeStore";
import { useGlobalModal } from "../../hooks/useGlobalModal";
import { ExportProfileModal } from "./ExportProfileModal";
import { useTranslation } from "react-i18next";
import { toast } from "react-hot-toast";
import { shareProfile } from "../../services/profile-share-service";

interface FullRiskProfileCardProps {
  profile: Profile;
  onSettings?: (profile: Profile) => void;
  onMods?: (profile: Profile) => void;
  onDelete?: (profileId: string, profileName: string) => void;
  onOpenFolder?: (profile: Profile) => void;
}

const VERSION_BANNERS: Array<{ match: string; image: string }> = [
  { match: "1.21", image: "/background.jpeg" },
  { match: "1.20", image: "/background.jpeg" },
  { match: "1.19", image: "/background.jpeg" },
  { match: "1.18", image: "/background.jpeg" },
];

const DEFAULT_VERSION_BANNER = "/background.jpeg";

export function FullRiskProfileCard({
  profile,
  onSettings,
  onMods,
  onDelete,
  onOpenFolder,
}: FullRiskProfileCardProps) {
  const { t } = useTranslation();
  const [isHovered, setIsHovered] = useState(false);
  const [resolvedBannerUrl, setResolvedBannerUrl] = useState<string | null>(null);
  const [isContextMenuOpen, setIsContextMenuOpen] = useState(false);
  const [contextMenuPosition, setContextMenuPosition] = useState({ x: 0, y: 0 });
  const settingsButtonRef = useRef<HTMLButtonElement>(null);
  const { isLaunching, handleLaunch } = useProfileLaunch({
    profileId: profile.id,
  });
  const { openModal } = useProfileSettingsStore();
  const { openModal: openDuplicateModal } = useProfileDuplicateStore();
  const { isPinned, togglePin } = usePinnedProfilesStore();
  const { showModal, hideModal } = useGlobalModal();
  const { openContextMenuId, setOpenContextMenuId } = useThemeStore();
  const contextMenuId = `fullrisk-profile-${profile.id}`;
  const pinned = isPinned(profile.id);
  const trimmedProfileName = profile.name.toLowerCase();
  const nameFontSize = trimmedProfileName.length > 24 ? 24 : trimmedProfileName.length > 18 ? 30 : 36;

  const mappedBannerUrl = useMemo(() => {
    const matchedBanner = VERSION_BANNERS.find(({ match }) =>
      profile.game_version?.startsWith(match),
    );
    return matchedBanner?.image ?? DEFAULT_VERSION_BANNER;
  }, [profile.game_version]);

  useEffect(() => {
    let isMounted = true;

    const loadBanner = async () => {
      if (!profile.background?.source) {
        if (isMounted) {
          setResolvedBannerUrl(mappedBannerUrl);
        }
        return;
      }

      try {
        const resolvedPath = await resolveImagePath(profile.background.source, profile.id);
        if (!isMounted || !resolvedPath) {
          return;
        }

        const resolvedUrl = ["absolutePath", "relativePath", "relativeProfile"].includes(profile.background.source.type)
          ? convertFileSrc(resolvedPath)
          : resolvedPath;

        setResolvedBannerUrl(resolvedUrl);
      } catch {
        if (isMounted) {
          setResolvedBannerUrl(mappedBannerUrl);
        }
      }
    };

    loadBanner();

    return () => {
      isMounted = false;
    };
  }, [mappedBannerUrl, profile.background, profile.id]);

  const calculateContextMenuPosition = useCallback(
    (anchorClientX: number, anchorClientY: number, alignRight: boolean = false) => {
      const menuWidth = 200;
      const maxMenuHeight = 245;
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      const spacing = 8;

      const spaceBelow = viewportHeight - anchorClientY - spacing;
      const spaceAbove = anchorClientY - spacing;
      const openDownward = spaceBelow >= maxMenuHeight || spaceBelow >= spaceAbove;
      const menuHeight = Math.max(
        0,
        Math.min(maxMenuHeight, openDownward ? spaceBelow : spaceAbove),
      );

      let menuTop = openDownward ? anchorClientY + 2 : anchorClientY - menuHeight - 2;
      menuTop = Math.max(spacing, Math.min(menuTop, viewportHeight - menuHeight - spacing));

      let menuLeft = alignRight ? anchorClientX - menuWidth : anchorClientX;
      menuLeft = Math.max(spacing, Math.min(menuLeft, viewportWidth - menuWidth - spacing));

      return { x: menuLeft, y: menuTop };
    },
    [],
  );

  const openContextMenuAtCursor = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();

      if (openContextMenuId && openContextMenuId !== contextMenuId) {
        setOpenContextMenuId(null);
      }

      setContextMenuPosition(calculateContextMenuPosition(e.clientX, e.clientY));
      setIsContextMenuOpen(true);
      setOpenContextMenuId(contextMenuId);
    },
    [calculateContextMenuPosition, contextMenuId, openContextMenuId, setOpenContextMenuId],
  );

  const toggleContextMenuFromButton = useCallback(
    (e: React.MouseEvent<HTMLButtonElement>) => {
      e.preventDefault();
      e.stopPropagation();

      if (openContextMenuId && openContextMenuId !== contextMenuId) {
        setOpenContextMenuId(null);
      }

      const newState = !isContextMenuOpen;
      setIsContextMenuOpen(newState);
      setOpenContextMenuId(newState ? contextMenuId : null);

      if (newState) {
        const buttonRect = e.currentTarget.getBoundingClientRect();
        setContextMenuPosition(
          calculateContextMenuPosition(buttonRect.right, buttonRect.bottom, true),
        );
      }
    },
    [calculateContextMenuPosition, contextMenuId, isContextMenuOpen, openContextMenuId, setOpenContextMenuId],
  );

  const contextMenuItems: ContextMenuItem[] = [
    {
      id: "pin",
      label: pinned ? "Unpin" : "Pin to Top",
      icon: pinned ? "solar:pin-bold" : "solar:pin-bold-duotone",
      onClick: () => togglePin(profile.id),
    },
    {
      id: "edit",
      label: t("profiles.editProfile"),
      icon: "solar:settings-bold",
      onClick: () => {
        if (onSettings) {
          onSettings(profile);
          return;
        }
        openModal(profile);
      },
    },
    {
      id: "duplicate",
      label: t("profiles.duplicate"),
      icon: "solar:copy-bold",
      onClick: () => openDuplicateModal(profile),
    },
    {
      id: "export",
      label: t("profiles.export"),
      icon: "solar:download-bold",
      onClick: () => {
        showModal(
          `export-profile-${profile.id}`,
          <ExportProfileModal
            profile={profile}
            isOpen={true}
            onClose={() => hideModal(`export-profile-${profile.id}`)}
          />,
        );
      },
    },
    {
      id: "share",
      label: "Share",
      icon: "solar:share-bold",
      onClick: async () => {
        const result = await toast.promise(shareProfile(profile, 24), {
          loading: "Creating share code...",
          success: (share) => `Share code: ${share.code}`,
          error: (err) => err instanceof Error ? err.message : String(err),
        });
        await navigator.clipboard?.writeText(result.code).catch(() => undefined);
      },
    },
    {
      id: "open-folder",
      label: t("profiles.openFolder"),
      icon: "solar:folder-bold",
      onClick: () => onOpenFolder?.(profile),
    },
    {
      id: "delete",
      label: t("profiles.delete"),
      icon: "solar:trash-bin-trash-bold",
      destructive: true,
      separator: true,
      onClick: () => onDelete?.(profile.id, profile.name),
    },
  ];

  const formatLastPlayed = (lastPlayed: string | null): string => {
    if (!lastPlayed) return "never played";

    const date = new Date(lastPlayed);
    const now = new Date();
    const diffInMs = now.getTime() - date.getTime();
    const diffInMinutes = Math.floor(diffInMs / (1000 * 60));
    const diffInHours = Math.floor(diffInMinutes / 60);
    const diffInDays = Math.floor(diffInHours / 24);
    const diffInWeeks = Math.floor(diffInDays / 7);
    const diffInMonths = Math.floor(diffInDays / 30);
    const diffInYears = Math.floor(diffInDays / 365);

    if (diffInMinutes < 1) return "just now";
    if (diffInMinutes < 60) return `${diffInMinutes}m ago`;
    if (diffInHours < 24) return `${diffInHours}h ago`;
    if (diffInDays < 7) return `${diffInDays}d ago`;
    if (diffInWeeks < 4) return `${diffInWeeks}w ago`;
    if (diffInMonths < 12) return `${diffInMonths}mo ago`;
    return `${diffInYears}y ago`;
  };

  return (
    <div
      className="relative flex h-[200px] w-[325px] flex-col justify-end items-start overflow-hidden transition-all duration-150 fullrisk-panel"
      style={{ borderWidth: "4px" }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onContextMenu={openContextMenuAtCursor}
    >
      <img
        src={resolvedBannerUrl ?? mappedBannerUrl}
        alt="Profile Background"
        className="absolute inset-0 w-full h-full object-cover z-[1] transition-all duration-150"
        style={{
          transform: isHovered ? "scale(1.02)" : "scale(1)",
        }}
      />
      <div
        className="absolute inset-0 z-[1] transition-all duration-150"
        style={{
          background: isHovered
            ? "linear-gradient(to top, rgba(0,0,0,0.96) 0%, rgba(0,0,0,0.84) 20%, rgba(0,0,0,0.72) 48%, rgba(0,0,0,0.52) 76%, rgba(0,0,0,0.34) 100%)"
            : "linear-gradient(to top, rgba(0,0,0,0.88) 0%, rgba(0,0,0,0.72) 20%, rgba(0,0,0,0.58) 48%, rgba(0,0,0,0.42) 76%, rgba(0,0,0,0.24) 100%)",
        }}
      />

      <div className="absolute left-3 top-3 z-[3]">
        <ProfileIconV2 profile={profile} size="md" className="shadow-[0_3px_0_rgba(0,0,0,0.35)]" />
      </div>

      <div
        className="absolute right-[12px] top-[10px] z-[3] font-minecraft text-[18px] lowercase text-white/80"
        style={{
          textShadow: "2px 2px rgba(0,0,0,0.9)",
        }}
      >
        {formatLastPlayed(profile.last_played)}
      </div>

      <div
        className="absolute left-[10px] bottom-[7px] z-[2] lowercase leading-none whitespace-nowrap"
        style={{
          color: "var(--panel-border-strong)",
          fontSize: `${nameFontSize}px`,
          transform: isHovered ? "translateY(-47px)" : undefined,
          textShadow: "2px 2px rgba(0,0,0,0.9)",
        }}
      >
        {trimmedProfileName}
      </div>

      <div
        className="absolute bottom-[7px] right-[12px] z-[2] font-minecraft text-[22px] lowercase leading-none text-white/95"
        style={{
          transform: isHovered ? "translateY(-47px)" : undefined,
          textShadow: "2px 2px rgba(0,0,0,0.9)",
        }}
      >
        {profile.game_version.toLowerCase()}
      </div>

      <div
        className="absolute left-0 right-0 bottom-0 flex items-center justify-between gap-3 px-[10px] pb-[10px] z-[3] transition-all duration-150 overflow-hidden"
        style={{ transform: isHovered ? "translateY(0)" : "translateY(200%)" }}
      >
        <Button
          ref={!profile.is_standard_version ? settingsButtonRef : undefined}
          variant="3d"
          size="sm"
          className="flex-1 min-w-0 overflow-hidden whitespace-nowrap"
          onClick={(e) => {
            if (profile.is_standard_version) {
              onMods?.(profile);
              return;
            }

            toggleContextMenuFromButton(e);
          }}
          data-action={!profile.is_standard_version ? "settings" : undefined}
          title={!profile.is_standard_version ? t("profiles.profileOptions") : t("profiles.manageMods")}
        >
          {profile.is_standard_version ? "mods" : "settings"}
        </Button>
        <Button
          variant={isLaunching ? "destructive" : "3d"}
          size="sm"
          className="flex-1 min-w-0 overflow-hidden whitespace-nowrap"
          onClick={() => handleLaunch()}
        >
          {isLaunching ? "stop" : "play"}
        </Button>
      </div>

      <SettingsContextMenu
        profile={profile}
        isOpen={isContextMenuOpen}
        position={contextMenuPosition}
        items={contextMenuItems.filter((item) => !item.destructive || !profile.is_standard_version)}
        positionMode="fixed"
        closeOnScroll={true}
        onClose={() => {
          setIsContextMenuOpen(false);
          setOpenContextMenuId(null);
        }}
        triggerButtonRef={settingsButtonRef}
      />
    </div>
  );
}
