"use client";

import { useState, useEffect, useCallback } from "react";
import { Icon } from "@iconify/react";
import { toast } from "react-hot-toast";
import { Modal } from "../ui/Modal";
import { Button } from "../ui/buttons/Button";
import {
  discordAuthLink,
  discordAuthStatus,
  discordAuthUnlink,
  getMobileAppToken,
  resetMobileAppToken,
} from "../../services/nrc-service";
import { Skeleton } from "../ui/Skeleton";
import { useSocialsModalStore } from "../../store/socials-modal-store";
import { openExternalUrl } from "../../services/tauri-service";
import { IconButton } from "../ui/buttons/IconButton";
import { getLauncherConfig } from "../../services/launcher-config-service";
import { useMinecraftAuthStore } from "../../store/minecraft-auth-store";
import { useThemeStore } from "../../store/useThemeStore";
import { useConfirmDialog } from "../../hooks/useConfirmDialog";

// Define a type for social platform configuration
interface SocialPlatform {
  key: string;
  name: string;
  icon: string;
  visitUrl?: string;
  isImplemented: boolean;
  fetchStatus?: () => Promise<boolean>;
  handleLink?: () => Promise<void>;
  handleUnlink?: () => Promise<void>;
  showMobileApp?: boolean;
  generateQrCode?: () => Promise<void>;
  resetToken?: () => Promise<void>;
}

export function SocialsModal() {
  const { isModalOpen, closeModal } = useSocialsModalStore();
  const { activeAccount } = useMinecraftAuthStore();
  const { accentColor } = useThemeStore();
  const { confirm, confirmDialog } = useConfirmDialog();

  // States for Discord (can be generalized later if needed)
  const [isLoadingDiscordStatus, setIsLoadingDiscordStatus] = useState(true);
  const [isDiscordLinked, setIsDiscordLinked] = useState(false);
  const [isProcessingDiscordAction, setIsProcessingDiscordAction] =
    useState(false);

  const [isLoadingMobileAppToken, setIsLoadingMobileAppToken] = useState(true);
  const [mobileAppToken, setMobileAppToken] = useState<string | null>(null);
  const [isProcessingMobileAppAction, setIsProcessingMobileAppAction] =
    useState(false);
  const [showQrCode, setShowQrCode] = useState(false);
  const [experimentalMode, setExperimentalMode] = useState(false);

  const fetchDiscordStatus = useCallback(async (): Promise<boolean> => {
    setIsLoadingDiscordStatus(true);
    try {
      const status = await discordAuthStatus();
      setIsDiscordLinked(status);
      return status;
    } catch (error) {
      console.error("Failed to fetch Discord auth status:", error);
      toast.error("Could not fetch Discord status. See console.");
      setIsDiscordLinked(false);
      return false;
    } finally {
      setIsLoadingDiscordStatus(false);
    }
  }, []);

  const fetchMobileAppToken = useCallback(async () => {
    setIsLoadingMobileAppToken(true);
    try {
      const token = await getMobileAppToken();
      setMobileAppToken(token);
    } catch (error) {
      console.error("Failed to fetch mobile app token:", error);
      toast.error("Could not fetch mobile app token. See console.");
      setMobileAppToken(null);
    } finally {
      setIsLoadingMobileAppToken(false);
    }
  }, []);

  const fetchConfig = useCallback(async () => {
    try {
      const config = await getLauncherConfig();
      setExperimentalMode(config.is_experimental);
    } catch (error) {
      console.error("Failed to fetch launcher config:", error);
      setExperimentalMode(false);
    }
  }, []);

  useEffect(() => {
    if (isModalOpen) {
      fetchDiscordStatus();
      fetchMobileAppToken();
      fetchConfig();
      // Future: fetch statuses for other implemented platforms
    } else {
      setShowQrCode(false);
      setMobileAppToken(null);
    }
  }, [isModalOpen, fetchDiscordStatus, fetchMobileAppToken, fetchConfig]);

  const handleDiscordLink = async () => {
    setIsProcessingDiscordAction(true);
    try {
      await discordAuthLink(); // Rust backend handles window, this waits for it to complete

      // Now that the linking window process is done, re-fetch status to update UI
      const successfullyLinked = await fetchDiscordStatus();

      if (successfullyLinked) {
        toast.success("Discord account successfully linked!");
      } else {
        toast(
          "Discord linking process finished. Please check your link status or try again if needed."
        );
      }
      // Modal remains open to show updated status
    } catch (error) {
      console.error("Failed to initiate Discord linking process:", error);
      toast.error("Could not start Discord linking. See console for details.");
    } finally {
      setIsProcessingDiscordAction(false);
    }
  };

  const handleDiscordUnlink = async () => {
    setIsProcessingDiscordAction(true);
    try {
      await discordAuthUnlink();
      toast.success("Discord account unlinked successfully.");
      setIsDiscordLinked(false);
    } catch (error) {
      console.error("Failed to unlink Discord account:", error);
      toast.error("Could not unlink Discord. See console.");
    } finally {
      setIsProcessingDiscordAction(false);
    }
  };

  const handleGenerateQrCode = async () => {
    const confirmed = await confirm({
      title: "Show QR Code",
      message:
        "This QR code contains your norisk token. Do not share it on stream or with others as it could compromise your account security.",
      confirmText: "Show QR Code",
      cancelText: "Cancel",
      type: "warning",
    });

    if (confirmed) {
      setShowQrCode(true);
    }
  };

  const handleResetMobileAppToken = async () => {
    setIsProcessingMobileAppAction(true);
    try {
      const newToken = await resetMobileAppToken();
      setMobileAppToken(newToken);
      setShowQrCode(false);
      toast.success("Mobile app token reset successfully.");
    } catch (error) {
      console.error("Failed to reset mobile app token:", error);
      toast.error("Could not reset mobile app token. See console.");
    } finally {
      setIsProcessingMobileAppAction(false);
    }
  };

  const generateQrCodeData = () => {
    if (!mobileAppToken || !activeAccount) return "";

    return JSON.stringify({
      uuid: activeAccount.id,
      experimental: experimentalMode,
      token: mobileAppToken,
    });
  };

  const generateQrCodeUrl = () => {
    const codeContent = generateQrCodeData();
    if (!codeContent) return "";

    const fillColor = encodeURIComponent(accentColor.value);
    return `https://qr-generator-putuwaw.vercel.app/api?data=${encodeURIComponent(codeContent)}&fill_color=${fillColor}`;
  };

  const socialPlatforms: SocialPlatform[] = [
    {
      key: "mobile",
      name: "Mobile App",
      icon: "material-symbols:phone-android",
      isImplemented: true,
      showMobileApp: true,
      generateQrCode: handleGenerateQrCode,
      resetToken: handleResetMobileAppToken,
    },
    {
      key: "discord",
      name: "Discord",
      icon: "ic:baseline-discord",
      visitUrl: "https://discord.norisk.gg",
      isImplemented: true,
      fetchStatus: fetchDiscordStatus,
      handleLink: handleDiscordLink,
      handleUnlink: handleDiscordUnlink,
    },
    {
      key: "youtube",
      name: "YouTube",
      icon: "mdi:youtube",
      visitUrl: "https://youtube.norisk.gg",
      isImplemented: false,
    },
    {
      key: "x",
      name: "X (Twitter)",
      icon: "simple-icons:x",
      visitUrl: "https://twitter.norisk.gg",
      isImplemented: false,
    },
    {
      key: "tiktok",
      name: "TikTok",
      icon: "ic:baseline-tiktok",
      visitUrl: "https://tiktok.norisk.gg",
      isImplemented: false,
    },
    {
      key: "twitch",
      name: "Twitch",
      icon: "mdi:twitch",
      visitUrl: "https://twitch.norisk.gg",
      isImplemented: false,
    },
  ];

  if (!isModalOpen) {
    return null;
  }

  const renderPlatformRow = (platform: SocialPlatform) => {
    const isLoadingStatus =
      platform.key === "discord"
        ? isLoadingDiscordStatus
        : platform.key === "mobile"
          ? isLoadingMobileAppToken
          : false;
    const isLinked = platform.key === "discord" ? isDiscordLinked : false;
    const isProcessingAction =
      platform.key === "discord"
        ? isProcessingDiscordAction
        : platform.key === "mobile"
          ? isProcessingMobileAppAction
          : false;

    if (platform.showMobileApp) {
      return (
        <div key={platform.key} className="space-y-2">
          <div className="flex items-center justify-between p-3 bg-black/20 rounded-md gap-2">
            <div className="flex items-center flex-grow">
              <Icon
                icon={platform.icon}
                className="w-7 h-7 mr-3 text-white/80 flex-shrink-0"
              />
              <span className="text-white/90 font-medium font-minecraft-ten text-xs">
                Connect {platform.name}
              </span>
            </div>
            <div className="flex items-center gap-1.5 flex-shrink-0">
              {isLoadingMobileAppToken ? (
                <Button variant="secondary" size="sm" disabled>
                  <Icon icon="mdi:loading" className="w-4 h-4 animate-spin" />
                </Button>
              ) : mobileAppToken ? (
                showQrCode ? (
                  <Button
                    variant="destructive"
                    onClick={platform.resetToken}
                    disabled={isProcessingAction}
                    size="sm"
                    icon={<Icon icon="mdi:refresh" />}
                  >
                    Reset
                  </Button>
                ) : (
                  <Button
                    variant="default"
                    onClick={platform.generateQrCode}
                    disabled={isProcessingAction}
                    size="sm"
                    icon={<Icon icon="mdi:qrcode" />}
                  >
                    Show QR
                  </Button>
                )
              ) : (
                <Button variant="secondary" size="sm" disabled>
                  Failed
                </Button>
              )}
            </div>
          </div>

          {/* QR Code Display */}
          {showQrCode && mobileAppToken && (
            <div className="flex justify-center p-3 bg-black/10 rounded-md">
              <div className="text-center space-y-2">
                <p className="text-white/70 font-minecraft-ten text-xs">
                  Scan with NoRisk Client mobile App
                </p>
                <img
                  src={generateQrCodeUrl()}
                  alt="Mobile App QR Code"
                  className="w-40 h-40 mx-auto border-2 border-white/20 rounded-lg"
                />
              </div>
            </div>
          )}
        </div>
      );
    }

    return (
      <div
        key={platform.key}
        className="flex items-center justify-between p-3 bg-black/20 rounded-md mb-2 gap-2"
      >
        <div className="flex items-center flex-grow">
          <Icon
            icon={platform.icon}
            className="w-7 h-7 mr-3 text-white/80 flex-shrink-0"
          />
          <span className="text-white/90 font-medium font-minecraft-ten text-xs">
            Link {platform.name} account
          </span>
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {platform.isImplemented &&
          platform.handleLink &&
          platform.handleUnlink ? (
            isLinked ? (
              <Button
                variant="destructive"
                onClick={platform.handleUnlink}
                disabled={isProcessingAction || isLoadingStatus}
                size="sm"
                icon={<Icon icon="mdi:link-off" />}
              >
                Unlink
              </Button>
            ) : (
              <Button
                variant="default"
                onClick={platform.handleLink}
                disabled={isProcessingAction || isLoadingStatus}
                size="sm"
                icon={<Icon icon="mdi:link-variant" />}
              >
                Link
              </Button>
            )
          ) : (
            <Button
              variant="secondary"
              size="sm"
              disabled
              icon={<Icon icon="mdi:link-variant" />}
            >
              Link
            </Button>
          )}
          {platform.visitUrl && (
            <IconButton
              variant="ghost"
              size="sm"
              onClick={() => openExternalUrl(platform.visitUrl!)}
              icon={
                <Icon
                  icon="mdi:arrow-top-right-bold-box-outline"
                  className="w-5 h-5"
                />
              }
              aria-label={`Visit ${platform.name} page`}
            />
          )}
        </div>
      </div>
    );
  };

  return (
    <>
      <Modal
        title="Social Accounts"
        titleIcon={
          <Icon icon="fluent:people-community-20-filled" className="w-7 h-7" />
        }
        onClose={closeModal}
        width="md"
      >
        <div className="p-4 space-y-2 min-h-[45vh] max-h-[70vh] overflow-y-auto custom-scrollbar">
          {(isLoadingDiscordStatus || isLoadingMobileAppToken) &&
          (socialPlatforms.find((p) => p.key === "discord")?.isImplemented ||
            socialPlatforms.find((p) => p.key === "mobile")?.isImplemented) ? (
            <div className="space-y-2">
              {socialPlatforms
                .filter(
                  (p) =>
                    p.isImplemented &&
                    (p.key === "discord" || p.key === "mobile")
                )
                .map((platform, i) => (
                  <div
                    key={`skeleton-${platform.key}-${i}`}
                    className="flex items-center justify-between p-3 bg-black/20 rounded-md gap-2"
                  >
                    <div className="flex items-center flex-grow">
                      <Skeleton
                        variant="block"
                        width={28}
                        height={28}
                        className="mr-3 flex-shrink-0"
                      />
                      <Skeleton variant="text" width={150} height={16} />
                    </div>
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      <Skeleton variant="block" width={80} height={32} />
                      {platform.visitUrl && (
                        <Skeleton variant="block" width={32} height={32} />
                      )}
                    </div>
                  </div>
                ))}
              {socialPlatforms
                .filter(
                  (p) =>
                    !p.isImplemented ||
                    (p.key !== "discord" && p.key !== "mobile")
                )
                .map((platform) => (
                  <div
                    key={`skeleton-${platform.key}`}
                    className="flex items-center justify-between p-3 bg-black/20 rounded-md opacity-70 gap-2"
                  >
                    <div className="flex items-center flex-grow">
                      <Icon
                        icon={platform.icon}
                        className="w-7 h-7 mr-3 text-white/50 flex-shrink-0"
                      />
                      <span className="text-white/60 font-minecraft-ten text-xs">
                        Link {platform.name} account
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      <Button
                        variant="secondary"
                        size="sm"
                        disabled
                        icon={<Icon icon="mdi:link-variant" />}
                      >
                        Link
                      </Button>
                      {platform.visitUrl && (
                        <IconButton
                          variant="ghost"
                          size="sm"
                          disabled
                          icon={
                            <Icon
                              icon="mdi:arrow-top-right-bold-box-outline"
                              className="w-5 h-5"
                            />
                          }
                          aria-label={`Visit ${platform.name} page`}
                        />
                      )}
                    </div>
                  </div>
                ))}
            </div>
          ) : (
            socialPlatforms.map(renderPlatformRow)
          )}
        </div>
      </Modal>
      {confirmDialog}
    </>
  );
}
