"use client";

import { useEffect, useState } from "react";
import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";

import { Modal } from "../../ui/Modal";
import { Button } from "../../ui/buttons/Button";
import { SearchStyleInput } from "../../ui/Input";
import { Checkbox } from "../../ui/Checkbox";
import { GroupPicker } from "../../ui/GroupPicker";
import { ImportPreviewChips } from "../import/ImportPreviewChips";
import { ImportSecurityPanel, ImportTrustWarning } from "../import/ImportSecurityPanel";
import { ImportRemovedList } from "../import/ImportRemovedList";
import { CopyContentsPicker } from "../import/CopyContentsPicker";
import * as LauncherImportService from "../../../services/launcher-import-service";
import { useKnownProfileGroups } from "../../../hooks/useKnownProfileGroups";
import { formatRelativeTime } from "../../../utils/format-relative-time";
import { parseErrorMessage } from "../../../utils/error-utils";
import { logError } from "../../../utils/logging-utils";
import {
  DEFAULT_IMPORT_SELECTION,
  selectionFromBuckets,
  type ExternalInstancePreview,
  type ExternalInstanceRef,
  type ImportSelection,
} from "../../../types/launcherImport";
import type { LauncherImportOverrides } from "../../../utils/launcher-instance-import";

interface ProfileWizardV2ReviewStepProps {
  target: ExternalInstanceRef;
  onClose: () => void;
  onBack: () => void;
  onImport: (overrides: LauncherImportOverrides) => void;
  busy?: boolean;
}

function describeWarning(
  warning: string,
  t: (key: string, options?: Record<string, unknown>) => string,
): string {
  const [code, ...rest] = warning.split(":");
  const detail = rest.join(":");

  switch (code) {
    case "unknown_loader":
      return t("profiles.launcherImport.confirm.warning_unknown_loader", { loader: detail });
    case "skipped_symlink":
      return t("profiles.launcherImport.confirm.warning_skipped_symlink", { path: detail });
    case "copy_plan_truncated":
      return t("profiles.launcherImport.confirm.warning_copy_plan_truncated");
    default:
      return warning;
  }
}

export function ProfileWizardV2ReviewStep({
  target,
  onClose,
  onBack,
  onImport,
  busy = false,
}: ProfileWizardV2ReviewStepProps) {
  const { t } = useTranslation();
  const [preview, setPreview] = useState<ExternalInstancePreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState(target.name);
  const [group, setGroup] = useState("");
  const [useNoriskPack, setUseNoriskPack] = useState(false);
  const [selection, setSelection] = useState<ImportSelection>(DEFAULT_IMPORT_SELECTION);

  useEffect(() => {
    let cancelled = false;
    setPreview(null);
    setError(null);

    LauncherImportService.previewExternalInstance(
      target.launcher,
      target.root,
      target.instanceDir,
      { resolveMods: true },
    )
      .then((loaded) => {
        if (cancelled) return;
        setPreview(loaded);
        setName(loaded.suggestedName);
        setGroup(loaded.suggestedGroup ?? "");
        setSelection(selectionFromBuckets(loaded.buckets));
      })
      .catch((err) => {
        if (cancelled) return;
        const message = parseErrorMessage(err);
        logError(`[LauncherImport] Preview of '${target.instanceDir}' failed: ${message}`);
        setError(message);
      });

    return () => {
      cancelled = true;
    };
  }, [target.launcher, target.root, target.instanceDir]);

  const knownGroups = useKnownProfileGroups([preview?.suggestedGroup]);
  const trimmedName = name.trim();

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
        onClick={() =>
          onImport({
            name: trimmedName,
            group: group.trim(),
            selection,
            clearNoriskPack: !useNoriskPack,
          })
        }
        disabled={busy || !preview || !trimmedName}
        size="md"
        className="min-w-[180px] text-sm"
        icon={<Icon icon="solar:download-bold" className="w-5 h-5" />}
        iconPosition="left"
      >
        {t("profiles.import.confirm")}
      </Button>
    </div>
  );

  return (
    <Modal
      title={t("profiles.launcherImport.confirm.title")}
      titleSubtitle={
        preview ? (
          <ImportPreviewChips
            leadLabel={preview.launcherDisplayName}
            gameVersion={preview.gameVersion}
            loader={preview.loader}
            modCount={preview.modCount}
            sizeBytes={preview.totalBytes}
          />
        ) : undefined
      }
      onClose={onClose}
      width="lg"
      footer={renderFooter()}
    >
      <div className="min-h-[500px] max-h-[65vh] overflow-y-auto custom-scrollbar p-6 space-y-5">
        {error && (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/[0.07] px-4 py-3 font-minecraft text-xs text-amber-300/80">
            {t("profiles.launcherImport.confirm.preview_failed", { error })}
          </div>
        )}

        {!preview && !error && (
          <div className="flex items-center gap-3 text-white/70 font-minecraft tracking-wide">
            <Icon icon="svg-spinners:ring-resize" className="w-5 h-5" />
            <span>{t("profiles.launcherImport.confirm.reading")}</span>
          </div>
        )}

        {preview && (
          <>
            <div className="space-y-4">
              <div className="flex flex-col">
                <label className="block text-lg font-smallcaps text-white mb-2">
                  {t("profiles.import.field_name")}
                </label>
                <SearchStyleInput
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={t("profiles.import.field_name_placeholder")}
                  className="text-sm w-full"
                />
              </div>

              <div className="flex flex-col">
                <label className="block text-lg font-smallcaps text-white mb-2">
                  {t("profiles.import.field_group")}
                </label>
                <GroupPicker value={group} onChange={setGroup} options={knownGroups} />
              </div>
            </div>

            <CopyContentsPicker
              buckets={preview.buckets}
              selection={selection}
              onChange={setSelection}
            />

            <Checkbox
              label={t("profiles.import.norisk_toggle_title")}
              checked={useNoriskPack}
              onChange={(event) => setUseNoriskPack(event.target.checked)}
              size="lg"
            />

            {(preview.warnings.length > 0 || preview.alreadyImportedAt) && (
              <div className="space-y-1.5 rounded-lg border border-amber-500/30 bg-amber-500/[0.07] px-4 py-3">
                {preview.alreadyImportedAt && (
                  <div className="font-minecraft text-xs text-amber-300/80">
                    {t("profiles.launcherImport.confirm.already_imported", {
                      time: formatRelativeTime(preview.alreadyImportedAt),
                    })}
                  </div>
                )}
                {preview.warnings.map((warning, index) => (
                  <div
                    key={`${warning}-${index}`}
                    className="font-minecraft text-xs text-white/55 break-all"
                  >
                    {describeWarning(warning, t)}
                  </div>
                ))}
              </div>
            )}

            <ImportTrustWarning />

            <ImportSecurityPanel
              security={preview.security}
              provenance={preview.provenance}
              executableContent={preview.executableContent}
            />

            <ImportRemovedList security={preview.security} />
          </>
        )}
      </div>
    </Modal>
  );
}
