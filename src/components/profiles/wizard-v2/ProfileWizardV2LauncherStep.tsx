"use client";

import { useEffect, useMemo, useState } from "react";
import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";
import { toast } from "react-hot-toast";
import { open as openDialog } from "@tauri-apps/plugin-dialog";

import { Modal } from "../../ui/Modal";
import { Button } from "../../ui/buttons/Button";
import { SearchWithFilters } from "../../ui/SearchWithFilters";
import { EmptyStateV3 } from "../v3/shared/EmptyStateV3";
import { LauncherGroupSection } from "../../launcher-import/LauncherGroupSection";
import { useLauncherImportStore } from "../../../store/launcher-import-store";
import { parseErrorMessage } from "../../../utils/error-utils";
import {
  isSelectable,
  launcherKey,
  type ExternalInstanceRef,
} from "../../../types/launcherImport";

interface ProfileWizardV2LauncherStepProps {
  onClose: () => void;
  onBack: () => void;
  onImport: (instances: ExternalInstanceRef[]) => void;
  onOpenProfile: (profileId: string) => void;
  busy?: boolean;
}

function matches(instance: ExternalInstanceRef, query: string): boolean {
  if (!query) return true;
  return (
    instance.name.toLowerCase().includes(query) ||
    (instance.gameVersion ?? "").toLowerCase().includes(query)
  );
}

function TextAction({
  label,
  onClick,
  disabled,
  hidden,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  hidden?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`px-2 py-1 font-minecraft text-[10px] uppercase tracking-wider text-white/45 transition-colors hover:text-white disabled:opacity-25 ${
        hidden ? "invisible" : ""
      }`}
    >
      {label}
    </button>
  );
}

export function ProfileWizardV2LauncherStep({
  onClose,
  onBack,
  onImport,
  onOpenProfile,
  busy = false,
}: ProfileWizardV2LauncherStepProps) {
  const { t } = useTranslation();
  const store = useLauncherImportStore();
  const [expandedBeforeSearch, setExpandedBeforeSearch] = useState<Record<string, boolean> | null>(
    null,
  );

  useEffect(() => {
    if (store.phase === "idle") void store.scan();
  }, [store.phase, store.scan]);

  const query = store.search.trim().toLowerCase();

  const visibleByLauncher = useMemo(
    () =>
      Object.fromEntries(
        store.launchers.map((launcher) => {
          const key = launcherKey(launcher);
          return [key, (store.instances[key] ?? []).filter((instance) => matches(instance, query))];
        }),
      ) as Record<string, ExternalInstanceRef[]>,
    [store.launchers, store.instances, query],
  );

  useEffect(() => {
    if (query) {
      setExpandedBeforeSearch((saved) => saved ?? { ...store.collapsed });
      for (const launcher of store.launchers) {
        const key = launcherKey(launcher);
        if (store.collapsed[key] && (visibleByLauncher[key]?.length ?? 0) > 0) {
          void store.toggleCollapsed(key);
        }
      }
    } else if (expandedBeforeSearch) {
      for (const [key, collapsed] of Object.entries(expandedBeforeSearch)) {
        if (store.collapsed[key] !== collapsed) void store.toggleCollapsed(key);
      }
      setExpandedBeforeSearch(null);
    }
  }, [query]);

  const visibleLaunchers = query
    ? store.launchers.filter((launcher) => (visibleByLauncher[launcherKey(launcher)]?.length ?? 0) > 0)
    : store.launchers;

  const selectedInstances = useMemo(() => {
    const all = Object.values(store.instances).flat();
    return store.selected
      .map((dir) => all.find((instance) => instance.instanceDir === dir))
      .filter((instance): instance is ExternalInstanceRef =>
        Boolean(instance && isSelectable(instance, store.importedThisSession)),
      );
  }, [store.instances, store.selected, store.importedThisSession]);

  const addFolder = async () => {
    const picked = await openDialog({
      directory: true,
      multiple: false,
      title: t("profiles.launcherImport.manual.dialog_title"),
    });
    if (typeof picked !== "string") return;

    try {
      const found = await store.addManualFolder(picked);
      toast[found ? "success" : "error"](
        found
          ? t("profiles.launcherImport.manual.added", { launcher: found.displayName })
          : t("profiles.launcherImport.manual.not_recognized"),
      );
    } catch (err) {
      toast.error(t("profiles.launcherImport.manual.failed", { error: parseErrorMessage(err) }));
    }
  };

  const scanning = store.phase === "loading";
  const count = selectedInstances.length;

  const renderFooter = () => (
    <div className="flex justify-between items-center">
      <Button
        variant="secondary"
        onClick={onBack}
        disabled={busy}
        size="md"
        className="text-sm"
        icon={<Icon icon="solar:arrow-left-bold" className="w-5 h-5" />}
        iconPosition="left"
      >
        {t("profiles.wizard.back")}
      </Button>

      <Button
        variant="default"
        onClick={() => onImport(selectedInstances)}
        disabled={busy || count === 0}
        size="md"
        className="min-w-[180px] text-sm"
        icon={<Icon icon="solar:download-bold" className="w-5 h-5" />}
        iconPosition="left"
      >
        {count > 0
          ? t("profiles.launcherImport.import_selected", { count })
          : t("profiles.import.confirm")}
      </Button>
    </div>
  );

  return (
    <Modal
      title={t("profiles.launcherImport.title")}
      onClose={onClose}
      width="lg"
      footer={renderFooter()}
    >
      <div className="min-h-[500px] max-h-[65vh] overflow-y-auto custom-scrollbar p-6 select-none">
        <div className="mb-3 flex items-start justify-between gap-3">
          <span className="min-w-0 flex-1 font-minecraft text-xs leading-relaxed text-white/40">
            {t("profiles.launcherImport.privacy_note")}
          </span>
          <div className="flex flex-shrink-0 items-center">
            <TextAction
              label={t("profiles.launcherImport.clear_all")}
              onClick={store.clearSelection}
              hidden={count === 0}
            />
            <TextAction
              label={t("profiles.launcherImport.rescan")}
              onClick={() => void store.scan()}
              disabled={scanning}
            />
          </div>
        </div>

        {scanning && (
          <div className="flex items-center justify-center gap-2 py-10 font-minecraft text-xs text-white/45">
            <Icon icon="svg-spinners:ring-resize" className="h-3.5 w-3.5" />
            {t("profiles.launcherImport.scanning")}
          </div>
        )}

        {store.phase === "error" && (
          <div className="mb-3 rounded-lg border border-amber-500/30 bg-amber-500/[0.07] px-4 py-3 font-minecraft text-xs text-amber-300/80">
            {t("profiles.launcherImport.scan_failed", { error: store.error ?? "" })}
          </div>
        )}

        {!scanning && store.launchers.length > 0 && (
          <div className="mb-3">
            <SearchWithFilters
              compact
              showSort={false}
              showFilter={false}
              searchValue={store.search}
              onSearchChange={store.setSearch}
              placeholder={t("profiles.launcherImport.search_placeholder")}
            />
          </div>
        )}

        {store.phase === "ready" && store.launchers.length === 0 && (
          <EmptyStateV3
            icon="solar:folder-with-files-bold"
            title={t("profiles.launcherImport.empty.title")}
            hint={t("profiles.launcherImport.empty.description")}
          />
        )}

        <div className="space-y-2">
          {visibleLaunchers.map((launcher) => {
            const key = launcherKey(launcher);
            return (
              <LauncherGroupSection
                key={key}
                launcher={launcher}
                instances={store.instances[key] ?? []}
                visibleInstances={visibleByLauncher[key] ?? []}
                collapsed={store.collapsed[key] ?? false}
                phase={store.instancePhase[key] ?? "idle"}
                error={store.instanceError[key] ?? null}
                selected={store.selected}
                importedThisSession={store.importedThisSession}
                onToggleCollapsed={() => void store.toggleCollapsed(key)}
                onToggleLauncher={() => void store.toggleLauncher(key)}
                onToggleInstance={store.toggleInstance}
                onOpenProfile={onOpenProfile}
                onRemove={launcher.autoDetected ? undefined : () => store.removeManualLauncher(key)}
                onRetry={() => void store.loadInstances(key)}
              />
            );
          })}
        </div>

        {!scanning && (
          <button
            onClick={() => void addFolder()}
            className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-white/15 px-4 py-2.5 font-minecraft text-xs text-white/45 transition-colors hover:border-white/30 hover:text-white"
          >
            <Icon icon="solar:folder-with-files-bold" className="h-4 w-4" />
            {t("profiles.launcherImport.manual.add")}
          </button>
        )}
      </div>
    </Modal>
  );
}
