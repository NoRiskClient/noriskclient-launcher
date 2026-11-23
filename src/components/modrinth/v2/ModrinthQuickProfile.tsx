import React, { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { SearchStyleInput } from "../../ui/Input";
import { FieldLabel, SegmentedControl } from "../../ui/SegmentedControl";
import { cn } from "../../../lib/utils";
import { useProfileStore } from "../../../store/profile-store";
import { sortRecentFirst } from "../../../utils/profile-sort";
import { ProfilePickerGrid } from "../../profiles/ProfilePickerGrid";

interface ModrinthQuickProfileProps {
  profileName: string;
  onProfileNameChange: (name: string) => void;
  error: string | null;
  isLoading?: boolean;
  selectedSourceProfileId: string | null;
  onSourceProfileChange: (profileId: string | null) => void;
}

type BaseMode = "empty" | "copy";

export const ModrinthQuickProfile: React.FC<ModrinthQuickProfileProps> = ({
  profileName,
  onProfileNameChange,
  error,
  isLoading = false,
  selectedSourceProfileId,
  onSourceProfileChange,
}) => {
  const { t } = useTranslation();
  const profiles = useProfileStore((s) => s.profiles);
  const lastPlayedProfileId = useProfileStore((s) => s.lastPlayedProfileId);
  const sorted = useMemo(() => sortRecentFirst(profiles, lastPlayedProfileId), [profiles, lastPlayedProfileId]);
  const [mode, setMode] = useState<BaseMode>(selectedSourceProfileId ? "copy" : "empty");

  const changeMode = (next: BaseMode) => {
    setMode(next);
    onSourceProfileChange(next === "copy" ? (selectedSourceProfileId ?? sorted[0]?.id ?? null) : null);
  };

  return (
    <div className={cn("space-y-5", isLoading && "opacity-70 pointer-events-none")}>
      <div className="space-y-2">
        <FieldLabel htmlFor="quickProfileNameInput">{t("modrinth.quick_profile.name_label")}</FieldLabel>
        <SearchStyleInput
          id="quickProfileNameInput"
          autoFocus
          value={profileName}
          onChange={(e) => onProfileNameChange(e.target.value)}
          placeholder={t("placeholders.new_profile_name")}
          icon="solar:folder-bold"
          error={error || undefined}
          disabled={isLoading}
        />
      </div>

      {sorted.length > 0 && (
        <div className="space-y-2">
          <FieldLabel>{t("modrinth.quick_profile.base_label")}</FieldLabel>
          <SegmentedControl<BaseMode>
            stretch
            value={mode}
            onChange={changeMode}
            disabled={isLoading}
            options={[
              { value: "empty", label: t("modrinth.quick_profile.base_empty") },
              { value: "copy", label: t("modrinth.quick_profile.base_copy") },
            ]}
          />
          {mode === "copy" && (
            <div className="pt-1">
              <ProfilePickerGrid
                profiles={sorted}
                lastPlayedProfileId={lastPlayedProfileId}
                selectedId={selectedSourceProfileId}
                onSelect={(p) => onSourceProfileChange(p.id)}
                disabled={isLoading}
                listClassName="max-h-[240px]"
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
};

