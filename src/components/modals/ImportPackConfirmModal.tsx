"use client";

import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";

import { Modal } from "../ui/Modal";
import { Button } from "../ui/buttons/Button";
import { SearchStyleInput } from "../ui/Input";
import { Checkbox } from "../ui/Checkbox";
import { useImportConfirmStore } from "../../store/import-confirm-store";
import { useProfileStore } from "../../store/profile-store";
import { useThemeStore } from "../../store/useThemeStore";
import { runPackImport } from "../../utils/pack-import";
import type { ImportPackPreview } from "../../types/importPreview";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unitIndex]}`;
}

function truncate(value: string, max = 90): string {
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

export function ImportPackConfirmModal() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const accentColor = useThemeStore((state) => state.accentColor);
  const { isOpen, isLoading, preview, filePath, close } = useImportConfirmStore();
  const profiles = useProfileStore((state) => state.profiles);
  const [isImporting, setIsImporting] = useState(false);
  const [name, setName] = useState("");
  const [group, setGroup] = useState("");
  const [useNoriskPack, setUseNoriskPack] = useState(false);

  useEffect(() => {
    if (!isOpen) {
      setName("");
      setGroup("");
      return;
    }
    if (preview) {
      setName(preview.profileName ?? "");
      setGroup(preview.group ?? "");
      setUseNoriskPack(preview.noriskPack.preselected);
    }
  }, [isOpen, preview]);

  const removed = useMemo(
    () => (preview ? buildRemovedList(preview, t) : []),
    [preview, t],
  );

  const knownGroups = useMemo(() => {
    const groups = new Set<string>();
    for (const profile of profiles) {
      if (profile.group) groups.add(profile.group);
    }
    if (preview?.group) groups.add(preview.group);
    return [...groups].sort((a, b) => a.localeCompare(b));
  }, [profiles, preview?.group]);

  if (!isOpen) return null;

  const trimmedName = name.trim();

  const handleConfirm = async () => {
    const target = preview?.filePath ?? filePath;
    if (!target || !trimmedName) return;

    setIsImporting(true);
    close();
    const newProfileId = await runPackImport(target, {
      name: trimmedName,
      group: group.trim(),
      noriskPackId: useNoriskPack ? preview?.noriskPack.packId : undefined,
      clearNoriskPack: !useNoriskPack,
    });
    setIsImporting(false);
    if (newProfileId) {
      navigate(`/profilesv2/${newProfileId}`);
    }
  };

  const renderFooter = () => (
    <div className="flex justify-end gap-3">
      <Button variant="secondary" onClick={close} size="md" disabled={isImporting}>
        {t("common.cancel")}
      </Button>
      <Button
        variant="default"
        onClick={handleConfirm}
        size="md"
        disabled={isLoading || isImporting || !trimmedName}
        icon={<Icon icon="solar:download-bold" className="w-5 h-5 text-white" />}
      >
        {t("profiles.import.confirm")}
      </Button>
    </div>
  );

  return (
    <Modal
      title={t("profiles.import.review_title")}
      titleSubtitle={
        preview ? (
          <span className="text-sm text-white/45 font-minecraft tracking-wide">
            {packSubtitle(preview, t)}
          </span>
        ) : undefined
      }
      onClose={close}
      width="lg"
      footer={renderFooter()}
    >
      <div className="p-6 space-y-5">
        {isLoading || !preview ? (
          <div className="flex items-center gap-3 text-white/70 font-minecraft tracking-wide">
            <Icon icon="svg-spinners:ring-resize" className="w-5 h-5" />
            <span>{t("profiles.import.reading_pack")}</span>
          </div>
        ) : (
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
                <GroupPicker
                  value={group}
                  onChange={setGroup}
                  options={knownGroups}
                  accentColor={accentColor.value}
                  t={t}
                />
              </div>
            </div>

            <Checkbox
              label={t("profiles.import.norisk_toggle_title")}
              checked={useNoriskPack}
              onChange={(event) => setUseNoriskPack(event.target.checked)}
              size="lg"
            />

            <div className="flex items-start gap-3 rounded-md border-2 border-yellow-500/40 bg-yellow-500/10 p-3">
              <Icon
                icon="solar:shield-warning-bold"
                className="w-5 h-5 text-yellow-400 shrink-0 mt-0.5"
              />
              <p className="text-base text-white/85 font-minecraft tracking-wide">
                {t("profiles.import.trust_warning")}
              </p>
            </div>

            {hasProvenanceFindings(preview) && (
              <UnknownContentNotice preview={preview} t={t} />
            )}

            {removed.length > 0 && (
              <div>
                <h3 className="text-base text-white font-smallcaps mb-2 select-none">
                  {t("profiles.import.removed_heading")}
                </h3>
                <ul className="space-y-1.5 max-h-52 overflow-y-auto custom-scrollbar pr-1">
                  {removed.map((entry, index) => (
                    <li
                      key={`${entry}-${index}`}
                      className="flex items-start gap-2 text-base text-white/70 font-minecraft tracking-wide"
                    >
                      <Icon
                        icon="solar:close-circle-bold"
                        className="w-4 h-4 text-red-400 shrink-0 mt-1"
                      />
                      <span>{entry}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}

function GroupPicker({
  value,
  onChange,
  options,
  accentColor,
  t,
}: {
  value: string;
  onChange: (next: string) => void;
  options: string[];
  accentColor: string;
  t: (key: string, options?: Record<string, unknown>) => string;
}) {
  const [isTyping, setIsTyping] = useState(false);
  const showInput = isTyping || (value !== "" && !options.includes(value));

  const chipStyle = (active: boolean) =>
    active
      ? {
          borderColor: accentColor,
          backgroundColor: `${accentColor}30`,
          color: "#fff",
        }
      : {
          borderColor: "rgba(255,255,255,0.12)",
          backgroundColor: "rgba(255,255,255,0.04)",
          color: "rgba(255,255,255,0.65)",
        };

  if (showInput) {
    return (
      <div className="flex items-center gap-2">
        <SearchStyleInput
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={t("placeholders.group_name")}
          className="text-sm w-full"
          autoFocus
        />
        <button
          type="button"
          onClick={() => {
            onChange("");
            setIsTyping(false);
          }}
          title={t("common.cancel")}
          className="shrink-0 p-2 rounded-lg border border-white/10 text-white/50 hover:text-white hover:border-white/25 transition-colors"
        >
          <Icon icon="solar:close-circle-linear" className="w-5 h-5" />
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap gap-2">
      <button
        type="button"
        onClick={() => onChange("")}
        className="px-3 py-1.5 rounded-lg border font-minecraft text-sm tracking-wide transition-colors"
        style={chipStyle(value === "")}
      >
        {t("profiles.import.group_none")}
      </button>

      {options.map((option) => (
        <button
          key={option}
          type="button"
          onClick={() => onChange(option)}
          className="px-3 py-1.5 rounded-lg border font-minecraft text-sm tracking-wide transition-colors"
          style={chipStyle(value === option)}
        >
          {option}
        </button>
      ))}

      <button
        type="button"
        onClick={() => {
          onChange("");
          setIsTyping(true);
        }}
        className="px-3 py-1.5 rounded-lg border border-dashed border-white/20 text-white/50 hover:text-white hover:border-white/40 font-minecraft text-sm tracking-wide transition-colors flex items-center gap-1.5"
      >
        <Icon icon="solar:add-circle-linear" className="w-4 h-4" />
        {t("profiles.import.group_new")}
      </button>
    </div>
  );
}

function hasProvenanceFindings(preview: ImportPackPreview): boolean {
  return (
    preview.provenance.unknown.length > 0 ||
    preview.security.thirdPartyDownloadHosts.length > 0 ||
    preview.executableContent.scripts.length > 0 ||
    preview.executableContent.natives.length > 0
  );
}

function FileList({ paths }: { paths: string[] }) {
  return (
    <ul className="mt-2 space-y-1 max-h-40 overflow-y-auto custom-scrollbar pr-1">
      {paths.map((path, index) => (
        <li
          key={`${path}-${index}`}
          className="text-sm text-white/70 font-minecraft tracking-wide break-all"
        >
          {truncate(path, 120)}
        </li>
      ))}
    </ul>
  );
}

function UnknownContentNotice({
  preview,
  t,
}: {
  preview: ImportPackPreview;
  t: (key: string, options?: Record<string, unknown>) => string;
}) {
  const { unknown, verifiedCount, incomplete } = preview.provenance;
  const hosts = preview.security.thirdPartyDownloadHosts;
  const { scripts, natives, scriptCount, nativeCount } = preview.executableContent;

  return (
    <div className="rounded-md border-2 border-orange-500/40 bg-orange-500/10 p-3 space-y-4">
      {natives.length > 0 && (
        <div className="flex items-start gap-3">
          <Icon
            icon="solar:danger-triangle-bold"
            className="w-5 h-5 text-orange-300 shrink-0 mt-0.5"
          />
          <div className="min-w-0">
            <p className="text-base text-white/85 font-minecraft tracking-wide">
              {t("profiles.import.natives_heading", { count: nativeCount })}
            </p>
            <p className="text-sm text-white/55 font-minecraft tracking-wide mt-1">
              {t("profiles.import.natives_explainer")}
            </p>
            <FileList paths={natives} />
          </div>
        </div>
      )}

      {scripts.length > 0 && (
        <div className="flex items-start gap-3">
          <Icon
            icon="solar:code-bold"
            className="w-5 h-5 text-orange-300 shrink-0 mt-0.5"
          />
          <div className="min-w-0">
            <p className="text-base text-white/85 font-minecraft tracking-wide">
              {t("profiles.import.scripts_heading", { count: scriptCount })}
            </p>
            <p className="text-sm text-white/55 font-minecraft tracking-wide mt-1">
              {t("profiles.import.scripts_explainer")}
            </p>
            <FileList paths={scripts} />
          </div>
        </div>
      )}

      {hosts.length > 0 && (
        <div className="flex items-start gap-3">
          <Icon
            icon="solar:global-bold"
            className="w-5 h-5 text-orange-300 shrink-0 mt-0.5"
          />
          <div className="min-w-0">
            <p className="text-base text-white/85 font-minecraft tracking-wide">
              {t("profiles.import.hosts_heading", { count: hosts.length })}
            </p>
            <p className="text-sm text-white/55 font-minecraft tracking-wide mt-1">
              {t("profiles.import.hosts_explainer")}
            </p>
            <FileList paths={hosts} />
          </div>
        </div>
      )}

      {unknown.length > 0 && (
        <div className="flex items-start gap-3">
          <Icon
            icon="solar:question-circle-bold"
            className="w-5 h-5 text-orange-300 shrink-0 mt-0.5"
          />
          <div className="min-w-0">
            <p className="text-base text-white/85 font-minecraft tracking-wide">
              {t("profiles.import.unknown_heading", { count: unknown.length })}
            </p>
            <p className="text-sm text-white/55 font-minecraft tracking-wide mt-1">
              {incomplete
                ? t("profiles.import.unknown_lookup_failed")
                : t("profiles.import.unknown_explainer", { count: verifiedCount })}
            </p>
            <ul className="mt-2 space-y-1 max-h-52 overflow-y-auto custom-scrollbar pr-1">
              {unknown.map((entry, index) => (
                <li
                  key={`${entry.name}-${index}`}
                  className="text-sm text-white/70 font-minecraft tracking-wide break-all"
                >
                  {truncate(entry.name, 120)}
                  <span className="text-white/35">
                    {" - "}
                    {t(`profiles.import.unknown_reason_${entry.reason}`)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}

function packSubtitle(
  preview: ImportPackPreview,
  t: (key: string, options?: Record<string, unknown>) => string,
): string {
  return [
    truncate(preview.fileName, 44),
    [preview.gameVersion, preview.loader].filter(Boolean).join(" "),
    t("profiles.import.chip_mods", { count: preview.modCount }),
    formatBytes(preview.fileSize),
  ]
    .filter(Boolean)
    .join("  ·  ");
}

function buildRemovedList(
  preview: ImportPackPreview,
  t: (key: string, options?: Record<string, unknown>) => string,
): string[] {
  const report = preview.security;
  const removed: string[] = [];

  if (report.strippedJavaPath) {
    removed.push(t("profiles.import.removed_java_path"));
  }
  if (report.strippedJvmArgs || report.strippedGameArgs.length > 0) {
    removed.push(t("profiles.import.removed_launch_args"));
  }
  for (const mod of report.rejectedMods) {
    removed.push(
      t("profiles.import.removed_mod", { name: truncate(mod.displayName, 120) }),
    );
  }
  for (const flag of report.strippedProfileFlags) {
    removed.push(t(`profiles.import.removed_flag_${flag}`));
  }

  return removed;
}
