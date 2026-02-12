import * as ProfileService from '../services/profile-service';
import { toast } from 'react-hot-toast';
import { Modal } from '../components/ui/Modal';
import { Button } from '../components/ui/buttons/Button';
import { Icon } from '@iconify/react';
import { useThemeStore } from '../store/useThemeStore';
import * as ContentService from '../services/content-service';
import UnifiedService from '../services/unified-service';
import { ModPlatform } from '../types/unified';
import { ContentType } from '../types/content';
import { useTranslation } from 'react-i18next';
import i18n from '../i18n/i18n';

/**
 * Checks if a profile's loader is compatible with Iris shader mod
 * Iris only works with Fabric, Quilt, and NeoForge
 */
export async function isLoaderCompatibleWithIris(profileId: string): Promise<boolean> {
  try {
    const profile = await ProfileService.getProfile(profileId);
    const loader = profile.loader;

    // Iris is compatible with Fabric, Quilt, and NeoForge
    const compatibleLoaders = ['fabric', 'quilt', 'neoforge'];
    const isCompatible = compatibleLoaders.includes(loader);

    console.log(`🔧 [IrisDetection] Profile ${profileId} uses loader: ${loader}`);
    console.log(`🔧 [IrisDetection] Loader ${loader} is ${isCompatible ? 'COMPATIBLE' : 'NOT COMPATIBLE'} with Iris`);

    return isCompatible;
  } catch (error) {
    console.warn(`[IrisDetection] Failed to check loader compatibility for profile ${profileId}:`, error);
    return false; // Assume not compatible if we can't check
  }
}

/**
 * Automatically installs Iris shader mod to a profile
 * Tries Modrinth first, falls back to CurseForge if needed
 */
export async function installIrisToProfile(profileId: string): Promise<boolean> {
  console.log(`🚀 [IrisInstallation] Starting Iris installation for profile: ${profileId}`);

  try {
    // Get profile details to determine compatible loaders and game version
    const profile = await ProfileService.getProfile(profileId);
    const loader = profile.loader;
    const gameVersion = profile.game_version;

    console.log(`🔧 [IrisInstallation] Profile uses loader: ${loader}, game version: ${gameVersion}`);

    // Determine compatible loaders for Iris
    const compatibleLoaders = ['fabric', 'quilt', 'neoforge'];
    const irisCompatibleLoaders = compatibleLoaders.filter(l => l === loader);

    if (irisCompatibleLoaders.length === 0) {
      console.warn(`❌ [IrisInstallation] No compatible loaders found for Iris in profile ${profileId}`);
      return false;
    }

    // Try to install from Modrinth first
    try {
      console.log(`📦 [IrisInstallation] Attempting to install Iris from Modrinth...`);
      const success = await installIrisFromPlatform(
        profileId,
        ModPlatform.Modrinth,
        'YL57xq9U',
        irisCompatibleLoaders,
        gameVersion
      );

      if (success) {
        console.log(`✅ [IrisInstallation] Successfully installed Iris from Modrinth`);
        return true;
      }
    } catch (error) {
      console.warn(`⚠️ [IrisInstallation] Modrinth installation failed, trying CurseForge:`, error);
    }

    // Fallback to CurseForge
    try {
      console.log(`📦 [IrisInstallation] Attempting to install Iris from CurseForge...`);
      const success = await installIrisFromPlatform(
        profileId,
        ModPlatform.CurseForge,
        '455508',
        irisCompatibleLoaders,
        gameVersion
      );

      if (success) {
        console.log(`✅ [IrisInstallation] Successfully installed Iris from CurseForge`);
        return true;
      }
    } catch (error) {
      console.error(`❌ [IrisInstallation] CurseForge installation also failed:`, error);
    }

    console.error(`❌ [IrisInstallation] Failed to install Iris from any platform`);
    return false;

  } catch (error) {
    console.error(`❌ [IrisInstallation] Failed to install Iris for profile ${profileId}:`, error);
    return false;
  }
}

/**
 * Helper function to install Iris from a specific platform
 */
async function installIrisFromPlatform(
  profileId: string,
  platform: ModPlatform,
  projectId: string,
  loaders: string[],
  gameVersion: string
): Promise<boolean> {
  // Get the latest compatible version of Iris
  const versionsResponse = await UnifiedService.getModVersions({
    source: platform,
    project_id: projectId,
    loaders: loaders,
    game_versions: [gameVersion],
    limit: 1 // Get only the latest version
  });

  if (!versionsResponse.versions || versionsResponse.versions.length === 0) {
    throw new Error(`No compatible Iris versions found for ${platform}`);
  }

  const latestVersion = versionsResponse.versions[0];
  console.log(`📋 [IrisInstallation] Found latest Iris version: ${latestVersion.version_number} (${platform})`);

  // Install the mod using ContentService
  const installPayload = {
    profile_id: profileId,
    project_id: projectId,
    version_id: latestVersion.id,
    file_name: latestVersion.files[0].filename,
    download_url: latestVersion.files[0].url,
    file_hash_sha1: latestVersion.files[0].hashes?.sha1,
    content_name: latestVersion.name || 'Iris Shaders',
    version_number: latestVersion.version_number,
    content_type: ContentType.Mod,
    loaders: loaders,
    game_versions: [gameVersion],
    source: platform
  };

  await ContentService.installContentToProfile(installPayload);
  return true;
}

/**
 * Checks if Iris shader mod is installed in a given profile
 * Only checks for Iris if the profile's loader is compatible with Iris
 */
export async function isIrisInstalled(profileId: string): Promise<boolean> {
  console.log(`🔍 [IrisDetection] Checking if Iris is installed in profile: ${profileId}`);

  try {
    // First check if the loader is compatible with Iris
    const isLoaderCompatible = await isLoaderCompatibleWithIris(profileId);
    if (!isLoaderCompatible) {
      console.log(`🔍 [IrisDetection] Profile ${profileId} uses incompatible loader, skipping Iris check`);
      return true; // Return true to skip the Iris warning since it's not applicable
    }

    // Get the full profile to check installed mods
    const profile = await ProfileService.getProfile(profileId);
    console.log(`🔍 [IrisDetection] Profile loaded, checking ${profile.mods.length} mods for Iris`);

    // Iris project IDs for different platforms
    const irisProjectIds = {
      modrinth: 'YL57xq9U',      // Iris on Modrinth
      curseforge: '455508'       // Iris on CurseForge
    };

    // Check if any mod is Iris using multiple methods
    const irisMod = profile.mods.find(mod => {
      // Method 1: Check display name and filename for "iris"
      const displayName = mod.display_name?.toLowerCase() || '';
      const fileName = mod.id?.toLowerCase() || '';
      const nameMatch = displayName.includes('iris') || fileName.includes('iris');

      // Method 2: Check specific project IDs for Modrinth and CurseForge
      let projectIdMatch = false;
      if (mod.source.type === 'modrinth') {
        projectIdMatch = mod.source.project_id === irisProjectIds.modrinth;
      } else if (mod.source.type === 'curseforge') {
        projectIdMatch = mod.source.project_id === irisProjectIds.curseforge;
      }

      const isIris = nameMatch || projectIdMatch;

      if (isIris) {
        console.log(`🎯 [IrisDetection] Found Iris via ${nameMatch ? 'name' : 'project ID'}: ${mod.display_name || mod.id} (${mod.source.type})`);
      }

      return isIris;
    });

    const isInstalled = !!irisMod;
    console.log(`✅ [IrisDetection] Iris installation status for profile ${profileId}: ${isInstalled ? 'INSTALLED' : 'NOT INSTALLED'}`);

    if (irisMod) {
      console.log(`🎨 [IrisDetection] Found Iris mod: ${irisMod.display_name || irisMod.id} (${irisMod.source.type})`);
    }

    return isInstalled;
  } catch (error) {
    console.warn(`[IrisDetection] Failed to check Iris installation for profile ${profileId}:`, error);
    return false;
  }
}

/**
 * Checks if Iris shader mod is installed in a profile
 * Note: This is now just an alias for isIrisInstalled for backward compatibility
 */
export async function hasShaderModsInstalled(profileId: string): Promise<boolean> {
  console.log(`🔍 [IrisDetection] hasShaderModsInstalled called for profile: ${profileId} (delegating to isIrisInstalled)`);
  const result = await isIrisInstalled(profileId);
  console.log(`✅ [IrisDetection] hasShaderModsInstalled result for profile ${profileId}: ${result}`);
  return result;
}

/**
 * Validates if a profile has Iris shader mod installed
 * Returns an object with validation results
 */
export async function validateShaderSetup(profileId: string): Promise<{
  hasIris: boolean;
  needsIris: boolean;
  message: string;
}> {
  console.log(`🔍 [IrisDetection] validateShaderSetup called for profile: ${profileId}`);

  const hasIris = await isIrisInstalled(profileId);
  const needsIris = !hasIris;

  let message = '';
  if (hasIris) {
    message = i18n.t('iris.installed_optimal');
  } else {
    message = i18n.t('iris.required_optimal');
  }

  console.log(`📊 [IrisDetection] validateShaderSetup result for profile ${profileId}:`, {
    hasIris,
    needsIris,
    message
  });

  return {
    hasIris,
    needsIris,
    message
  };
}

/**
 * React component for Iris shader mod required modal
 * @param projectTitle - Name of the shader pack being installed
 * @param profileId - Profile ID where the shader pack was installed
 * @param installType - Type of installation (e.g., "Direct install", "Quick install", etc.)
 * @param onInstallIris - Callback function to install Iris
 * @param onClose - Callback function to close the modal
 */
export function IrisRequiredModal({
  projectTitle,
  profileId,
  installType = "Installation",
  onInstallIris,
  onClose
}: {
  projectTitle: string;
  profileId: string;
  installType?: string;
  onInstallIris?: () => void;
  onClose: () => void;
}) {
  const accentColor = useThemeStore((state) => state.accentColor);
  const { t } = useTranslation();

  console.log(`⚠️ [ModrinthSearchV2] ${installType}: Iris NOT found in profile ${profileId}, showing modal notification`);
  console.log(`🎨 [ModrinthSearchV2] ${installType}: Showing Iris requirement modal for shader pack '${projectTitle}'`);

  const modalFooter = (
    <div className="flex justify-end items-center gap-3">
      <Button
        variant="secondary"
        onClick={onClose}
      >
        {t('iris.skip_shader_mod')}
      </Button>
      {onInstallIris && (
        <Button
          onClick={onInstallIris}
          icon={<Icon icon="ph:download-simple-bold" className="w-4 h-4" />}
        >
          {t('iris.install_iris')}
        </Button>
      )}
    </div>
  );

  return (
    <Modal
      title={t('iris.shader_pack_setup')}
      titleIcon={<Icon icon="solar:eye-bold" className="w-6 h-6" style={{ color: accentColor.value }} />}
      onClose={onClose}
      width="md"
      footer={modalFooter}
    >
      <div className="p-6">
        <div className="space-y-6">
        {/* Main warning section */}
        <div className="flex items-start gap-4">
          <div className="flex-shrink-0">
            <Icon icon="solar:warning-triangle-bold" className="w-8 h-8 text-yellow-400" />
          </div>
          <div className="flex-1 space-y-3">
            <p className="text-white/80 font-minecraft-ten leading-relaxed">
              {t('iris.warning_title', { projectTitle })}
            </p>
            <p className="text-white/70 font-minecraft-ten leading-relaxed">
              {t('iris.warning_need_iris')}
            </p>
          </div>
        </div>

        {/* Performance warning */}
        <div className="p-4 rounded-lg bg-yellow-500/10 border-2 border-yellow-500/30">
          <div className="flex items-center gap-3">
            <Icon icon="solar:info-circle-bold" className="w-5 h-5 text-yellow-400 flex-shrink-0" />
            <p className="text-yellow-200 font-minecraft-ten text-sm leading-relaxed">
              {t('iris.performance_warning')}
            </p>
          </div>
        </div>

        </div>
      </div>
    </Modal>
  );
}

/**
 * Legacy function for backward compatibility - now opens a modal instead of toast
 * @deprecated Use IrisRequiredModal component instead
 */
export function createIrisRequiredModal(
  projectTitle: string,
  profileId: string,
  installType: string = "Installation",
  onInstallIris?: () => void,
  onClose?: () => void
) {
  console.log(`⚠️ [ModrinthSearchV2] ${installType}: Iris NOT found in profile ${profileId}, showing modal notification`);
  console.log(`🎨 [ModrinthSearchV2] ${installType}: Showing Iris requirement modal for shader pack '${projectTitle}'`);

  // This function is deprecated - use IrisRequiredModal component with proper modal management
  console.warn('createIrisRequiredModal is deprecated. Use IrisRequiredModal component with useGlobalModal instead.');
}

/**
 * Legacy function for backward compatibility - now opens a modal instead of toast
 * @deprecated Use createIrisRequiredModal instead
 */
export function showIrisRequiredToast(
  projectTitle: string,
  profileId: string,
  installType: string = "Installation"
): void {
  console.log(`⚠️ [ModrinthSearchV2] ${installType}: Iris NOT found in profile ${profileId}, showing modal notification`);
  console.log(`🎨 [ModrinthSearchV2] ${installType}: Showing Iris requirement modal for shader pack '${projectTitle}'`);

  // This function is deprecated - use createIrisRequiredModal with proper modal management
  console.warn('showIrisRequiredToast is deprecated. Use createIrisRequiredModal with useGlobalModal instead.');
}

/**
 * Shows success log when Iris is already installed
 * @param profileId - Profile ID where Iris was found
 * @param installType - Type of installation (e.g., "Direct install", "Quick install", etc.)
 */
export function showIrisAlreadyInstalledLog(profileId: string, installType: string = "Installation"): void {
  console.log(`✅ [ModrinthSearchV2] ${installType}: Iris already installed in profile ${profileId}, no toast needed`);
}

/**
 * Shows initial log when checking for Iris after shader pack installation
 * @param projectTitle - Name of the shader pack being installed
 * @param profileId - Profile ID where the shader pack was installed
 * @param installType - Type of installation (e.g., "Direct install", "Quick install", etc.)
 */
export function showIrisCheckStartLog(
  projectTitle: string,
  profileId: string,
  installType: string = "Installation"
): void {
  console.log(`🎨 [ModrinthSearchV2] ${installType}: Shader pack '${projectTitle}' installed to profile ${profileId}, checking for Iris...`);
}

/**
 * Shows error log when Iris check fails
 * @param profileId - Profile ID where the check failed
 * @param installType - Type of installation (e.g., "Direct install", "Quick install", etc.)
 * @param error - The error that occurred
 */
export function showIrisCheckErrorLog(
  profileId: string,
  installType: string = "Installation",
  error: any
): void {
  console.warn(`[ModrinthSearchV2] ${installType}: Failed to check Iris installation status for profile ${profileId}:`, error);
}

/**
 * Comprehensive function to handle Iris detection, logging and modal display for shader pack installations
 * @param projectTitle - Name of the shader pack being installed
 * @param profileId - Profile ID where the shader pack was installed
 * @param projectId - Project ID for unique modal identification
 * @param installType - Type of installation (e.g., "Direct install", "Quick install", etc.)
 * @param showModal - Function to show modal (from useGlobalModal)
 * @param hideModal - Function to hide modal (from useGlobalModal)
 * @param onInstallIris - Optional callback when user clicks "Install Iris Now"
 */
export async function handleIrisCheckAndShowModal(
  projectTitle: string,
  profileId: string,
  projectId: string,
  installType: string = "Installation",
  showModal: (id: string, component: React.ReactNode, zIndex?: number) => void,
  hideModal: (id: string) => void,
  onInstallIris?: () => void
): Promise<boolean> {
  showIrisCheckStartLog(projectTitle, profileId, installType);

  try {
    const hasIris = await isIrisInstalled(profileId);
    if (!hasIris) {
      // Show modal immediately to alert user quickly
      const modalId = `iris-required-${projectId}-${Date.now()}`;
      showModal(
        modalId,
        <IrisRequiredModal
          projectTitle={projectTitle}
          profileId={profileId}
          installType={installType}
            onInstallIris={async () => {
              try {
                console.log('🎯 [IrisModal] User clicked "Install Iris" - starting installation...');

                // Show loading state or progress indication
                toast.loading(i18n.t('iris.installing'), {
                  id: 'iris-install',
                  duration: 10000
                });

                // Install Iris
                const installSuccess = await installIrisToProfile(profileId);

                if (installSuccess) {
                  toast.success(i18n.t('iris.install_success'), {
                    id: 'iris-install',
                    duration: 3000
                  });

                  // Call custom install callback if provided
                  if (onInstallIris) {
                    onInstallIris();
                  }

                  console.log('🎉 [IrisModal] Iris installation completed successfully');
                } else {
                  toast.error(i18n.t('iris.install_failed'), {
                    id: 'iris-install',
                    duration: 5000
                  });
                  console.error('❌ [IrisModal] Iris installation failed');
                }
              } catch (error) {
                console.error('❌ [IrisModal] Error during Iris installation:', error);
                toast.error(i18n.t('iris.installation_error'), {
                  id: 'iris-install',
                  duration: 5000
                });
              } finally {
                hideModal(modalId);
              }
            }}
          onClose={() => hideModal(modalId)}
        />,
        1200
      );

      return false; // Iris is not installed
    } else {
      showIrisAlreadyInstalledLog(profileId, installType);
      return true; // Iris is installed
    }
  } catch (error) {
    showIrisCheckErrorLog(profileId, installType, error);
    return false; // Error occurred, assume Iris is not installed
  }
}

/**
 * Legacy function for backward compatibility - now handles modal instead of toast
 * @param projectTitle - Name of the shader pack being installed
 * @param profileId - Profile ID where the shader pack was installed
 * @param installType - Type of installation (e.g., "Direct install", "Quick install", etc.)
 * @deprecated Use handleIrisCheckAndShowModal instead
 */
export async function handleIrisCheckForShaderPack(
  projectTitle: string,
  profileId: string,
  installType: string = "Installation"
): Promise<boolean> {
  showIrisCheckStartLog(projectTitle, profileId, installType);

  try {
    const hasIris = await isIrisInstalled(profileId);
    if (!hasIris) {
      showIrisRequiredToast(projectTitle, profileId, installType);
      return false; // Iris is not installed
    } else {
      showIrisAlreadyInstalledLog(profileId, installType);
      return true; // Iris is installed
    }
  } catch (error) {
    showIrisCheckErrorLog(profileId, installType, error);
    return false; // Error occurred, assume Iris is not installed
  }
}
