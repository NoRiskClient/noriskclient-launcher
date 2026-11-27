import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";
import { getCurrentWindow } from "@tauri-apps/api/window";

interface FriendsTitlebarProps {
  onRefresh: () => void;
  refreshing: boolean;
}

export function FriendsTitlebar({ onRefresh, refreshing }: FriendsTitlebarProps) {
  const { t } = useTranslation();
  const appWindow = getCurrentWindow();

  return (
    <header className="fw-line-b flex h-10 shrink-0 select-none items-center pl-3 pr-1" data-tauri-drag-region>
      <div className="pointer-events-none flex flex-1 items-center gap-2">
        <img src="/logo.png" alt="" className="h-4 w-4 object-contain" draggable={false} />
        <span className="fw-label fw-accent" style={{ fontSize: "var(--fw-text-sm)" }}>
          {t("friends.window_title")}
        </span>
      </div>

      <div className="flex items-center gap-0.5">
        <button
          type="button"
          className="fw-icon-btn"
          onClick={onRefresh}
          disabled={refreshing}
          title={t("common.refresh")}
          aria-label={t("common.refresh")}
        >
          <Icon icon="solar:refresh-bold" className={refreshing ? "h-3.5 w-3.5 animate-spin" : "h-3.5 w-3.5"} />
        </button>
        <span className="mx-1 h-4 w-px" style={{ backgroundColor: "var(--fw-line-strong)" }} />
        <button
          type="button"
          className="fw-icon-btn"
          onClick={() => appWindow.minimize()}
          title={t("window.minimize")}
          aria-label={t("window.minimize")}
        >
          <Icon icon="pixel:minus-solid" className="h-4 w-4" />
        </button>
        <button
          type="button"
          className="fw-icon-btn"
          onClick={() => appWindow.toggleMaximize()}
          title={t("window.maximize")}
          aria-label={t("window.maximize")}
        >
          <Icon icon="pixel:expand-solid" className="h-3 w-3" />
        </button>
        <button
          type="button"
          className="fw-icon-btn fw-close-btn"
          onClick={() => appWindow.close()}
          title={t("window.close")}
          aria-label={t("window.close")}
        >
          <Icon icon="pixel:window-close-solid" className="h-4 w-4" />
        </button>
      </div>
    </header>
  );
}
