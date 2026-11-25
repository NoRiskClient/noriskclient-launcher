import { useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { SearchWithFilters } from "../ui/SearchWithFilters";
import { ProfileIconV2 } from "./ProfileIconV2";
import { useThemeStore } from "../../store/useThemeStore";
import { cn } from "../../lib/utils";
import type { Profile } from "../../types/profile";

interface ProfilePickerGridProps {
  profiles: Profile[];
  lastPlayedProfileId?: string | null;
  searchThreshold?: number;
  selectedId?: string | null;
  selectedIds?: ReadonlySet<string>;
  onSelect?: (profile: Profile) => void;
  renderAction?: (profile: Profile) => ReactNode;
  disabled?: boolean;
  listClassName?: string;
}

export function ProfilePickerGrid({
  profiles,
  lastPlayedProfileId = null,
  searchThreshold = 6,
  selectedId = null,
  selectedIds,
  onSelect,
  renderAction,
  disabled = false,
  listClassName,
}: ProfilePickerGridProps) {
  const { t } = useTranslation();
  const accent = useThemeStore((s) => s.accentColor.value);
  const [query, setQuery] = useState("");

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return profiles;
    return profiles.filter((p) => p.name.toLowerCase().includes(q) || p.game_version.toLowerCase().includes(q));
  }, [query, profiles]);

  return (
    <div className="space-y-3">
      {profiles.length > searchThreshold && !disabled && (
        <SearchWithFilters
          placeholder={t("profiles.picker.search")}
          searchValue={query}
          onSearchChange={setQuery}
          showSort={false}
          showFilter={false}
          compact
        />
      )}
      <div className={cn("grid grid-cols-2 gap-2 overflow-y-auto custom-scrollbar pr-1", listClassName)}>
        {shown.map((profile) => {
          const active = selectedIds ? selectedIds.has(profile.id) : profile.id === selectedId;
          return (
            <div
              key={profile.id}
              role={onSelect ? "button" : undefined}
              tabIndex={onSelect && !disabled ? 0 : undefined}
              onClick={() => !disabled && onSelect?.(profile)}
              onKeyDown={(e) => {
                if (onSelect && !disabled && (e.key === "Enter" || e.key === " ")) {
                  e.preventDefault();
                  onSelect(profile);
                }
              }}
              className={cn(
                "flex items-center gap-3 rounded-lg border-2 p-2 text-left transition-colors select-none",
                active ? "bg-white/10" : "border-white/10 bg-black/20",
                onSelect && !disabled && !active && "cursor-pointer hover:bg-white/5",
                disabled && !active && "opacity-40",
              )}
              style={active ? { borderColor: accent } : undefined}
            >
              <ProfileIconV2 profile={profile} size="sm" />
              <div className="min-w-0 flex-1">
                <div className="font-minecraft text-base text-white tracking-wide truncate normal-case">{profile.name}</div>
                <div className="font-minecraft text-sm text-white/55 tracking-wide">
                  {t("profiles.picker.version", { version: profile.game_version })}
                </div>
                {profile.id === lastPlayedProfileId && (
                  <span className="inline-block mt-0.5 rounded px-1.5 text-xs font-minecraft tracking-wide bg-green-500/20 text-green-300 border border-green-500/40">
                    {t("profiles.picker.last_played")}
                  </span>
                )}
              </div>
              {renderAction?.(profile)}
            </div>
          );
        })}
      </div>
      {query.trim() !== "" && shown.length === 0 && (
        <p className="font-minecraft text-sm text-white/50 tracking-wide text-center">{t("profiles.picker.no_match")}</p>
      )}
    </div>
  );
}
