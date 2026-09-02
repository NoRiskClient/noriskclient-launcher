"use client";

import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";

import { useThemeStore } from "../../store/useThemeStore";

export type ProfileSource = "blank" | "modpack" | "file" | "launcher";

interface ProfileSourceChooserProps {
  onChoose: (source: ProfileSource) => void;
  isBusy?: boolean;
}

const IMPORT_SOURCES: { id: Exclude<ProfileSource, "blank">; icon: string }[] = [
  { id: "modpack", icon: "solar:box-bold" },
  { id: "file", icon: "solar:file-bold" },
  { id: "launcher", icon: "solar:layers-bold" },
];

export function ProfileSourceChooser({ onChoose, isBusy = false }: ProfileSourceChooserProps) {
  const { t } = useTranslation();
  const accentColor = useThemeStore((state) => state.accentColor);

  return (
    <div className="space-y-4 px-8 pb-6 pt-5">
      <button
        onClick={() => onChoose("blank")}
        disabled={isBusy}
        className="flex w-full items-center gap-5 rounded-lg border-2 px-6 py-5 text-left transition-colors disabled:opacity-50"
        style={{
          borderColor: `${accentColor.value}80`,
          backgroundColor: `${accentColor.value}12`,
        }}
        onMouseEnter={(event) => {
          event.currentTarget.style.backgroundColor = `${accentColor.value}1f`;
        }}
        onMouseLeave={(event) => {
          event.currentTarget.style.backgroundColor = `${accentColor.value}12`;
        }}
      >
        <div
          className="flex h-14 w-14 flex-shrink-0 items-center justify-center rounded-lg"
          style={{ backgroundColor: `${accentColor.value}26` }}
        >
          <Icon icon="solar:widget-add-bold" className="h-7 w-7" style={{ color: accentColor.value }} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="font-minecraft text-xl normal-case text-white">
            {t("profiles.import.source_blank_title")}
          </div>
          <div className="mt-1 font-minecraft text-sm leading-relaxed text-white/55">
            {t("profiles.import.source_blank_description")}
          </div>
        </div>
        <Icon icon="solar:arrow-right-bold" className="h-5 w-5 flex-shrink-0" style={{ color: accentColor.value }} />
      </button>

      <div className="flex items-center gap-3">
        <div className="h-px flex-1 bg-white/10" />
        <span className="font-minecraft text-[10px] uppercase tracking-wider text-white/35">
          {t("profiles.import.source_divider")}
        </span>
        <div className="h-px flex-1 bg-white/10" />
      </div>

      <div className="space-y-2">
        {IMPORT_SOURCES.map((source) => (
          <button
            key={source.id}
            onClick={() => onChoose(source.id)}
            disabled={isBusy}
            className="group flex w-full items-center gap-4 rounded-lg border px-4 py-3 text-left transition-colors disabled:opacity-50"
            style={{
              borderColor: "rgba(255,255,255,0.1)",
              backgroundColor: "rgba(255,255,255,0.02)",
            }}
            onMouseEnter={(event) => {
              event.currentTarget.style.borderColor = `${accentColor.value}66`;
              event.currentTarget.style.backgroundColor = `${accentColor.value}12`;
            }}
            onMouseLeave={(event) => {
              event.currentTarget.style.borderColor = "rgba(255,255,255,0.1)";
              event.currentTarget.style.backgroundColor = "rgba(255,255,255,0.02)";
            }}
          >
            <Icon
              icon={source.icon}
              className="h-5 w-5 flex-shrink-0 text-white/35 transition-colors group-hover:text-white"
            />
            <div className="min-w-0 flex-1">
              <div className="font-minecraft text-sm text-white/85">
                {t(`profiles.import.source_${source.id}_title`)}
              </div>
              <div className="truncate font-minecraft text-xs text-white/40">
                {t(`profiles.import.source_${source.id}_description`)}
              </div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
