import { useProfileSettingsStore } from "../../store/profile-settings-store";
import { ProfileSettings } from "../profiles/ProfileSettings";

export function ProfileSettingsModal() {
  const { isModalOpen, profile, closeModal } = useProfileSettingsStore();

  if (!isModalOpen || !profile) {
    return null;
  }

  return (
    <ProfileSettings
      profile={profile}
      onClose={closeModal}
    />
  );
}
