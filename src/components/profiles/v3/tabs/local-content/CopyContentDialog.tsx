"use client";

import { useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { Icon } from "@iconify/react";
import { Modal } from "../../../../ui/Modal";
import { Button } from "../../../../ui/buttons/Button";
import { SearchWithFilters } from "../../../../ui/SearchWithFilters";
import { ProfileIconV2 } from "../../../ProfileIconV2";
import { useThemeStore } from "../../../../../store/useThemeStore";
import { useProfileStore } from "../../../../../store/profile-store";
import { loaderIconSrc } from "../../../../../lib/loader-icons";
import { compareByRecentActivity } from "../../../../../utils/profile-sort";
import { copyContentsToProfile } from "../../../../../services/content-service";
import type { Profile } from "../../../../../types/profile";
import type { ContentType } from "../../../../../types/content";
import type { LocalContentType } from "../../../../../hooks/useLocalContentManager";
import { navKeyOf } from "../../ProfileLeftRailV3";
import {
  CopyResultList,
  ItemIcon,
  type CopyContentEntry,
  type TargetOutcome,
} from "./CopyResultList";

interface CopyContentDialogProps {
  sourceProfile: Profile;
  contentType: LocalContentType;
  typeNamePlural: string;
  items: CopyContentEntry[];
  onClose: () => void;
  onCopied: () => void;
}

const SEARCH_THRESHOLD = 6;
const MAX_CHIPS = 10;

export function CopyContentDialog({
  sourceProfile,
  contentType,
  typeNamePlural,
  items,
  onClose,
  onCopied,
}: CopyContentDialogProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const accent = useThemeStore((s) => s.accentColor.value);
  const profiles = useProfileStore((s) => s.profiles);
  const [targetIds, setTargetIds] = useState<Set<string>>(() => new Set());
  const [query, setQuery] = useState("");
  const [isCopying, setIsCopying] = useState(false);
  const copyStarted = useRef(false);
  const [outcomes, setOutcomes] = useState<TargetOutcome[] | null>(null);

  const targets = useMemo(
    () =>
      profiles
        .filter((p) => p.id !== sourceProfile.id && !p.is_standard_version)
        .sort(compareByRecentActivity),
    [profiles, sourceProfile.id],
  );
  const visibleTargets = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return targets;
    return targets.filter((p) =>
      [p.name, p.game_version, p.loader].some((v) => v?.toLowerCase().includes(q)),
    );
  }, [targets, query]);

  const chosen = targets.filter((p) => targetIds.has(p.id));
  const resolvesVersions =
    contentType === "Mod" &&
    chosen.some((p) => p.game_version !== sourceProfile.game_version || p.loader !== sourceProfile.loader);

  const toggleTarget = (id: string) =>
    setTargetIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });

  const copy = async () => {
    if (copyStarted.current) return;
    copyStarted.current = true;
    setIsCopying(true);
    const request = items.map(({ id, path, name }) => ({ id, path, name }));
    const done: TargetOutcome[] = [];
    for (const profile of chosen) {
      try {
        const result = await copyContentsToProfile({
          source_profile_id: sourceProfile.id,
          target_profile_id: profile.id,
          content_type: contentType as ContentType,
          items: request,
        });
        done.push({ profile, result });
      } catch (err) {
        console.error("[V3] Failed to copy content:", err);
        done.push({ profile, result: null });
      }
    }
    setIsCopying(false);
    setOutcomes(done);
  };

  const confirmLabel = isCopying
    ? t("profiles.v3.copy.copying")
    : chosen.length === 0
      ? t("profiles.v3.copy.placeholder")
      : chosen.length === 1
        ? t("profiles.v3.copy.buttonTo", { profile: chosen[0].name })
        : t("profiles.v3.copy.buttonToMany", { count: chosen.length });

  const shownItems = items.slice(0, MAX_CHIPS);
  const hiddenCount = items.length - shownItems.length;

  const openProfile = (profile: Profile) => {
    onCopied();
    navigate(`/profiles/${profile.id}`, { state: { nav: navKeyOf(contentType) } });
  };

  const single = outcomes?.length === 1 && outcomes[0].result ? outcomes[0] : undefined;

  const footer = outcomes ? (
    <div className="flex justify-end items-center gap-3">
      {single ? (
        <>
          <Button variant="secondary" onClick={onCopied}>
            {t("common.close")}
          </Button>
          <Button variant="success" onClick={() => openProfile(single.profile)}>
            {t("profiles.v3.copy.open", { profile: single.profile.name })}
          </Button>
        </>
      ) : (
        <Button variant="success" onClick={onCopied}>
          {t("profiles.v3.copy.done")}
        </Button>
      )}
    </div>
  ) : (
    <div className="flex justify-end items-center gap-3">
      <Button variant="secondary" onClick={onClose} disabled={isCopying}>
        {t("common.cancel")}
      </Button>
      <Button
        variant="success"
        onClick={copy}
        disabled={isCopying || chosen.length === 0}
        icon={isCopying ? <Icon icon="svg-spinners:ring-resize" className="h-4 w-4" /> : null}
      >
        {confirmLabel}
      </Button>
    </div>
  );

  const selection = (
    <div className="px-6 pt-5 flex flex-col gap-4 min-h-0 flex-1">
      <section className="flex flex-col gap-2 flex-shrink-0">
        <h4 className="text-sm text-white/60 font-minecraft normal-case">{t("profiles.v3.copy.what")}</h4>
        <div className="flex flex-wrap gap-1.5">
          {shownItems.map((item) => (
            <div
              key={item.path}
              className={`flex items-center gap-1.5 max-w-[12rem] rounded-md bg-black/20 border border-white/10 pl-1 pr-2 py-1 ${item.disabled ? "opacity-55" : ""}`}
            >
              <ItemIcon iconUrl={item.iconUrl} size="sm" />
              <span
                className={`text-xs text-white font-minecraft normal-case truncate ${item.disabled ? "line-through" : ""}`}
                style={item.disabled ? { textDecorationColor: accent, textDecorationThickness: "2px" } : undefined}
                title={item.name}
              >
                {item.name}
              </span>
            </div>
          ))}
          {hiddenCount > 0 && (
            <div
              className="flex items-center rounded-md bg-black/20 border border-white/10 px-2 py-1 text-xs text-white/60 font-minecraft normal-case"
              title={items.slice(MAX_CHIPS).map((i) => i.name).join(", ")}
            >
              +{hiddenCount}
            </div>
          )}
        </div>
      </section>

      <section className="flex flex-col gap-2 min-h-0 flex-1">
        <h4 className="text-sm text-white/60 font-minecraft normal-case flex-shrink-0">{t("profiles.v3.copy.target")}</h4>
        {targets.length === 0 ? (
          <div className="flex-1 text-sm text-white/60 font-minecraft normal-case">{t("profiles.v3.copy.noProfiles")}</div>
        ) : (
          <>
            {targets.length > SEARCH_THRESHOLD && (
              <SearchWithFilters
                searchValue={query}
                onSearchChange={setQuery}
                placeholder={t("profiles.v3.copy.search")}
                showSort={false}
                showFilter={false}
                compact
                className="flex-shrink-0"
              />
            )}
            <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar grid grid-cols-2 auto-rows-min content-start gap-2 pr-1">
              {visibleTargets.map((p) => {
                const selected = targetIds.has(p.id);
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => toggleTarget(p.id)}
                    disabled={isCopying}
                    style={selected ? { backgroundColor: `${accent}1a`, borderColor: `${accent}99` } : undefined}
                    className={`flex items-center gap-3 p-2 rounded-lg border text-left transition-colors ${
                      selected ? "" : "bg-black/20 border-white/10 hover:border-white/25 hover:bg-black/30"
                    }`}
                  >
                    <ProfileIconV2 profile={p} size="sm" />
                    <div className="min-w-0 flex-1">
                      <div className="text-sm text-white font-minecraft normal-case truncate">{p.name}</div>
                      <div className="flex items-center gap-1.5 text-xs text-white/50 font-minecraft normal-case">
                        <img src={loaderIconSrc(p.loader)} alt="" className="w-3.5 h-3.5" />
                        <span className="truncate">{p.game_version} · {p.loader}</span>
                      </div>
                    </div>
                    {selected && <Icon icon="solar:check-circle-bold" className="w-5 h-5 flex-shrink-0" style={{ color: accent }} />}
                  </button>
                );
              })}
            </div>
          </>
        )}
        <div className="flex items-start gap-2 min-h-[2.5rem] text-xs text-white/60 font-minecraft normal-case flex-shrink-0">
          <Icon icon="solar:info-circle-bold" className="w-4 h-4 flex-shrink-0 mt-px" />
          <span>{t(resolvesVersions ? "profiles.v3.copy.resolveHint" : "profiles.v3.copy.pickHint")}</span>
        </div>
      </section>
    </div>
  );

  return (
    <Modal
      title={t("profiles.v3.copy.title", { type: typeNamePlural })}
      titleIcon={<Icon icon="solar:copy-bold-duotone" className="w-6 h-6" />}
      titleSubtitle={t("profiles.v3.copy.subtitle", { count: items.length, profile: sourceProfile.name })}
      onClose={outcomes ? onCopied : onClose}
      width="lg"
      contentClassName="h-[30rem] flex flex-col overflow-hidden"
      footer={footer}
    >
      {outcomes ? (
        <div className="px-6 pt-5 flex-1 overflow-y-auto custom-scrollbar">
          <CopyResultList
            outcomes={outcomes}
            items={items}
            onOpen={outcomes.length > 1 ? openProfile : undefined}
          />
        </div>
      ) : (
        selection
      )}
    </Modal>
  );
}
