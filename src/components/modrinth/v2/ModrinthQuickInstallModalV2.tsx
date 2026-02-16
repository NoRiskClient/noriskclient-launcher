"use client";

import React, { useState, useEffect } from 'react';
import type {
  ModrinthSearchHit,
  ModrinthVersion,
} from '../../../types/modrinth';
import type { UnifiedVersion } from '../../../types/unified';
import { Icon } from '@iconify/react';
import { Modal } from '../../ui/Modal';
import { Button } from '../../ui/buttons/Button';
import { useThemeStore } from '../../../store/useThemeStore'; // For accent color on Installed button
import { cn } from '../../../lib/utils';
import { ModrinthQuickProfile } from './ModrinthQuickProfile'; // New import
// Potentially import Profile type if available and not 'any'
// import type { Profile } from '../../../types/profile';
import { toast } from 'react-hot-toast';
import { useTranslation } from 'react-i18next';

interface ModrinthQuickInstallModalV2Props {
  isOpen: boolean;
  onClose: () => void;
  project: ModrinthSearchHit | null;
  versions: UnifiedVersion[] | null;
  isLoading: boolean;
  error: string | null;
  profiles: any[]; // Replace 'any' with actual Profile type
  selectedProfileId?: string | null; // For highlighting
  installStatus: Record<string, boolean>;
  installingProfiles: Record<string, boolean>;
  onInstallToProfile: (profileId: string) => void;
  onUninstallClick?: (profileId: string, project: ModrinthSearchHit, version: UnifiedVersion) => Promise<void>;
  findBestVersionForProfile: (
    profile: any, // Replace 'any' with Profile type
    versions: UnifiedVersion[],
  ) => UnifiedVersion | null;
  onInstallToNewProfile: (
    profileName: string,
    project: ModrinthSearchHit,
    version: UnifiedVersion,
    sourceProfileIdToCopy: string | null, // Added
  ) => Promise<void>;
}

export const ModrinthQuickInstallModalV2: React.FC<ModrinthQuickInstallModalV2Props> = ({
  isOpen,
  onClose,
  project,
  versions,
  isLoading,
  error,
  profiles,
  selectedProfileId,
  installStatus,
  installingProfiles,
  onInstallToProfile,
  onUninstallClick,
  findBestVersionForProfile,
  onInstallToNewProfile,
}) => {
  const { t } = useTranslation();
  const accentColor = useThemeStore((state) => state.accentColor); // Moved hook to the top
  const [showQuickProfileView, setShowQuickProfileView] = useState(false);
  const [isCreatingProfile, setIsCreatingProfile] = useState(false);
  const [quickProfileName, setQuickProfileName] = useState('');
  const [quickProfileError, setQuickProfileError] = useState<string | null>(null);
  const [creationResult, setCreationResult] = useState<'success' | 'error' | null>(null); // New state
  const [lastCreationErrorMessage, setLastCreationErrorMessage] = useState<string | null>(null); // New state for creation error
  const [sourceProfileToCopyId, setSourceProfileToCopyId] = useState<string | null>(null); // New state for copy

  useEffect(() => {
    if (!isOpen) {
      setShowQuickProfileView(false);
      setIsCreatingProfile(false);
      setQuickProfileName('');
      setQuickProfileError(null);
      setCreationResult(null); // Reset on close
      setLastCreationErrorMessage(null); // Reset on close
      setSourceProfileToCopyId(null); // Reset on close
    }
  }, [isOpen]);

  if (!isOpen || !project) return null;

  const switchToQuickProfileView = () => {
    setQuickProfileName(''); // Ensure name is empty when switching
    setQuickProfileError(null);
    setCreationResult(null); // Clear previous result
    setSourceProfileToCopyId(null); // Reset for fresh start
    setShowQuickProfileView(true);
  };

  const switchToProfileListView = () => {
    setShowQuickProfileView(false);
    setQuickProfileName('');
    setQuickProfileError(null);
    setCreationResult(null); // Clear previous result
  };

  const handleCreateAndInstallProfile = async () => {
    if (!quickProfileName.trim()) {
      setQuickProfileError(t('modrinth.profile_name_empty'));
      return;
    }
    setQuickProfileError(null);
    setLastCreationErrorMessage(null);

    if (!project || !versions || versions.length === 0) { // Guard clause
        toast.error(t('modrinth.errors.missing_data'));
        setCreationResult('error'); // Set error state if essential data is missing
        setLastCreationErrorMessage(t('modrinth.errors.missing_data'));
        return;
    }
    const versionToInstall = versions[0];
    if (!versionToInstall) {
        toast.error(t('modrinth.errors.no_suitable_version'));
        setCreationResult('error');
        setLastCreationErrorMessage(t('modrinth.errors.no_suitable_version'));
        return;
    }

    setIsCreatingProfile(true);
    try {
      await onInstallToNewProfile(quickProfileName.trim(), project, versionToInstall, sourceProfileToCopyId);
      setCreationResult('success');
    } catch (err: any) {
      console.error("Error in handleCreateAndInstallProfile (quick install):", err);
      setCreationResult('error');
      setLastCreationErrorMessage(err?.message || t('modrinth.unknown_error'));
    } finally {
      setIsCreatingProfile(false);
    }
  };

  const modalContent = (
    <>
      {showQuickProfileView && project ? (
        <div className="px-6 py-2 sm:py-4">
          <ModrinthQuickProfile
            accentColor={accentColor}
            projectTitle={project.title}
            versionNumber={versions && versions.length > 0 ? versions[0].version_number : undefined}
            profileName={quickProfileName}
            onProfileNameChange={(name) => {
              setQuickProfileName(name);
              if (quickProfileError && name.trim()) setQuickProfileError(null);
            }}
            error={quickProfileError}
            isLoading={isCreatingProfile}
            selectedSourceProfileId={sourceProfileToCopyId}
            onSourceProfileChange={setSourceProfileToCopyId}
          />
        </div>
      ) : isLoading ? (
        <div className="flex justify-center items-center py-8">
          <svg
            className="animate-spin h-8 w-8 text-blue-500"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            ></circle>
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
            ></path>
          </svg>
          <span className="ml-3 text-gray-300 font-minecraft-ten">
            {t('modrinth.finding_compatible_versions')}
          </span>
        </div>
      ) : error ? (
        <div className="text-red-400 text-center py-6 px-6">{error}</div>
      ) : versions && versions.length > 0 ? (
        <div className="px-6 py-4">
          <p className="text-gray-300 mb-4 text-xs font-minecraft-ten">
            {t('modrinth.quick_install_description')}
          </p>

          <div className="mb-1">
            <div 
              className="max-h-60 overflow-y-auto border custom-scrollbar" 
              style={{ borderColor: `${accentColor.value}80` }}
            >
              {profiles.length > 0 ? (
                [...profiles]
                  .sort((a, b) => {
                    if (a.id === selectedProfileId) return -1;
                    if (b.id === selectedProfileId) return 1;
                    return 0;
                  })
                  .map((profile) => {
                    const bestVersion = findBestVersionForProfile(
                      profile,
                      versions,
                    );
                    const isCompatible = !!bestVersion;

                    return (
                      <div
                        key={profile.id}
                        className={cn(
                          "p-3 border-b last:border-b-0 flex justify-between items-center hover:bg-white/10 transition-colors duration-150"
                        )}
                        style={{
                          backgroundColor: profile.id === selectedProfileId ? `${accentColor.value}50` : `${accentColor.value}30`,
                          borderBottomColor: `${accentColor.value}80`,
                        }}
                      >
                        <div className="text-white flex-grow mr-3 min-w-0">
                          <span className="font-medium text-base font-minecraft-ten truncate">{profile.name}</span>
                          {profile.id === selectedProfileId && (
                            <span className="ml-2 text-xs text-green-400">
                              ({t('modrinth.current_profile')})
                            </span>
                          )}
                          {isCompatible && bestVersion && (
                            <div className="text-xs text-gray-400 mt-0.5 font-minecraft-ten truncate">
                              {t('modrinth.version_label', { version: bestVersion.version_number })}
                            </div>
                          )}
                        </div>

                        {installingProfiles[profile.id] ? (
                          <Button
                            size="xs"
                            variant="secondary"
                            disabled
                            shadowDepth="short"
                            icon={ <svg /* spinner */ className="animate-spin h-3 w-3 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" > <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle> <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path> </svg>}
                            iconPosition="left"
                            className="flex-shrink-0"
                          >
                            {t('modrinth.installing')}
                          </Button>
                        ) : installStatus[profile.id] && bestVersion && onUninstallClick ? (
                          <Button
                            onClick={async () => {
                              if (project && bestVersion) {
                                try {
                                  await onUninstallClick(profile.id, project, bestVersion);
                                } catch (err) {
                                  console.error("Uninstall from quick modal failed:", err);
                                }
                              }
                            }}
                            size="xs"
                            variant="destructive"
                            shadowDepth="short"
                            icon={<Icon icon="solar:trash-bin-trash-bold" className="w-3.5 h-3.5" />}
                            iconPosition="left"
                            className="flex-shrink-0"
                          >
                            {t('common.uninstall')}
                          </Button>
                        ) : !isCompatible ? (
                          <Button
                            size="xs"
                            variant="secondary"
                            disabled
                            shadowDepth="short"
                            icon={<Icon icon="solar:danger-bold" className="w-3.5 h-3.5" />}
                            className="flex-shrink-0"
                          >
                            {t('modrinth.not_compatible')}
                          </Button>
                        ) : (
                          <Button
                            onClick={() => onInstallToProfile(profile.id)}
                            disabled={installingProfiles[profile.id]}
                            size="xs"
                            variant={installingProfiles[profile.id] ? "secondary" : "success"}
                            shadowDepth="short"
                            icon={installingProfiles[profile.id] ? 
                                <svg
                                    className="animate-spin h-3 w-3 text-white"
                                    xmlns="http://www.w3.org/2000/svg"
                                    fill="none"
                                    viewBox="0 0 24 24"
                                    >
                                    <circle
                                        className="opacity-25"
                                        cx="12"
                                        cy="12"
                                        r="10"
                                        stroke="currentColor"
                                        strokeWidth="4"
                                    ></circle>
                                    <path
                                        className="opacity-75"
                                        fill="currentColor"
                                        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                                    ></path>
                                    </svg> : <Icon icon="solar:download-minimalistic-bold" className="w-3.5 h-3.5" />}
                            iconPosition="left"
                            className="flex-shrink-0"
                          >
                            {installingProfiles[profile.id] ? t('modrinth.installing') : t('modrinth.install')}
                          </Button>
                        )}
                      </div>
                    );
                  })
              ) : (
                <p className="p-4 text-center text-gray-400">
                  {t('modrinth.no_profiles_available')}
                </p>
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className="text-gray-300 text-center py-6 px-6">
          {t('modrinth.no_versions_found')}
        </div>
      )}
    </>
  );

  const handleModalClose = () => {
    setShowQuickProfileView(false); 
    setIsCreatingProfile(false);
    setQuickProfileName('');
    setQuickProfileError(null);
    setCreationResult(null); // Reset creation result
    setLastCreationErrorMessage(null);
    setSourceProfileToCopyId(null);
    onClose();
  };

  let modalContentLayout;

  if (creationResult === 'success') {
    modalContentLayout = (
      <div className="p-4 text-center space-y-3">
        <Icon icon="solar:check-circle-bold" className="w-16 h-16 text-green-500 mx-auto" />
        <h3 className="text-xl font-semibold text-gray-100">
          {sourceProfileToCopyId ? t('modrinth.profile_copied_installed') : t('modrinth.profile_created_installed')}
        </h3>
        <p className="text-sm text-gray-300 font-minecraft-ten">
          {t('modrinth.install_success_message', { title: project.title, version: versions?.[0]?.version_number || 'latest', profile: quickProfileName.trim() })}
          {sourceProfileToCopyId && profiles.find(p => p.id === sourceProfileToCopyId) && (
            <>
              <br />
              {t('modrinth.settings_copied_from', { source: profiles.find(p => p.id === sourceProfileToCopyId)?.name })}
            </>
          )}
        </p>
      </div>
    );
  } else if (creationResult === 'error') {
    modalContentLayout = (
      <div className="p-4 text-center space-y-3">
        <Icon icon="solar:close-circle-bold" className="w-16 h-16 text-red-500 mx-auto" />
        <h3 className="text-xl font-semibold text-gray-100">{t('modrinth.operation_failed')}</h3>
        <p className="text-sm text-red-400">
          {lastCreationErrorMessage || t('modrinth.error_creating_or_installing')}
        </p>
      </div>
    );
  } else {
    modalContentLayout = modalContent;
  }

  return (
    <Modal
      title={
        creationResult ?
          (creationResult === 'success' ? t('modrinth.operation_successful') : t('modrinth.operation_failed')) :
        showQuickProfileView ?
          (sourceProfileToCopyId ? t('modrinth.copy_profile_install_title', { title: project.title }) : t('modrinth.new_profile_for', { title: project.title })) :
          t('modrinth.quick_install_title', { title: project.title })
      }
      titleIcon={
        creationResult ? 
          (creationResult === 'success' ? <Icon icon="solar:check-circle-bold-duotone" className="w-5 h-5 mr-2" /> : <Icon icon="solar:close-circle-bold-duotone" className="w-5 h-5 mr-2" />) :
        showQuickProfileView ? 
          (sourceProfileToCopyId ? <Icon icon="solar:copy-bold-duotone" className="w-5 h-5 mr-2" /> : <Icon icon="solar:folder-with-files-bold-duotone" className="w-5 h-5 mr-2" />) : 
          <Icon icon="solar:bolt-bold-duotone" className="w-5 h-5" />
      }
      onClose={handleModalClose}
      width="md"
      footer={
        <div className="flex justify-between items-center w-full">
          {creationResult ? (
            <div className="w-full flex justify-end">
              <Button onClick={handleModalClose} variant="secondary" shadowDepth="short">
                {t('common.close')}
              </Button>
            </div>
          ) : showQuickProfileView ? (
            <>
              <Button
                variant="secondary"
                onClick={switchToProfileListView}
                disabled={isCreatingProfile}
                shadowDepth="short"
                size="sm"
                icon={<Icon icon="solar:arrow-left-linear" className="w-4 h-4" />}
                className="mr-auto"
              >
                {t('modrinth.back_to_profiles')}
              </Button>
              <Button
                variant="success"
                onClick={handleCreateAndInstallProfile}
                disabled={isCreatingProfile || !quickProfileName.trim()}
                shadowDepth="short"
                size="sm"
                icon={isCreatingProfile ? <Icon icon="line-md:loading-twotone-loop" className="w-4 h-4" /> : <Icon icon="solar:disk-bold-duotone" className="w-4 h-4" />}
              >
                {isCreatingProfile ? (sourceProfileToCopyId ? t('modrinth.copying') : t('modrinth.creating')) : (sourceProfileToCopyId ? t('modrinth.copy_and_install') : t('modrinth.create_and_install'))}
              </Button>
            </>
          ) : (
            // Footer for profile list view (or initial loading/error states)
            <>
              { !isLoading && !error && versions && versions.length > 0 ? (
                <Button
                  variant="secondary"
                  onClick={switchToQuickProfileView}
                  icon={<Icon icon="solar:add-folder-line-duotone" className="w-4 h-4 mr-1" />}
                  shadowDepth="short"
                  size="sm"
                  className="mr-auto"
                >
                  {t('modrinth.new_profile')}
                </Button>
              ) : <div className="mr-auto"></div> }
              <Button
                onClick={handleModalClose}
                variant="secondary"
                shadowDepth="short"
                size="sm"
              >
                {t('common.close')}
              </Button>
            </>
          )}
        </div>
      }
    >
      <div className="px-6 py-4">
        {modalContentLayout}
      </div>
    </Modal>
  );
}; 