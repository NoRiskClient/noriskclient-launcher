"use client";

import { useMemo, useState } from "react";
import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";
import { Button } from "../ui/buttons/Button";
import { SearchWithFilters } from "../ui/SearchWithFilters";
import { ProfileIconV2 } from "../profiles/ProfileIconV2";
import { useThemeStore } from "../../store/useThemeStore";
import { cn } from "../../lib/utils";
import { BackButton, SupportFrame, type StepFlow } from "./parts";
import { RECENT_PROFILES, type SupportProfiles } from "./useSupportProfiles";

export function ProfileStep({
  flow,
  profiles,
  locked,
}: {
  flow: StepFlow;
  profiles: SupportProfiles;
  locked: boolean;
}) {
  const { t } = useTranslation();
  const accent = useThemeStore((s) => s.accentColor.value);
  const [showAll, setShowAll] = useState(false);
  const [query, setQuery] = useState("");
  const { sorted, profile, profileId, setProfileId, lastPlayedProfileId } = profiles;

  const shown = useMemo(() => {
    if (showAll) {
      const q = query.trim().toLowerCase();
      if (!q) return sorted;
      return sorted.filter((p) => p.name.toLowerCase().includes(q) || p.game_version.toLowerCase().includes(q));
    }
    const recent = sorted.slice(0, RECENT_PROFILES);
    if (!profile || recent.includes(profile)) return recent;
    return [...recent.slice(0, RECENT_PROFILES - 1), profile];
  }, [showAll, query, sorted, profile]);

  return (
    <SupportFrame
      onClose={flow.close}
      stepper={flow.stepper}
      left={<BackButton onClick={flow.back} />}
      right={
        <Button variant="default" size="lg" onClick={flow.next} disabled={!profileId}>
          {t("support_request.next")}
        </Button>
      }
    >
      <div className="space-y-3">
        <p className="font-minecraft text-xl text-white tracking-wide">{t("support_request.profile.question")}</p>
        {showAll && (
          <SearchWithFilters
            placeholder={t("support_request.profile.search")}
            searchValue={query}
            onSearchChange={setQuery}
            showSort={false}
            showFilter={false}
            compact
          />
        )}
        <div
          className={cn(
            "grid grid-cols-2 gap-2 overflow-y-auto custom-scrollbar pr-1",
            showAll ? "max-h-[240px]" : "max-h-[300px]",
          )}
        >
          {shown.map((p) => {
            const active = p.id === profileId;
            return (
              <button
                key={p.id}
                type="button"
                disabled={locked}
                onClick={() => setProfileId(p.id)}
                className={cn(
                  "flex items-center gap-3 rounded-lg border-2 p-2 text-left transition-colors disabled:cursor-not-allowed",
                  active ? "bg-white/10" : "border-white/10 bg-black/20 hover:bg-white/5",
                  locked && !active && "opacity-40",
                )}
                style={active ? { borderColor: accent } : undefined}
              >
                <ProfileIconV2 profile={p} size="sm" />
                <div className="min-w-0 flex-1">
                  <div className="font-minecraft text-base text-white tracking-wide truncate">{p.name}</div>
                  <div className="font-minecraft text-sm text-white/55 tracking-wide">
                    {t("support_request.profile.version", { version: p.game_version })}
                  </div>
                  {p.id === lastPlayedProfileId && (
                    <span className="inline-block mt-0.5 rounded px-1.5 text-xs font-minecraft tracking-wide bg-green-500/20 text-green-300 border border-green-500/40">
                      {t("support_request.profile.last_played")}
                    </span>
                  )}
                </div>
                {active && <Icon icon="solar:check-circle-bold" className="w-6 h-6 shrink-0 text-green-400" />}
              </button>
            );
          })}
        </div>
        {showAll && shown.length === 0 && (
          <p className="font-minecraft text-sm text-white/50 tracking-wide text-center">
            {t("support_request.profile.no_match")}
          </p>
        )}
        {!locked && sorted.length > RECENT_PROFILES && (
          <div className="flex justify-center">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setShowAll((all) => !all);
                setQuery("");
              }}
            >
              {showAll
                ? t("support_request.profile.show_recent")
                : t("support_request.profile.show_all", { count: sorted.length })}
            </Button>
          </div>
        )}
        {locked && (
          <p className="font-minecraft text-sm text-white/50 tracking-wide">{t("support_request.profile.locked")}</p>
        )}
      </div>
    </SupportFrame>
  );
}
