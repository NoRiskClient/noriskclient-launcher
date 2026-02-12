import { useEffect, useState, useCallback, useRef } from "react";
import { Icon } from "@iconify/react";
import { open } from "@tauri-apps/plugin-dialog";
import { convertFileSrc } from "@tauri-apps/api/core";
import type {
  ProfileBanner,
  ImageSourceAbsolutePath,
} from "../../types/profile";
import { cn } from "../../lib/utils";
import * as ProfileService from "../../services/profile-service";
import { toast } from "react-hot-toast";
import { useTranslation } from "react-i18next";

// Global cache for resolved image URLs to prevent flickering on tab switches
const imageUrlCache = new Map<string, { url: string; timestamp: number }>();

function getCacheKey(profileId: string, banner: ProfileBanner | null | undefined): string {
  if (!banner?.source) return `${profileId}:null`;
  const source = banner.source;
  if (source.type === "absolutePath") return `${profileId}:abs:${source.path}`;
  if (source.type === "relativePath") return `${profileId}:rel:${source.path}`;
  if (source.type === "relativeProfile") return `${profileId}:prof:${source.path}`;
  if (source.type === "url") return `${profileId}:url:${source.url}`;
  if (source.type === "base64") return `${profileId}:b64:${source.data.substring(0, 50)}`;
  return `${profileId}:unknown`;
}

interface ProfileIconProps {
  profileId: string;
  banner: ProfileBanner | null | undefined;
  profileName?: string;
  accentColor: string;
  onSuccessfulUpdate: () => void;
  className?: string;
  placeholderIcon?: string;
  iconClassName?: string;
  isEditable?: boolean;
  variant?: "default" | "bare";
  borderWidthClassName?: string;
  roundedClassName?: string;
  bgColorOpacity?: string;
  borderColorOpacity?: string;
}

export function ProfileIcon({
  profileId,
  banner,
  profileName,
  accentColor,
  onSuccessfulUpdate,
  className,
  placeholderIcon = "solar:gallery-add-bold",
  iconClassName = "w-6 h-6",
  isEditable = true,
  variant = "default",
  borderWidthClassName = "border-2",
  roundedClassName = "rounded",
  bgColorOpacity = "30",
  borderColorOpacity = "50",
}: ProfileIconProps) {
  const { t } = useTranslation();
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);
  const [showLoading, setShowLoading] = useState(false);
  const [hasLoadedImage, setHasLoadedImage] = useState(false);
  const [imageOpacity, setImageOpacity] = useState(0);
  const cacheVersion = useRef(0);

  useEffect(() => {
    const cacheKey = getCacheKey(profileId, banner);

    const resolveImageUrlWithService = async () => {
      if (banner?.source) {
        // Check cache first
        const cached = imageUrlCache.get(cacheKey);
        if (cached) {
          setImageUrl(cached.url);
          setHasLoadedImage(true);
          setImageOpacity(1);
          setIsLoading(false);
          setShowLoading(false);
          return;
        }

        setIsLoading(true);

        // Verzögerte Anzeige der Loading-Animation um Flackern zu vermeiden
        const loadingTimeout = setTimeout(() => {
          setShowLoading(true);
        }, 100); // 100ms Verzögerung

        try {
          const resolvedPathOrUrl = await ProfileService.resolveImagePath(
            banner.source,
            profileId,
          );

          if (
            banner.source.type === "absolutePath" ||
            banner.source.type === "relativePath" ||
            banner.source.type === "relativeProfile"
          ) {
            if (resolvedPathOrUrl) {
              const assetUrl = await convertFileSrc(resolvedPathOrUrl);
              // Use cache version for cache busting only when image actually changes
              const finalUrl = assetUrl + '?v=' + cacheVersion.current;
              setImageUrl(finalUrl);
              setHasLoadedImage(true);
              // Cache the resolved URL
              imageUrlCache.set(cacheKey, { url: finalUrl, timestamp: Date.now() });
              // Fade-in mit kleiner Verzögerung für smooth transition
              setTimeout(() => setImageOpacity(1), 50);
            } else {
                setImageUrl(null);
                setHasLoadedImage(false);
                setImageOpacity(0);
            }
          } else {
            // For URL or Base64, the resolvedPathOrUrl is already the final URL
            setImageUrl(resolvedPathOrUrl);
            setHasLoadedImage(!!resolvedPathOrUrl);
            if (resolvedPathOrUrl) {
              // Cache the resolved URL
              imageUrlCache.set(cacheKey, { url: resolvedPathOrUrl, timestamp: Date.now() });
              setTimeout(() => setImageOpacity(1), 50);
            } else {
              setImageOpacity(0);
            }
          }
        } catch (error) {
          console.error(
            "Error resolving image source via service:",
            banner.source,
            error,
          );
          setImageUrl(null);
          setHasLoadedImage(false);
          setImageOpacity(0);
        } finally {
          clearTimeout(loadingTimeout);
          setIsLoading(false);
          setShowLoading(false);
        }
      } else {
        setImageUrl(null);
        setIsLoading(false);
        setShowLoading(false);
        setHasLoadedImage(false);
        setImageOpacity(0);
      }
    };

    resolveImageUrlWithService();
  }, [banner, profileId]);

  const handleIconClick = useCallback(async () => {
    if (!isEditable || isLoading || isUpdating) {
      return;
    }

    try {
      const selectedPath = await open({
        title: "Select Profile Icon",
        multiple: false,
        directory: false,
        filters: [
          { name: "Images", extensions: ["png", "jpg", "jpeg", "webp", "gif"] },
        ],
      });

      if (typeof selectedPath === "string" && selectedPath) {
        setIsUpdating(true);
        setShowLoading(true);
        setHasLoadedImage(false); // Reset während Upload
        setImageOpacity(0);
        try {
          await ProfileService.uploadProfileImages({
            profileId: profileId,
            path: selectedPath,
            imageType: "icon",
          });
          // Invalidate cache for this profile so the new image gets loaded
          const cacheKey = getCacheKey(profileId, banner);
          imageUrlCache.delete(cacheKey);
          cacheVersion.current++;
          toast.success(t('profiles.icon_updated'));
          onSuccessfulUpdate();
        } catch (error) {
          console.error("Failed to upload profile icon:", error);
          toast.error(t('profiles.errors.icon_update_failed'));
        } finally {
          setIsUpdating(false);
          setShowLoading(false);
        }
      }
    } catch (error) {
      if (error instanceof Error && error.message.includes("Dialog cancelled by user")) {
        // Do nothing, user cancelled.
      } else {
        console.error("Error selecting image:", error);
        toast.error(t('profiles.errors.image_dialog_failed'));
      }
    }
  }, [isEditable, isLoading, isUpdating, profileId, banner, onSuccessfulUpdate]);

  const canBeClicked = isEditable && !isLoading && !isUpdating;
  const displaySpinner = showLoading || isUpdating;

  const effectiveIconClassName = cn(iconClassName, displaySpinner && "opacity-50");
  const displayPlaceholderIcon = displaySpinner ? "eos-icons:loading" : placeholderIcon;
  const hasImage = imageUrl && hasLoadedImage && !isLoading;
  const shouldShowPlaceholder = !banner?.source && !isLoading;
  
  const baseContainerClasses = "flex items-center justify-center flex-shrink-0 transition-all duration-200 ease-in-out relative group overflow-hidden";

  const variantClasses = variant === "default" ? cn(borderWidthClassName, roundedClassName) : "";
  const variantStyles = variant === "default" ? {
    backgroundColor: `${accentColor}${bgColorOpacity}`,
    borderColor: `${accentColor}${borderColorOpacity}`,
  } : {};

  const placeholderIconStyle = variant === "bare" && !hasImage ? { color: accentColor } : {};
  const placeholderFinalIconClassName = variant === "bare" && !hasImage ? cn(iconClassName, "text-transparent") : iconClassName;

  return (
    <div
      className={cn(
        baseContainerClasses,
        variantClasses,
        className,
        canBeClicked && "cursor-pointer hover:scale-110 active:scale-100",
      )}
      style={variantStyles}
      onClick={canBeClicked ? handleIconClick : undefined}
      title={
        displaySpinner
          ? "Processing..."
          : hasImage
            ? (isEditable ? "Change Profile Icon" : (profileName || "Profile Icon"))
            : (isEditable ? "Select Profile Icon" : (profileName || "Profile Icon"))
      }
      role={canBeClicked ? "button" : undefined}
      tabIndex={canBeClicked ? 0 : undefined}
      onKeyDown={ (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            if (canBeClicked) {
                handleIconClick();
            }
          }
        }
      }
    >
      {hasImage ? (
        <>
          <img
            src={imageUrl!}
            alt={profileName ? `${profileName} icon` : "Profile Icon"}
            className={cn(
                "w-full h-full object-cover transition-opacity duration-300",
                canBeClicked && "group-hover:opacity-60"
            )}
            style={{ opacity: imageOpacity }}
          />
          {canBeClicked && (
             <div className={cn(
                "absolute inset-0 flex items-center justify-center bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity duration-200",
                variant === "default" ? roundedClassName : ""
              )}>
                <Icon icon="solar:gallery-edit-bold" className="w-5 h-5 text-white" />
            </div>
          )}
        </>
      ) : displaySpinner ? (
        <Icon 
            icon="eos-icons:loading" 
            className={cn(effectiveIconClassName, placeholderFinalIconClassName)} 
            style={placeholderIconStyle}
        />
      ) : shouldShowPlaceholder ? (
        <Icon 
            icon={placeholderIcon} 
            className={cn(effectiveIconClassName, placeholderFinalIconClassName)} 
            style={placeholderIconStyle}
        />
      ) : null}
    </div>
  );
} 