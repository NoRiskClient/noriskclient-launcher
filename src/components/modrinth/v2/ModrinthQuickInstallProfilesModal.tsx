import { useMemo, useState } from 'react';
import { Modal } from '../../ui/Modal';
import { Icon } from '@iconify/react';
import type { ModrinthSearchHit } from '../../../types/modrinth';
import type { UnifiedVersion } from '../../../types/unified';
import type { Profile } from '../../../types/profile';
import { ModrinthQuickProfile } from './ModrinthQuickProfile';
import { Button } from '../../ui/buttons/Button';
import { toast } from 'react-hot-toast';
import { useTranslation } from 'react-i18next';
import { sortRecentFirst } from "../../../utils/profile-sort";
import { useProfileStore } from "../../../store/profile-store";
import { ProfilePickerGrid } from "../../profiles/ProfilePickerGrid";
import { useProfileInstallStatus } from "../../../hooks/useProfileInstallStatus";
import { cn } from "../../../lib/utils";
import { PLAIN_TEXT } from "../../ui/typography";

interface ModrinthQuickInstallProfilesModalProps {
  project: ModrinthSearchHit;
  profiles: Profile[];
  // Legacy format for quick install (without specific version)
  onProfileSelect?: (project: ModrinthSearchHit, profile: Profile) => void;
  // New format for specific version install (compatible with ModrinthInstallModalV2)
  onInstallToProfile?: (profileId: string) => void;
  onUninstallClick?: (profileId: string, project: ModrinthSearchHit, version: UnifiedVersion) => Promise<void>;
  onInstallToNewProfile?: (
    profileName: string,
    project: ModrinthSearchHit,
    version: UnifiedVersion,
    sourceProfileIdToCopy?: string | null
  ) => Promise<void>;
  onProfileClick?: (profile: Profile) => void;
  onClose: () => void;
  installingProfiles?: Record<string, boolean>;
  uninstallingProfiles?: Record<string, boolean>;
  // Optional version for specific version install
  version?: UnifiedVersion | null;
}

export function ModrinthQuickInstallProfilesModal({
  project,
  profiles,
  onProfileSelect,
  onInstallToProfile,
  onUninstallClick,
  onInstallToNewProfile,
  onProfileClick,
  onClose,
  installingProfiles = {},
  uninstallingProfiles = {},
  version,
}: ModrinthQuickInstallProfilesModalProps) {
  const { t } = useTranslation();
  const lastPlayedProfileId = useProfileStore((state) => state.lastPlayedProfileId);
  const sortedProfiles = useMemo(() => sortRecentFirst(profiles, lastPlayedProfileId), [profiles, lastPlayedProfileId]);
  const detectedInstalled = useProfileInstallStatus(project, version, sortedProfiles);
  const [installedOverride, setInstalledOverride] = useState<Record<string, boolean>>({});
  const [removing, setRemoving] = useState<Record<string, boolean>>({});

  const [showQuickProfileView, setShowQuickProfileView] = useState(false);
  const [quickProfileName, setQuickProfileName] = useState('');
  const [quickProfileError, setQuickProfileError] = useState<string | null>(null);
  const [selectedSourceProfileId, setSelectedSourceProfileId] = useState<string | null>(null);
  const [isCreatingProfile, setIsCreatingProfile] = useState(false);

  const handleInstallClick = (profile: Profile) => {
    setInstalledOverride((prev) => ({ ...prev, [profile.id]: true }));
    if (onInstallToProfile) {
      onInstallToProfile(profile.id);
    } else if (onProfileSelect) {
      onProfileSelect(project, profile);
    }
  };

  const handleUninstallClick = async (profile: Profile) => {
    if (onUninstallClick && version) {
      setRemoving((prev) => ({ ...prev, [profile.id]: true }));
      try {
        await onUninstallClick(profile.id, project, version);
        setInstalledOverride((prev) => ({ ...prev, [profile.id]: false }));
      } finally {
        setRemoving((prev) => ({ ...prev, [profile.id]: false }));
      }
    }
  };

  const switchToQuickProfileView = () => {
    setQuickProfileName('');
    setQuickProfileError(null);
    setSelectedSourceProfileId(null);
    setShowQuickProfileView(true);
  };

  const switchToProfileListView = () => {
    setShowQuickProfileView(false);
    setQuickProfileName('');
    setQuickProfileError(null);
    setSelectedSourceProfileId(null);
  };

  // Handle profile creation with promise toast
  const handleCreateAndInstallProfile = async () => {
    if (!quickProfileName.trim()) {
      setQuickProfileError(t('modrinth.profile_name_empty'));
      return;
    }
    setQuickProfileError(null);

    setIsCreatingProfile(true);

    const profileNameToCreate = quickProfileName.trim();
    const createPromise = onInstallToNewProfile!(profileNameToCreate, project, version, selectedSourceProfileId);

    try {
      await toast.promise(createPromise, {
        loading: selectedSourceProfileId
          ? t('modrinth.creating_profile_copying', { name: profileNameToCreate, title: project.title })
          : t('modrinth.creating_profile_installing', { name: profileNameToCreate, title: project.title }),
        success: (result) => {
          console.log('✅ New profile created successfully');
          // Close the modal after successful profile creation
          onClose();
          return selectedSourceProfileId
            ? t('modrinth.profile_copy_success', { name: profileNameToCreate, title: project.title })
            : t('modrinth.profile_create_success', { name: profileNameToCreate, title: project.title });
        },
        error: (error) => {
          console.error('❌ Failed to create new profile:', error);
          setQuickProfileError(error instanceof Error ? error.message : t('modrinth.profile_create_failed'));
          return t('modrinth.profile_create_error', { error: error instanceof Error ? error.message : t('modrinth.unknown_error') });
        }
      });
    } finally {
      setIsCreatingProfile(false);
    }
  };

  const isActuallyCopying = selectedSourceProfileId !== null;

  return (
    <Modal
      title={
        showQuickProfileView
          ? (isActuallyCopying ? t('modrinth.copy_and_install_title', { title: project.title }) : t('modrinth.new_profile_for', { title: project.title }))
          : (version ? t('modrinth.install_title_version', { title: project.title, version: version.version_number }) : t('modrinth.install_title', { title: project.title }))
      }
      titleIcon={<Icon icon="solar:download-minimalistic-bold" className="w-6 h-6" />}
      titleClassName={PLAIN_TEXT}
      onClose={onClose}
      width="md"
      footer={
        showQuickProfileView ? (
          <div className="flex items-center gap-3 min-h-[44px]">
            <Button variant="secondary" className={PLAIN_TEXT} onClick={switchToProfileListView} disabled={isCreatingProfile}>
              {t('modrinth.back_to_profiles')}
            </Button>
            <Button
              variant="success"
              className={cn("ml-auto", PLAIN_TEXT)}
              onClick={handleCreateAndInstallProfile}
              disabled={!quickProfileName.trim() || isCreatingProfile}
            >
              {isCreatingProfile ? t('modrinth.creating') : t('modrinth.create_and_install')}
            </Button>
          </div>
        ) : onInstallToNewProfile ? (
          <div className="flex items-center gap-3 min-h-[44px]">
            <Button
              variant="secondary"
              className={cn("ml-auto", PLAIN_TEXT)}
              icon={<Icon icon="solar:add-folder-line-duotone" className="w-4 h-4" />}
              onClick={switchToQuickProfileView}
            >
              {t('profiles.new_profile')}
            </Button>
          </div>
        ) : undefined
      }
    >
      <div className="px-6 pt-5 pb-1">
        {showQuickProfileView ? (
          // Quick Profile Creation View
          <div>
            <ModrinthQuickProfile
              profileName={quickProfileName}
              onProfileNameChange={(name) => {
                setQuickProfileName(name);
                if (quickProfileError && name.trim()) setQuickProfileError(null);
              }}
              error={quickProfileError}
              isLoading={isCreatingProfile}
              selectedSourceProfileId={selectedSourceProfileId}
              onSourceProfileChange={setSelectedSourceProfileId}
            />

          </div>
        ) : (
          <>
            {/* Version info (placed above search) */}
            {version && (
              <p className="font-minecraft text-sm text-white/55 tracking-wide mb-3">
                {t('modrinth.will_install_version', { version: version.version_number, title: project.title })}
              </p>
            )}

            {sortedProfiles.length === 0 ? (
              <div className="text-center py-8 flex flex-col justify-center">
                <Icon icon="solar:folder-error-bold" className="mx-auto mb-4 text-4xl text-white/30" />
                <h3 className="text-sm font-smallcaps text-white/50 mb-2">{t('modrinth.no_profiles_available')}</h3>
                <p className="text-white/40 text-sm lowercase">{t('modrinth.create_profile_first')}</p>
              </div>
            ) : (
              <ProfilePickerGrid
                profiles={sortedProfiles}
                lastPlayedProfileId={lastPlayedProfileId}
                listClassName="max-h-[360px]"
                onSelect={onProfileClick}
                renderAction={(profile) => {
                  const installed = installedOverride[profile.id] ?? !!detectedInstalled[profile.id];
                  const busy = installingProfiles[profile.id] || uninstallingProfiles[profile.id] || removing[profile.id];
                  if (busy) {
                    return <span className="w-9 h-9 shrink-0 flex items-center justify-center"><Icon icon="svg-spinners:ring-resize" className="w-5 h-5 text-white/60" /></span>;
                  }
                  if (installed && onUninstallClick && version) {
                    return (
                      <button
                        type="button"
                        title={t('common.uninstall')}
                        onClick={(e) => {
                          e.stopPropagation();
                          void handleUninstallClick(profile);
                        }}
                        className="w-9 h-9 shrink-0 rounded-md flex items-center justify-center text-emerald-300 hover:text-rose-300 hover:bg-rose-500/15 transition-colors"
                      >
                        <Icon icon="solar:check-circle-bold" className="w-5 h-5" />
                      </button>
                    );
                  }
                  if (installed) {
                    return <span className="w-9 h-9 shrink-0 flex items-center justify-center"><Icon icon="solar:check-circle-bold" className="w-5 h-5 text-emerald-300" /></span>;
                  }
                  return (
                    <button
                      type="button"
                      title={t('modrinth.install')}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleInstallClick(profile);
                      }}
                      className="w-9 h-9 shrink-0 rounded-md flex items-center justify-center text-emerald-300 bg-emerald-500/10 border border-emerald-400/20 hover:bg-emerald-500/20 transition-colors"
                    >
                      <Icon icon="solar:download-minimalistic-bold" className="w-5 h-5" />
                    </button>
                  );
                }}
              />
            )}

          </>
        )}
      </div>
    </Modal>
  );
}
