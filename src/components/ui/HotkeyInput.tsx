"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";
import { cn } from "../../lib/utils";

interface HotkeyInputProps {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  conflictsWith?: string;
  onRecordingChange?: (recording: boolean) => void;
  className?: string;
}

const MODIFIER_CODES = new Set([
  "ControlLeft",
  "ControlRight",
  "ShiftLeft",
  "ShiftRight",
  "AltLeft",
  "AltRight",
  "MetaLeft",
  "MetaRight",
]);

export function HotkeyInput({
  value,
  onChange,
  disabled,
  conflictsWith,
  onRecordingChange,
  className,
}: HotkeyInputProps) {
  const { t } = useTranslation();
  const [recording, setRecording] = useState(false);
  const [preview, setPreview] = useState<string[]>([]);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const stop = useCallback(() => {
    setRecording(false);
    setPreview([]);
    onRecordingChange?.(false);
  }, [onRecordingChange]);

  const start = useCallback(() => {
    if (disabled) return;
    setRecording(true);
    setPreview([]);
    onRecordingChange?.(true);
  }, [disabled, onRecordingChange]);

  useEffect(() => {
    if (!recording) return;

    const onKeyDown = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();

      if (event.code === "Escape") {
        stop();
        return;
      }
      if (event.code === "Backspace" || event.code === "Delete") {
        onChange("");
        stop();
        return;
      }

      const modifiers = collectModifiers(event);

      if (MODIFIER_CODES.has(event.code)) {
        setPreview(modifiers);
        return;
      }

      onChange([...modifiers, event.code].join("+"));
      stop();
    };

    const onKeyUp = (event: KeyboardEvent) => {
      if (MODIFIER_CODES.has(event.code)) {
        setPreview(collectModifiers(event));
      }
    };

    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("keyup", onKeyUp, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("keyup", onKeyUp, true);
    };
  }, [recording, onChange, stop]);

  useEffect(() => {
    if (!recording) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!buttonRef.current?.contains(event.target as Node)) stop();
    };
    window.addEventListener("pointerdown", onPointerDown, true);
    return () => window.removeEventListener("pointerdown", onPointerDown, true);
  }, [recording, stop]);

  const conflict =
    !!value && !!conflictsWith && value.toLowerCase() === conflictsWith.toLowerCase();

  return (
    <div className={cn("flex flex-col items-end gap-1.5", className)}>
      <button
        ref={buttonRef}
        type="button"
        onClick={recording ? stop : start}
        disabled={disabled}
        className={cn(
          "flex h-9 min-w-[11rem] items-center justify-center gap-2 rounded-lg border px-3 font-minecraft text-sm transition-all",
          recording
            ? "border-[var(--accent)] bg-[var(--accent)]/10 text-white"
            : "border-white/15 bg-white/[0.04] text-white/80 hover:border-white/30 hover:bg-white/[0.07]",
          conflict && !recording && "border-red-400/50 bg-red-400/[0.07]",
          disabled && "cursor-not-allowed opacity-40 hover:border-white/15 hover:bg-white/[0.04]",
        )}
      >
        {recording ? (
          <>
            <Icon icon="svg-spinners:pulse-rings-3" className="h-4 w-4 text-[var(--accent)]" />
            <span>
              {preview.length > 0
                ? `${preview.map(labelFor).join(" + ")} + …`
                : t("hotkey.press")}
            </span>
          </>
        ) : value ? (
          <span className="tracking-wide">{formatShortcut(value)}</span>
        ) : (
          <span className="text-white/40">{t("hotkey.none")}</span>
        )}
      </button>

      <p className="text-right text-xs text-white/35">
        {recording
          ? t("hotkey.hint_recording")
          : conflict
            ? <span className="text-red-300">{t("hotkey.conflict")}</span>
            : t("hotkey.hint_idle")}
      </p>
    </div>
  );
}

function collectModifiers(event: KeyboardEvent): string[] {
  const modifiers: string[] = [];
  if (event.ctrlKey) modifiers.push("Ctrl");
  if (event.altKey) modifiers.push("Alt");
  if (event.shiftKey) modifiers.push("Shift");
  if (event.metaKey) modifiers.push("Super");
  return modifiers;
}

function formatShortcut(shortcut: string): string {
  if (!shortcut) return "";
  return shortcut.split("+").map(labelFor).join(" + ");
}

function labelFor(token: string): string {
  if (token.startsWith("Key")) return token.slice(3);
  if (token.startsWith("Digit")) return token.slice(5);
  if (token.startsWith("Numpad")) return `Num ${token.slice(6)}`;
  if (token.startsWith("Arrow")) return token.slice(5);

  const named: Record<string, string> = {
    Ctrl: "Ctrl",
    Alt: "Alt",
    Shift: "Shift",
    Super: "Win",
    Space: "Space",
    Enter: "Enter",
    Backquote: "`",
    Minus: "-",
    Equal: "=",
    BracketLeft: "[",
    BracketRight: "]",
    Semicolon: ";",
    Quote: "'",
    Comma: ",",
    Period: ".",
    Slash: "/",
    Backslash: "\\",
    CapsLock: "Caps",
    PageUp: "Page Up",
    PageDown: "Page Down",
    Insert: "Insert",
    Home: "Home",
    End: "End",
  };

  return named[token] ?? token;
}
