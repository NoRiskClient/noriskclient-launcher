import { useState, type ReactNode } from "react";
import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";
import { PlayerHead } from "../../common/PlayerHead";
import { formatFileSize } from "../../../utils/format-file-size";
import type { PackOrigin } from "../../../types/importPreview";

function Section({ title, count, children }: { title: string; count: number; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  if (count === 0) return null;
  return (
    <div className="rounded-md border border-white/10">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between px-3 py-2 font-minecraft text-base text-white tracking-wide hover:bg-white/5"
      >
        <span>
          {title} <span className="text-white/50">({count})</span>
        </span>
        <Icon icon={open ? "solar:alt-arrow-down-linear" : "solar:alt-arrow-right-linear"} className="w-4 h-4" />
      </button>
      {open && (
        <ul className="max-h-48 overflow-y-auto custom-scrollbar border-t border-white/10 px-3 py-2 space-y-1 font-mono text-xs text-white/70">
          {children}
        </ul>
      )}
    </div>
  );
}

export function ImportOriginPanel({ origin }: { origin: PackOrigin }) {
  const { t } = useTranslation();
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3">
        <PlayerHead uuid={origin.ownerUuid} username={origin.owner} size={40} />
        <div className="min-w-0">
          <p className="font-minecraft text-lg text-white tracking-wide truncate">{origin.owner}</p>
          <p className="font-minecraft text-sm text-white/55 tracking-wide truncate">
            {t("support_snapshot.title", { ticket: origin.ticketNumber })}
          </p>
        </div>
      </div>
      <Section title={t("support_snapshot.added_by_player")} count={origin.addedByPlayer.length}>
        {origin.addedByPlayer.map((path) => (
          <li key={path} className="truncate">
            {path}
          </li>
        ))}
      </Section>
      <Section title={t("support_snapshot.local_mods")} count={origin.localMods.length}>
        {origin.localMods.map((m) => (
          <li key={m.sha256} className="truncate" title={m.sha256}>
            {m.fileName} · {formatFileSize(m.size)} · {m.sha256.slice(0, 12)}
          </li>
        ))}
      </Section>
      <Section title={t("support_snapshot.not_transferred")} count={origin.notTransferred.length}>
        {origin.notTransferred.map((n) => (
          <li key={n.path} className="truncate">
            {n.path} · {t(`support_request.share.reason.${n.reason}`, { defaultValue: n.reason })}
          </li>
        ))}
      </Section>
    </div>
  );
}
