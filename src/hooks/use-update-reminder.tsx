import { useEffect, useRef } from "react";
import { toast } from "react-hot-toast";
import { useTranslation } from "react-i18next";
import { useThemeStore } from "../store/useThemeStore";
import {
  getBorderRadiusClass,
  getToastBaseStyles,
  TOAST_BASE_CLASSES,
} from "../components/ui/design-system";
import type { LauncherUpdate } from "../types/updater";

const STORAGE_KEY = "norisk-launcher-update-ready";
const REMIND_AFTER_MS = 24 * 60 * 60 * 1000;
const MAX_TIMEOUT_MS = 2_147_483_647;

interface ReadySince {
  version: string;
  since: number;
  reminded: boolean;
}

function readReadySince(): ReadySince | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as ReadySince) : null;
  } catch {
    return null;
  }
}

function writeReadySince(value: ReadySince) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  } catch {
    return;
  }
}

function UpdateReadyToast({
  version,
  onRestart,
  onDismiss,
}: {
  version: string;
  onRestart: () => void;
  onDismiss: () => void;
}) {
  const { t } = useTranslation();
  const accentColor = useThemeStore((state) => state.accentColor);
  const borderRadius = useThemeStore((state) => state.borderRadius);

  return (
    <div
      className={`${TOAST_BASE_CLASSES} ${getBorderRadiusClass(borderRadius)}`}
      style={getToastBaseStyles({ accentColor: accentColor.value, borderRadius })}
    >
      <div className="flex items-center gap-3">
        <span className="flex-1">{t("header.update.reminder", { version })}</span>
        <button
          type="button"
          className="px-3 py-1 rounded"
          style={{ backgroundColor: accentColor.value }}
          onClick={onRestart}
        >
          {t("header.update.restart_now")}
        </button>
        <button type="button" className="opacity-70 hover:opacity-100" onClick={onDismiss}>
          ✕
        </button>
      </div>
    </div>
  );
}

export function useUpdateReminder(update: LauncherUpdate | null, onRestart: () => void) {
  const restart = useRef(onRestart);
  restart.current = onRestart;

  useEffect(() => {
    if (!update?.ready) return;

    const stored = readReadySince();
    const state =
      stored?.version === update.version
        ? stored
        : { version: update.version, since: Date.now(), reminded: false };
    if (state !== stored) writeReadySince(state);
    if (state.reminded) return;

    const remind = () => {
      writeReadySince({ ...state, reminded: true });
      const id = `launcher-update-${update.version}`;
      toast.custom(
        () => (
          <UpdateReadyToast
            version={update.version}
            onRestart={() => {
              toast.dismiss(id);
              restart.current();
            }}
            onDismiss={() => toast.dismiss(id)}
          />
        ),
        { id, duration: Infinity },
      );
    };

    const wait = state.since + REMIND_AFTER_MS - Date.now();
    if (wait <= 0) {
      remind();
      return;
    }
    const timer = setTimeout(remind, Math.min(wait, MAX_TIMEOUT_MS));
    return () => clearTimeout(timer);
  }, [update?.version, update?.ready]);
}
