import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { X, UserPlus, AlertCircle, Loader2 } from "lucide-react";
import { useReferralStore } from "../../store/referral-store";
import { useThemeStore } from "../../store/useThemeStore";
import { getLauncherConfig } from "../../services/launcher-config-service";

export function ReferralBanner() {
  const { t } = useTranslation();
  const {
    bannerVisible,
    referrerInfo,
    isLoading,
    error,
    pendingCode,
    setPendingCode,
    dismissBanner
  } = useReferralStore();

  const accentColor = useThemeStore((state) => state.accentColor);

  // Check for referral state on mount
  // Show banner if code exists and not dismissed (regardless of redeemed status)
  useEffect(() => {
    const checkReferralCode = async () => {
      try {
        const config = await getLauncherConfig();
        // Use referral_state instead of pending_referral_code
        if (config.referral_state?.code) {
          console.log("[ReferralBanner] Found referral code:", config.referral_state.code);
          setPendingCode(config.referral_state.code);
        }
      } catch (error) {
        console.error("[ReferralBanner] Failed to check referral code:", error);
      }
    };

    checkReferralCode();
  }, [setPendingCode]);

  // DEBUG: Always show banner for testing
  const DEBUG_MODE = false;
  const debugReferrerInfo = {
    referrerName: "nqrman",
    referrerAvatar: null,
    valid: true,
    referralType: "friend",
    translationKey: "referral.invited_by_friend",
    fallbackMessage: "You were invited by",
    customMessage: "Custom message",
    rewardText: "You get 100 coins!",
  };

  // Show banner if: debug mode, has error, is loading, or has referrer info
  const shouldShow = DEBUG_MODE || error || isLoading || (bannerVisible && referrerInfo);

  if (!shouldShow) {
    return null;
  }

  // Error state
  if (error) {
    return (
      <div
        className="animate-slide-up-fade-in rounded-full"
        style={{
          backdropFilter: "blur(8px)",
          WebkitBackdropFilter: "blur(8px)",
          backgroundColor: "rgba(0, 0, 0, 0.6)",
          border: "1px solid rgba(239, 68, 68, 0.3)",
        }}
      >
        <div className="flex items-center gap-3 px-4 py-2">
          <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0" />
          <span className="font-minecraft-ten text-sm text-white/80 tracking-wide">
            <span className="text-red-400">{t('common.error')}:</span> {error}
          </span>
          <button
            type="button"
            onClick={dismissBanner}
            className="flex-shrink-0 ml-1 p-1 rounded-full transition-colors hover:bg-white/10"
            aria-label={t('common.close_banner')}
          >
            <X className="w-3.5 h-3.5 text-white/50 hover:text-white" />
          </button>
        </div>
      </div>
    );
  }

  // Loading state
  if (isLoading) {
    return (
      <div
        className="animate-slide-up-fade-in rounded-full"
        style={{
          backdropFilter: "blur(8px)",
          WebkitBackdropFilter: "blur(8px)",
          backgroundColor: "rgba(0, 0, 0, 0.6)",
          border: "1px solid rgba(255, 255, 255, 0.1)",
        }}
      >
        <div className="flex items-center gap-3 px-4 py-2">
          <Loader2 className="w-4 h-4 text-white/70 flex-shrink-0 animate-spin" />
          <span className="font-minecraft-ten text-sm text-white/80 tracking-wide">
            {t('referral.loading')}
          </span>
        </div>
      </div>
    );
  }

  const displayInfo = DEBUG_MODE ? debugReferrerInfo : referrerInfo;

  return (
    <div
      className="animate-slide-up-fade-in rounded-2xl"
      style={{
        backdropFilter: "blur(8px)",
        WebkitBackdropFilter: "blur(8px)",
        backgroundColor: "rgba(0, 0, 0, 0.6)",
        border: "1px solid rgba(255, 255, 255, 0.1)",
      }}
    >
      <div className="flex items-start gap-3 px-4 py-2">
        {/* Avatar or fallback icon */}
        {displayInfo?.referrerAvatar ? (
          <img
            src={displayInfo.referrerAvatar}
            alt={displayInfo.referrerName}
            className="w-5 h-5 rounded flex-shrink-0 mt-0.5"
            style={{ imageRendering: "pixelated" }}
          />
        ) : (
          <UserPlus className="w-4 h-4 text-white/70 flex-shrink-0 mt-0.5" />
        )}

        {/* Content */}
        <div className="flex flex-col font-minecraft-ten text-sm tracking-wide">
          <span className="text-white/80">
            {displayInfo?.fallbackMessage || "You were invited by"}{" "}
            <span style={{ color: accentColor.value }} className="font-semibold">
              {displayInfo?.referrerName}
            </span>
          </span>
          {(displayInfo?.customMessage || displayInfo?.rewardText) && (
            <span className="text-xs text-white/60">
              {displayInfo?.customMessage}
              {displayInfo?.customMessage && displayInfo?.rewardText && " · "}
              {displayInfo?.rewardText && (
                <span style={{ color: accentColor.value }}>{displayInfo.rewardText}</span>
              )}
            </span>
          )}
        </div>

        {/* Close button */}
        <button
          type="button"
          onClick={dismissBanner}
          className="flex-shrink-0 ml-1 p-1 rounded-full transition-colors hover:bg-white/10"
          aria-label={t('common.close_banner')}
        >
          <X className="w-3.5 h-3.5 text-white/50 hover:text-white" />
        </button>
      </div>
    </div>
  );
}
