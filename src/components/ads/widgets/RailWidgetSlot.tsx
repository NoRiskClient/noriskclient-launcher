import { useState, type ComponentType } from "react";
import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";
import { useThemeStore } from "../../../store/useThemeStore";
import { readStored, writeStored } from "../../../utils/local-storage";
import { ContinueWidget } from "./ContinueWidget";
import { QuickJoinWidget } from "./QuickJoinWidget";
import { FriendsWidget } from "./FriendsWidget";
import { ClipsWidget, ScreenshotsWidget } from "./MediaWidgets";
import { CalculatorWidget, ClockWidget, NotesWidget } from "./ToolWidgets";

const ACTIVE_KEY = "nrc.railWidgets.active";

interface RailWidget {
  id: string;
  titleKey: string;
  icon: string;
  Component: ComponentType;
}

const WIDGETS: RailWidget[] = [
  { id: "continue", titleKey: "rail_widgets.continue.title", icon: "solar:play-bold", Component: ContinueWidget },
  { id: "quick-join", titleKey: "rail_widgets.quick_join.title", icon: "solar:server-bold", Component: QuickJoinWidget },
  { id: "friends", titleKey: "rail_widgets.friends.title", icon: "solar:users-group-rounded-bold", Component: FriendsWidget },
  { id: "clips", titleKey: "rail_widgets.clips.title", icon: "solar:videocamera-record-bold", Component: ClipsWidget },
  { id: "screenshots", titleKey: "rail_widgets.screenshots.title", icon: "solar:gallery-bold", Component: ScreenshotsWidget },
  { id: "clock", titleKey: "rail_widgets.clock.title", icon: "solar:clock-square-bold", Component: ClockWidget },
  { id: "notes", titleKey: "rail_widgets.notes.title", icon: "solar:notes-bold", Component: NotesWidget },
  { id: "calculator", titleKey: "rail_widgets.calculator.title", icon: "solar:calculator-bold", Component: CalculatorWidget },
];

const readActiveIndex = () =>
  readStored(ACTIVE_KEY, (raw) => Math.max(0, WIDGETS.findIndex((widget) => widget.id === raw)), 0);

export function RailWidgetSlot({ width, height }: { width: number; height: number }) {
  const { t } = useTranslation();
  const accent = useThemeStore((state) => state.accentColor.value);
  const [index, setIndex] = useState(readActiveIndex);
  const { id, titleKey, icon, Component } = WIDGETS[index];

  const step = (delta: number) => {
    const next = (index + delta + WIDGETS.length) % WIDGETS.length;
    setIndex(next);
    writeStored(ACTIVE_KEY, WIDGETS[next].id);
  };

  return (
    <div className="group/slot shrink-0 flex flex-col pt-2 border-t border-white/10" style={{ width, height }}>
      <div className="flex items-center gap-1 h-7 shrink-0" onWheel={(e) => step(e.deltaY > 0 ? 1 : -1)}>
        <button onClick={() => step(1)} className="flex-1 min-w-0 flex items-center gap-2 text-left">
          <Icon icon={icon} className="w-3.5 h-3.5 shrink-0" style={{ color: accent }} />
          <span className="font-smallcaps text-base text-white/70 truncate">{t(titleKey)}</span>
        </button>
        <div className="flex items-center opacity-0 group-hover/slot:opacity-100 focus-within:opacity-100 transition-opacity">
          <span className="font-minecraft text-[10px] text-white/30 tabular-nums mr-1">
            {index + 1}/{WIDGETS.length}
          </span>
          <StepButton icon="solar:alt-arrow-left-bold" label={t("rail_widgets.previous")} onClick={() => step(-1)} />
          <StepButton icon="solar:alt-arrow-right-bold" label={t("rail_widgets.next")} onClick={() => step(1)} />
        </div>
      </div>
      <div key={id} className="flex-1 min-h-0 overflow-y-auto no-scrollbar animate-in fade-in duration-200">
        <Component />
      </div>
    </div>
  );
}

function StepButton({ icon, label, onClick }: { icon: string; label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      className="w-5 h-5 flex items-center justify-center text-white/40 hover:text-white"
    >
      <Icon icon={icon} className="w-3.5 h-3.5" />
    </button>
  );
}
