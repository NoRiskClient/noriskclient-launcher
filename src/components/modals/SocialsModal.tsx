"use client";

import { useState, useEffect, useCallback } from "react";
import { Icon } from "@iconify/react";
import { toast } from "react-hot-toast";
import { Modal } from "../ui/Modal";
import { Button } from "../ui/buttons/Button";
import { IconButton } from "../ui/buttons/IconButton";
import { useSocialsModalStore } from "../../store/socials-modal-store";
import { useMinecraftAuthStore } from "../../store/minecraft-auth-store";
import { getLauncherConfig } from "../../services/launcher-config-service";
import { openExternalUrl } from "../../services/tauri-service";
import {
  discordAuthLink,
  discordAuthStatus,
  discordAuthUnlink,
  githubAuthLink,
  githubAuthStatus,
  githubAuthUnlink,
  getMobileAppToken,
  resetMobileAppToken,
} from "../../services/nrc-service";
import { useThemeStore } from "../../store/useThemeStore";
import { useConfirmDialog } from "../../hooks/useConfirmDialog";

interface AccountLinkRowProps {
  icon: string;
  name: string;
  isLoading: boolean;
  isLinked: boolean;
  isProcessing: boolean;
  onLink: () => void;
  onUnlink: () => void;
  visitUrl?: string;
}

function AccountLinkRow({
  icon,
  name,
  isLoading,
  isLinked,
  isProcessing,
  onLink,
  onUnlink,
  visitUrl,
}: AccountLinkRowProps) {
  return (
    <div className="flex items-center justify-between px-3 bg-black/20 rounded-md h-[58px]">
      <div className="flex items-center">
        <Icon icon={icon} className="w-6 h-6 mr-3 text-white/80" />
        <span className="text-white/90 font-minecraft-ten text-xs">{name}</span>
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
            Unlink
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
            Link
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

export function SocialsModal() {
  const { isModalOpen, closeModal } = useSocialsModalStore();
  const { activeAccount } = useMinecraftAuthStore();
  const { accentColor } = useThemeStore();
  const { confirm, confirmDialog } = useConfirmDialog();
  const [referralLink, setReferralLink] = useState("");
  const [experimentalMode, setExperimentalMode] = useState(false);

  // Discord state
  const [isLoadingDiscord, setIsLoadingDiscord] = useState(true);
  const [isDiscordLinked, setIsDiscordLinked] = useState(false);
  const [isProcessingDiscord, setIsProcessingDiscord] = useState(false);

  // GitHub state
  const [isLoadingGithub, setIsLoadingGithub] = useState(true);
  const [isGithubLinked, setIsGithubLinked] = useState(false);
  const [isProcessingGithub, setIsProcessingGithub] = useState(false);

  // Mobile App state
  const [isLoadingMobileApp, setIsLoadingMobileApp] = useState(true);
  const [mobileAppToken, setMobileAppToken] = useState<string | null>(null);
  const [isProcessingMobileApp, setIsProcessingMobileApp] = useState(false);
  const [showQrCode, setShowQrCode] = useState(false);

  const fetchDiscordStatus = useCallback(async (): Promise<boolean> => {
    setIsLoadingDiscord(true);
    try {
      const status = await discordAuthStatus();
      setIsDiscordLinked(status);
      return status;
    } catch (error) {
      console.error("Failed to fetch Discord status:", error);
      setIsDiscordLinked(false);
      return false;
    } finally {
      setIsLoadingDiscord(false);
    }
  }, []);

  const fetchGithubStatus = useCallback(async (): Promise<boolean> => {
    setIsLoadingGithub(true);
    try {
      const status = await githubAuthStatus();
      setIsGithubLinked(status);
      return status;
    } catch (error) {
      console.error("Failed to fetch GitHub status:", error);
      setIsGithubLinked(false);
      return false;
    } finally {
      setIsLoadingGithub(false);
    }
  }, []);

  const fetchMobileAppToken = useCallback(async () => {
    setIsLoadingMobileApp(true);
    try {
      const token = await getMobileAppToken();
      setMobileAppToken(token);
    } catch (error) {
      console.error("Failed to fetch mobile app token:", error);
      setMobileAppToken(null);
    } finally {
      setIsLoadingMobileApp(false);
    }
  }, []);

  useEffect(() => {
    if (isModalOpen && activeAccount) {
      const init = async () => {
        try {
          const config = await getLauncherConfig();
          setExperimentalMode(config.is_experimental);
          if (config.is_experimental) {
            const betaFlag = config.check_beta_channel ? "true" : "false";
            setReferralLink(
              `https://api-staging.norisk.gg/api/v1/launcher/referral/download?code=${activeAccount.username}&beta=${betaFlag}`
            );
          } else {
            setReferralLink(`https://nrc.gg/invite/${activeAccount.username}`);
          }
        } catch (error) {
          console.error("Failed to generate referral link:", error);
        }
      };
      init();
      fetchDiscordStatus();
      fetchGithubStatus();
      fetchMobileAppToken();
    } else {
      setShowQrCode(false);
      setMobileAppToken(null);
    }
  }, [isModalOpen, activeAccount, fetchDiscordStatus, fetchGithubStatus, fetchMobileAppToken]);

  const handleCopyLink = () => {
    navigator.clipboard.writeText(referralLink);
    toast.success("Link copied!");
  };

  const handleDiscordLink = async () => {
    setIsProcessingDiscord(true);
    try {
      await discordAuthLink();
      const success = await fetchDiscordStatus();
      if (success) {
        toast.success("Discord account linked!");
      }
    } catch (error) {
      console.error("Failed to link Discord:", error);
      toast.error("Could not link Discord.");
    } finally {
      setIsProcessingDiscord(false);
    }
  };

  const handleDiscordUnlink = async () => {
    setIsProcessingDiscord(true);
    try {
      await discordAuthUnlink();
      toast.success("Discord account unlinked.");
      setIsDiscordLinked(false);
    } catch (error) {
      console.error("Failed to unlink Discord:", error);
      toast.error("Could not unlink Discord.");
    } finally {
      setIsProcessingDiscord(false);
    }
  };

  const handleGithubLink = async () => {
    setIsProcessingGithub(true);
    try {
      await githubAuthLink();
      const success = await fetchGithubStatus();
      if (success) {
        toast.success("GitHub account linked!");
      }
    } catch (error) {
      console.error("Failed to link GitHub:", error);
      toast.error("Could not link GitHub.");
    } finally {
      setIsProcessingGithub(false);
    }
  };

  const handleGithubUnlink = async () => {
    setIsProcessingGithub(true);
    try {
      await githubAuthUnlink();
      toast.success("GitHub account unlinked.");
      setIsGithubLinked(false);
    } catch (error) {
      console.error("Failed to unlink GitHub:", error);
      toast.error("Could not unlink GitHub.");
    } finally {
      setIsProcessingGithub(false);
    }
  };

  const handleShowQrCode = async () => {
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
    setIsProcessingMobileApp(true);
    try {
      const newToken = await resetMobileAppToken();
      setMobileAppToken(newToken);
      setShowQrCode(false);
      toast.success("Mobile app token reset.");
    } catch (error) {
      console.error("Failed to reset mobile app token:", error);
      toast.error("Could not reset token.");
    } finally {
      setIsProcessingMobileApp(false);
    }
  };

  const generateQrCodeUrl = () => {
    if (!mobileAppToken || !activeAccount) return "";
    const data = JSON.stringify({
      uuid: activeAccount.id,
      experimental: experimentalMode,
      token: mobileAppToken,
    });
    const fillColor = encodeURIComponent(accentColor.value);
    return `https://qr-generator-putuwaw.vercel.app/api?data=${encodeURIComponent(data)}&fill_color=${fillColor}`;
  };

  if (!isModalOpen || !activeAccount) {
    return null;
  }

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
      <div className="p-6 min-h-45vh max-h-[70vh] overflow-y-auto custom-scrollbar">
        {/* Referral Section */}
        <div className="flex flex-col items-center text-center space-y-4">
          <Icon
            icon="mdi:gift-outline"
            className="w-16 h-16 text-accent"
          />
          <p className="text-white/90 font-minecraft-ten text-sm select-none">
            Refer your friends, get 3 Days of NRC+ and{" "}
            <span
              className="text-accent underline cursor-pointer hover:text-accent/80"
              onClick={() => openExternalUrl("https://blog.norisk.gg/friend-referral")}
            >
              more...
            </span>
          </p>

          <div className="flex gap-2 mt-4">
            <input
              type="text"
              value={referralLink}
              readOnly
              className="bg-black/30 border border-white/10 rounded-md px-3 py-2 text-white/70 text-xs font-mono truncate w-64"
            />
            <IconButton
              variant="default"
              size="sm"
              onClick={handleCopyLink}
              icon={<Icon icon="mdi:content-copy" className="w-4 h-4" />}
            />
          </div>
        </div>

        {/* Divider */}
        <div className="border-t border-white/10 my-6" />

        {/* Account Linking Section */}
        <div className="space-y-2">
          {/* Mobile App */}
          <div className="space-y-2">
              <div className="flex items-center justify-between px-3 bg-black/20 rounded-md h-[58px]">
                <div className="flex items-center">
                  <Icon icon="material-symbols:phone-android" className="w-6 h-6 mr-3 text-white/80" />
                  <span className="text-white/90 font-minecraft-ten text-xs">Mobile App</span>
                </div>
                <div className="flex items-center gap-2">
                  {mobileAppToken || isLoadingMobileApp ? (
                    showQrCode ? (
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={handleResetMobileAppToken}
                        disabled={isProcessingMobileApp || isLoadingMobileApp}
                        icon={<Icon icon={isLoadingMobileApp ? "mdi:loading" : "mdi:refresh"} className={isLoadingMobileApp ? "animate-spin" : ""} />}
                        widthClassName="w-[140px]"
                      >
                        Reset
                      </Button>
                    ) : (
                      <Button
                        variant="default"
                        size="sm"
                        onClick={handleShowQrCode}
                        disabled={isProcessingMobileApp || isLoadingMobileApp}
                        icon={<Icon icon={isLoadingMobileApp ? "mdi:loading" : "mdi:qrcode"} className={isLoadingMobileApp ? "animate-spin" : ""} />}
                        widthClassName="w-[140px]"
                      >
                        Show QR
                      </Button>
                    )
                  ) : (
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled
                      widthClassName="w-[140px]"
                    >
                      Failed
                    </Button>
                  )}
                  <IconButton
                    variant="ghost"
                    size="sm"
                    icon={<Icon icon="mdi:open-in-new" className="w-5 h-5" />}
                    className="invisible"
                    disabled
                  />
                </div>
              </div>
              {showQrCode && mobileAppToken && (
                <div className="flex justify-center p-3 bg-black/10 rounded-md">
                  <div className="text-center space-y-2">
                    <p className="text-white/70 font-minecraft-ten text-xs select-none">
                      Scan with McReal App
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

          <AccountLinkRow
            icon="ic:baseline-discord"
              name="Discord"
              isLoading={isLoadingDiscord}
              isLinked={isDiscordLinked}
              isProcessing={isProcessingDiscord}
              onLink={handleDiscordLink}
              onUnlink={handleDiscordUnlink}
              visitUrl="https://discord.norisk.gg"
            />

          <AccountLinkRow
            icon="mdi:github"
            name="GitHub"
            isLoading={isLoadingGithub}
            isLinked={isGithubLinked}
            isProcessing={isProcessingGithub}
            onLink={handleGithubLink}
            onUnlink={handleGithubUnlink}
            visitUrl="https://github.com/NoRiskClient"
          />
        </div>
      </div>
    </Modal>
    {confirmDialog}
    </>
  );
}
