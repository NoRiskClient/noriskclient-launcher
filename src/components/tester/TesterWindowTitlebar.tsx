import { Icon } from "@iconify/react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useThemeStore } from "../../store/useThemeStore";

const appWindow = getCurrentWindow();

interface TesterWindowTitlebarProps {
  remaining: number;
}

export function TesterWindowTitlebar({ remaining }: TesterWindowTitlebarProps) {
  const accentColor = useThemeStore((state) => state.accentColor);

  return (
    <div
      className="relative flex items-center justify-between h-11 px-4 select-none border-b border-white/5 bg-black/40"
      data-tauri-drag-region
    >
      <div
        className="flex items-center gap-3 flex-1 h-full pointer-events-none"
        data-tauri-drag-region
      >
        <Icon
          icon="solar:test-tube-bold"
          className="w-4 h-4"
          style={{ color: accentColor.value }}
        />
        <span
          className="font-minecraft-ten text-xs uppercase tracking-wider"
          style={{ color: accentColor.value }}
        >
          NoRisk Tester Queue
        </span>
        {remaining > 0 && (
          <span
            className="px-2 py-0.5 rounded font-minecraft-ten text-[10px] uppercase tracking-wider"
            style={{
              background: `${accentColor.value}25`,
              color: accentColor.value,
              border: `1px solid ${accentColor.value}40`,
            }}
          >
            {remaining} pending
          </span>
        )}
      </div>

      <div className="flex items-center gap-1">
        <button
          onClick={() => appWindow.minimize()}
          className="w-8 h-8 flex items-center justify-center rounded hover:bg-white/10 transition-colors"
          title="Minimize"
        >
          <Icon icon="mdi:minus" className="w-4 h-4 text-white/70" />
        </button>
        <button
          onClick={() => appWindow.toggleMaximize()}
          className="w-8 h-8 flex items-center justify-center rounded hover:bg-white/10 transition-colors"
          title="Maximize"
        >
          <Icon icon="mdi:checkbox-blank-outline" className="w-3.5 h-3.5 text-white/70" />
        </button>
        <button
          onClick={() => appWindow.close()}
          className="w-8 h-8 flex items-center justify-center rounded hover:bg-red-500/80 transition-colors"
          title="Close"
        >
          <Icon icon="mdi:close" className="w-4 h-4 text-white/70" />
        </button>
      </div>
    </div>
  );
}
