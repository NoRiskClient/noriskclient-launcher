import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useThemeStore } from "../../../store/useThemeStore";
import { readStored, writeStored } from "../../../utils/local-storage";
import { evaluate, stackBreakdown } from "./calculator";

const NOTES_KEY = "nrc.railWidgets.notes";
const CALCULATOR_KEYS = ["C", "(", ")", "/", "7", "8", "9", "*", "4", "5", "6", "-", "1", "2", "3", "+", "0", ".", "⌫", "="];

export function ClockWidget() {
  const { i18n } = useTranslation();
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  return (
    <div className="h-full flex flex-col items-center justify-center gap-1 font-minecraft">
      <div className="text-5xl text-white tabular-nums">
        {now.toLocaleTimeString(i18n.language, { hour: "2-digit", minute: "2-digit" })}
        <span className="text-2xl text-white/40">:{String(now.getSeconds()).padStart(2, "0")}</span>
      </div>
      <div className="text-sm text-white/50">
        {now.toLocaleDateString(i18n.language, { weekday: "long", day: "numeric", month: "long" })}
      </div>
    </div>
  );
}

export function NotesWidget() {
  const { t } = useTranslation();
  const [text, setText] = useState(() => readStored(NOTES_KEY, (raw) => raw ?? "", ""));
  return (
    <textarea
      value={text}
      onChange={(e) => {
        setText(e.target.value);
        writeStored(NOTES_KEY, e.target.value || null);
      }}
      placeholder={t("rail_widgets.notes.placeholder")}
      spellCheck={false}
      className="w-full h-full resize-none bg-transparent p-1 font-minecraft text-sm text-white/85 placeholder:text-white/30 outline-none custom-scrollbar"
    />
  );
}

export function CalculatorWidget() {
  const { t } = useTranslation();
  const accent = useThemeStore((state) => state.accentColor.value);
  const [input, setInput] = useState("");
  const result = input ? evaluate(input) : null;
  const stacks = result !== null ? stackBreakdown(result) : null;

  const press = (key: string) => {
    if (key === "C") setInput("");
    else if (key === "⌫") setInput(input.slice(0, -1));
    else if (key === "=") {
      if (result !== null) setInput(String(result));
    } else setInput(input + key);
  };

  return (
    <div className="h-full flex flex-col gap-1.5 font-minecraft">
      <div className="px-2 py-1 rounded bg-black/40 text-right">
        <div className="text-xs text-white/40 truncate h-4">{input || "0"}</div>
        <div className="text-lg text-white tabular-nums truncate">{result ?? "–"}</div>
        <div className="text-[10px] text-white/40 truncate h-3.5">{stacks && t("rail_widgets.calculator.stacks", { ...stacks })}</div>
      </div>
      <div className="flex-1 grid grid-cols-4 gap-1">
        {CALCULATOR_KEYS.map((key) => (
          <button
            key={key}
            onClick={() => press(key)}
            className="rounded bg-white/5 hover:bg-white/15 text-sm text-white/80 transition-colors"
            style={key === "=" ? { background: `${accent}50`, color: "white" } : undefined}
          >
            {key}
          </button>
        ))}
      </div>
    </div>
  );
}
