import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useThemeStore } from "../../store/useThemeStore";

const appWindow = getCurrentWindow();

interface LogWindowTitlebarProps {
  title?: string;
}

export function LogWindowTitlebar({ title }: LogWindowTitlebarProps) {
  const { t } = useTranslation();
  const accentColor = useThemeStore((state) => state.accentColor);
  const displayTitle = title || t('logs.window_title');

  const handleMinimize = () => {
    appWindow.minimize();
  };

  const handleMaximize = () => {
    appWindow.toggleMaximize();
  };

  const handleClose = () => {
    appWindow.close();
  };

  return (
    <div
      className="flex items-center justify-between h-10 px-3 select-none"
      data-tauri-drag-region
    >
      {/* Left: Title */}
      <div className="flex items-center gap-2 flex-1 h-full pointer-events-none">
        <Icon
          icon="solar:monitor-bold"
          className="w-5 h-5"
          style={{ color: accentColor.value }}
        />
        <span
          className="font-minecraft-ten text-sm tracking-wider"
          style={{ color: accentColor.value }}
        >
          {displayTitle.toUpperCase()}
        </span>
      </div>

      {/* Right: Window Controls */}
      <div className="flex items-center gap-1">
        {/* Minimize */}
        <button
          onClick={handleMinimize}
          className="w-8 h-8 flex items-center justify-center rounded hover:bg-white/10 transition-colors"
          title={t('window.minimize')}
        >
          <Icon icon="mdi:minus" className="w-4 h-4 text-white/70" />
        </button>

        {/* Maximize */}
        <button
          onClick={handleMaximize}
          className="w-8 h-8 flex items-center justify-center rounded hover:bg-white/10 transition-colors"
          title={t('window.maximize')}
        >
          <Icon icon="mdi:checkbox-blank-outline" className="w-3.5 h-3.5 text-white/70" />
        </button>

        {/* Close */}
        <button
          onClick={handleClose}
          className="w-8 h-8 flex items-center justify-center rounded hover:bg-red-500/80 transition-colors"
          title={t('window.close')}
        >
          <Icon icon="mdi:close" className="w-4 h-4 text-white/70" />
        </button>
      </div>
    </div>
  );
}
