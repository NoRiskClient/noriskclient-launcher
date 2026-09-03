"use client";

import { useTranslation } from "react-i18next";

import { CheckboxV2 } from "../../ui/CheckboxV2";
import { Tooltip } from "../../ui/Tooltip";
import { useThemeStore } from "../../../store/useThemeStore";
import { formatBytes } from "../../../utils/format-relative-time";
import type {
  ContentBucket,
  ContentBucketKey,
  ImportSelection,
} from "../../../types/launcherImport";

interface CopyContentsPickerProps {
  buckets: ContentBucket[];
  selection: ImportSelection;
  onChange: (next: ImportSelection) => void;
}

const HINTED: ContentBucketKey[] = ["saves"];

export function CopyContentsPicker({
  buckets,
  selection,
  onChange,
}: CopyContentsPickerProps) {
  const { t } = useTranslation();
  const accentColor = useThemeStore((state) => state.accentColor);

  const total = buckets.reduce(
    (sum, bucket) => (selection[bucket.key] ? sum + bucket.bytes : sum),
    0,
  );

  return (
    <div className="flex flex-col">
      <div className="mb-2 flex items-baseline justify-between">
        <label className="block text-lg font-smallcaps text-white">
          {t("profiles.launcherImport.confirm.copy_heading")}
        </label>
        <span className="font-minecraft text-xs text-white/45">
          {t("profiles.launcherImport.confirm.copy_total", { size: formatBytes(total) })}
        </span>
      </div>

      <div className="space-y-2">
        {buckets.map((bucket) => {
          const empty = bucket.entryCount === 0;
          const active = !empty && selection[bucket.key];
          const count = t(
            bucket.key === "saves"
              ? "profiles.launcherImport.confirm.kind_worlds_count"
              : "profiles.launcherImport.confirm.kind_files",
            { count: bucket.entryCount },
          );

          const row = (
            <div
              onClick={() =>
                !empty && onChange({ ...selection, [bucket.key]: !selection[bucket.key] })
              }
              className={`flex items-center gap-3 rounded-lg border px-3 py-2.5 transition-colors ${
                empty
                  ? "border-white/5 bg-white/[0.01] opacity-50"
                  : "cursor-pointer border-white/10 bg-black/20 hover:border-white/20"
              }`}
              style={
                active
                  ? {
                      borderColor: `${accentColor.value}66`,
                      backgroundColor: `${accentColor.value}12`,
                    }
                  : undefined
              }
            >
              <CheckboxV2
                size="sm"
                checked={active}
                disabled={empty}
                onChange={(next) => onChange({ ...selection, [bucket.key]: next })}
              />
              <span className="min-w-0 flex-1 truncate font-minecraft text-sm text-white/90">
                {t(`profiles.launcherImport.confirm.kind_${bucket.key}`)}
              </span>
              <span className="flex-shrink-0 font-minecraft text-xs text-white/45">
                {empty
                  ? t("profiles.launcherImport.confirm.kind_empty")
                  : `${count}  ·  ${formatBytes(bucket.bytes)}`}
              </span>
            </div>
          );

          return HINTED.includes(bucket.key) && !empty ? (
            <Tooltip
              key={bucket.key}
              content={t("profiles.launcherImport.confirm.worlds_hint")}
              position="top"
              wrapperClassName="w-full"
            >
              {row}
            </Tooltip>
          ) : (
            <div key={bucket.key}>{row}</div>
          );
        })}
      </div>
    </div>
  );
}
