"use client";

/**
 * BrowseContentSideSheetV3 — "Add content" as a docked right-side panel.
 *
 * Deliberately NOT styled like the shared `Modal`: a sheet is a docked
 * surface that extends the parent view, not a floating card demanding
 * focus. So the header uses the V3 profile-detail top-bar vocabulary
 * (h-11 toolbar, font-minecraft-ten uppercase breadcrumb, thin accent
 * indicator on the docked edge) and the backdrop is lighter, signalling
 * "non-blocking side task" instead of "stop everything".
 *
 * Mod detail is pushed onto a stacked layer inside the sheet (see the
 * `detail` state + `onProjectClick` path below) rather than routing
 * away, so the user never loses the current search or scroll position.
 */

import { useEffect, useState, useCallback } from "react";
import { createPortal } from "react-dom";
import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";

import type { Profile } from "../../../types/profile";
import type { LocalContentType } from "../../../hooks/useLocalContentManager";
import type { ModrinthProjectType } from "../../../types/modrinth";
import { ModrinthSearchV2 } from "../../modrinth/v2/ModrinthSearchV2";
import { ModDetailPage } from "../../mods/ModDetailPage";
import { useThemeStore } from "../../../store/useThemeStore";
import { useModSearchStoreSnapshot } from "./useModSearchStoreSnapshot";

export interface BrowseContentSideSheetV3Props {
  open: boolean;
  profile: Profile;
  contentType: LocalContentType;
  onClose: () => void;
  onInstallSuccess?: () => void;
}

const CONTENT_TO_PROJECT: Partial<Record<LocalContentType, ModrinthProjectType>> = {
  Mod: "mod",
  ResourcePack: "resourcepack",
  ShaderPack: "shader",
  DataPack: "datapack",
};

export function BrowseContentSideSheetV3({
  open,
  profile,
  contentType,
  onClose,
  onInstallSuccess,
}: BrowseContentSideSheetV3Props) {
  const { t } = useTranslation();
  const accentColor = useThemeStore((s) => s.accentColor);
  const accent = accentColor.value;
  // `accent.dark` is a 20%-darkened variant (see `calculateColorVariants`
  // in useThemeStore). Fallback to `value` so a legacy persisted theme
  // without that field doesn't turn the whole `background` property into
  // invalid CSS (which silently wipes every layer).
  const accentDark = accentColor.dark ?? accent;
  const projectType = CONTENT_TO_PROJECT[contentType] ?? "mod";

  // In-sheet mod detail stack — clicking a project tile pushes its id onto
  // this piece of state instead of navigating, so the sheet stays mounted
  // and the user returns to the same search with one click. Reset whenever
  // the sheet re-opens so a fresh open never lands inside a detail view
  // from a prior session.
  const [detail, setDetail] = useState<{ source: "modrinth" | "curseforge"; projectId: string } | null>(null);
  useEffect(() => { if (!open) setDetail(null); }, [open]);
  const handleProjectClick = useCallback(
    (project: any, source: "modrinth" | "curseforge") => {
      setDetail({ source, projectId: project.project_id });
    },
    [],
  );

  // Isolate the profile-scoped filters from the standalone /mods tab —
  // otherwise the game_version / loader auto-applied inside the sheet bleed
  // into the next time the user visits the standalone search.
  useModSearchStoreSnapshot(open);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // Stack-aware: ESC pops the detail layer first if it's open, so the
      // user doesn't accidentally blow away the whole sheet from a nested
      // view. A second ESC then closes the sheet itself.
      if (detail) {
        setDetail(null);
        return;
      }
      onClose();
    };
    window.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, onClose, detail]);

  if (!open) return null;

  const title =
    contentType === "Mod"          ? t("profiles.content.addMods") :
    contentType === "ResourcePack" ? t("profiles.content.addResourcePacks") :
    contentType === "ShaderPack"   ? t("profiles.content.addShaderPacks") :
    contentType === "DataPack"     ? t("profiles.content.addDataPacks") :
    t("profiles.content.addMods");

  return createPortal(
    <>
      {/* Backdrop — lighter than the Modal spec so the sheet reads as
          "docked side task", not "blocking dialog". Blurred so focus lands
          on the sheet while the profile view behind stays readable. */}
      <div
        onClick={onClose}
        aria-hidden="true"
        className="fixed inset-0 bg-black/40 backdrop-blur-sm z-[1000] animate-in fade-in duration-150"
      />

      {/* Sheet: docked to the right edge. Frosted-glass treatment — lower
          opacity + heavy blur + saturation boost so the app's gradient and
          particle layers shine through instead of being walled off. A subtle
          left-to-right gradient gives the surface depth (slightly lighter on
          the docked edge where the accent stripe sits). */}
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="fixed right-0 top-0 h-full w-[82vw] min-w-[640px] max-w-[1300px] z-[1001] flex flex-col shadow-[0_0_64px_-8px_rgba(0,0,0,0.7)] animate-in slide-in-from-right duration-200 overflow-hidden"
        style={{
          // Light see-through base — a soft dark veil (~0.42 alpha) takes
          // the edge off what's behind without hiding it, with accent
          // ellipses layered on top for the themed tint. No blur, so the
          // profile view stays recognizable through the sheet.
          // "Soft Gradients 2.0" per 2026 UI consensus, now with real
          // backdrop-blur. All background layers now carry alpha (incl. the
          // base) so the backdrop-filter actually has content peeking
          // through to blur — a fully opaque bottom layer would swallow
          // the blur entirely. The base alpha is dropped enough to feel
          // glassy but not so much that text legibility suffers.
          background: `
            radial-gradient(ellipse 85% 65% at 12% 15%, ${accent}24 0%,     transparent 60%),
            radial-gradient(ellipse 75% 60% at 88% 85%, ${accentDark}1e 0%, transparent 60%),
            linear-gradient(135deg, rgba(14,14,22,0.72) 0%, rgba(10,10,18,0.72) 100%)
          `,
          backdropFilter: "blur(22px) saturate(140%)",
          WebkitBackdropFilter: "blur(22px) saturate(140%)",
        }}
      >
        {/* Subtle white highlight inside the docked edge — the "glass catches
            light" moment that keeps the panel from looking flat against the
            viewport edge. */}
        <div
          aria-hidden="true"
          className="absolute left-0 top-0 bottom-0 w-px bg-gradient-to-b from-transparent via-white/20 to-transparent pointer-events-none"
        />

        {/* Accent stripe on the docked edge — thin, luminous, signals which
            surface the sheet belongs to without screaming for attention. */}
        <div
          aria-hidden="true"
          className="absolute left-0 top-0 bottom-0 w-[2px] pointer-events-none"
          style={{
            background: `linear-gradient(to bottom, transparent, ${accent}cc, ${accent}, ${accent}cc, transparent)`,
            boxShadow: `0 0 18px ${accent}80`,
          }}
        />

        {/* Header uses the V3 detail-view top-bar spec (h-11, px-5, border-
            white/5, font-minecraft-ten uppercase tracking-wider) so the sheet
            reads as an extension of the detail view's chrome rather than a
            foreign dialog with its own type scale.
            When a mod detail is stacked on top, the header morphs into a
            breadcrumb back-button so the user can pop just the detail layer
            without closing the whole sheet. */}
        <div className="flex items-center justify-between px-5 h-11 border-b border-white/5 flex-shrink-0 relative">
          <div className="flex items-center gap-2 min-w-0">
            {detail ? (
              <button
                onClick={() => setDetail(null)}
                className="flex items-center gap-2 text-white/70 hover:text-white transition-colors"
                title={t("common.back")}
              >
                <Icon icon="solar:arrow-left-linear" className="w-4 h-4" />
                <span className="text-xs font-minecraft-ten uppercase tracking-wider">
                  {title}
                </span>
              </button>
            ) : (
              <>
                <Icon
                  icon="solar:add-circle-bold"
                  className="w-4 h-4 flex-shrink-0"
                  style={{ color: accent }}
                />
                <span className="text-xs font-minecraft-ten uppercase tracking-wider text-white/90 truncate">
                  {title}
                </span>
              </>
            )}
            <span className="text-white/25">/</span>
            <span className="text-xs font-minecraft-ten text-white/55 normal-case truncate max-w-[280px]">
              {profile.name || profile.id}
            </span>
          </div>
          <div className="flex items-center gap-2 text-[10px] font-minecraft-ten uppercase tracking-wider text-white/30">
            <span className="hidden sm:inline-flex items-center gap-1">
              <kbd className="px-1.5 py-0.5 rounded bg-white/5 border border-white/10 text-white/50">esc</kbd>
              <span>{t("common.close")}</span>
            </span>
            <button
              onClick={onClose}
              className="p-2 rounded hover:bg-white/5 text-white/50 hover:text-white transition-colors"
              title={t("common.close")}
            >
              <Icon icon="solar:close-circle-linear" className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Body — padding matches BrowseTab so the filter sidebar + grid keep
            their usual breathing room; scrollbar stays clear of the edge.
            The search stays mounted even when the detail layer is stacked
            on top so the user's search state, scroll position, filters, and
            pagination all survive the detail round-trip intact. */}
        <div className="flex-1 min-h-0 overflow-hidden relative">
          {/* Base layer: search. `hidden` (display:none) when the detail is
              open — `visibility:hidden` was leaking because the filter
              sidebar's descendants opened their own stacking contexts and
              refused to inherit the hide. ModrinthSearchV2's filter/search
              state is persisted in the `useModSearchStore` zustand store,
              so the React component stays mounted and its data survives;
              only rendering is skipped. */}
          <div className={`absolute inset-0 p-4 ${detail ? "hidden" : ""}`}>
            <ModrinthSearchV2
              profiles={[profile]}
              selectedProfileId={profile.id}
              onProjectClick={handleProjectClick}
              initialProjectType={projectType}
              allowedProjectTypes={["mod", "resourcepack", "shader", "datapack"]}
              // Sidebar on by default — at 82vw the filter rail fits
              // without eating into the grid, and it's the first thing
              // users reach for when browsing Modrinth.
              initialSidebarVisible={true}
              overrideDisplayContext="detail"
              disableVirtualization={true}
              onInstallSuccess={onInstallSuccess}
              className="h-full"
            />
          </div>

          {/* Stacked layer: mod detail. Transparent wrapper — the sheet
              panel below already provides the glass surface + backdrop-
              blur, so re-applying them here stacks two blurs on top of
              each other and the result reads as opaque (the inner blur
              sees the outer's dark result and just blurs that again). By
              inheriting the sheet's glass the detail page shows through
              the same way the search does. */}
          {detail && (
            <div className="absolute inset-0 animate-in fade-in slide-in-from-right-4 duration-200">
              <ModDetailPage
                sourceOverride={detail.source}
                projectIdOverride={detail.projectId}
                onBack={() => setDetail(null)}
                hideBackButton
                targetProfile={profile}
              />
            </div>
          )}
        </div>
      </aside>
    </>,
    document.body,
  );
}
